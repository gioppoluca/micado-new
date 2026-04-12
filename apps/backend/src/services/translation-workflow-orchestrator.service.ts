/**
 * src/services/translation-workflow-orchestrator.service.ts
 *
 * LoopBack-injectable service that facades call to start and observe the
 * content translation + TTS workflow.
 *
 * This is the ONLY coupling point between LoopBack (DI container, repositories)
 * and DBOS (durable workflows).  Facades inject this service and call
 * `startRevisionFlow()` when a revision is approved.
 *
 * ── How to use from a facade ─────────────────────────────────────────────────
 *
 *   // In facade constructor:
 *   @inject(TranslationWorkflowOrchestratorService.BINDING)
 *   protected translationOrchestrator: TranslationWorkflowOrchestratorService,
 *
 *   // When DRAFT → APPROVED:
 *   await this.translationOrchestrator.startRevisionFlow({
 *       revision,
 *       item,
 *       category:   'user-types',     // or 'news', 'processes', etc.
 *       fields:     { title: '...', description: '...' },
 *   });
 *
 * ── Content-type agnostic ────────────────────────────────────────────────────
 *
 * The orchestrator does not know about USER_TYPE or NEWS.  The caller
 * provides `category` (Gitea folder name) and the revision data.
 * All future content types reuse this same service entry point.
 *
 * ── Webhook return path ──────────────────────────────────────────────────────
 *
 * When Weblate fires a translation-complete webhook the controller calls
 * `signalTranslationReceivedByItemId()` which:
 *   1. Looks up the active revision for (category, itemId) from DB
 *   2. Computes the sourceHash of the revision's source fields
 *   3. Sends the DBOS message to the waiting child workflow
 *
 * The child workflow then persists the translation to DB and marks itself done.
 *
 * ── Active workflow tracking ─────────────────────────────────────────────────
 *
 * We keep an in-memory map  (category:itemId) → { revisionId, sourceFields }
 * populated at startRevisionFlow() time.  This is sufficient for a single-node
 * deployment.  For multi-node, replace with a DB-backed registry.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';
import { TranslationMasterWorkflow } from '../workflows/translation/translation.master.workflow';
import { TranslationSteps, registerRepositoriesForSteps, registerGiteaExportServiceForSteps } from '../workflows/translation/translation.steps';
import {
    TranslationJobInput, WeblateWebhookPayload,
    TranslationStatus, wfId, evKey, recvTopic, sendKey,
} from '../workflows/translation/types';
import type { ContentRevision } from '../models/content-revision.model';
import type { ContentItem } from '../models/content-item.model';
import { LanguageRepository } from '../repositories/language.repository';
import { FeatureFlagRepository } from '../repositories/feature-flag.repository';
import { ContentRevisionTranslationRepository } from '../repositories/content-revision-translation.repository';
import { GiteaTranslationExportService } from './gitea-translation-export.service';

// ── Status view (for polling/dashboard) ──────────────────────────────────────

export type RevisionStatusView = {
    revisionId: string;
    done: boolean;
    languages: Record<string, {
        status: TranslationStatus | null;
        mp3Url: string | null;
    }>;
};

// ── Feature flag keys ─────────────────────────────────────────────────────────

export const FLAG_AI_TRANSLATION = 'ai_translation';
export const FLAG_TTS = 'tts';

// ── Active workflow registry entry ────────────────────────────────────────────

type ActiveWorkflowEntry = {
    revisionId: string;
    sourceFields: Record<string, string>;
    startedAt: string;
};

// ── Signal result ─────────────────────────────────────────────────────────────

export type SignalResult =
    | { signaled: true; revisionId: string }
    | { signaled: false; reason: string };

// ─────────────────────────────────────────────────────────────────────────────

@injectable({ scope: BindingScope.SINGLETON })
export class TranslationWorkflowOrchestratorService {

    static readonly BINDING = 'services.TranslationWorkflowOrchestratorService';

    /**
     * In-memory registry: `<category>:<itemId>` → workflow entry.
     *
     * Single-node safe.  Survives pod restart only if DBOS re-triggers
     * startRevisionFlow() on recovery (which it does via durable workflow log).
     *
     * NOTE: In production multi-node deployment, replace with a Postgres-backed
     * `translation_active_workflows` table.
     */
    private readonly activeWorkflows = new Map<string, ActiveWorkflowEntry>();

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: Logger,

        @repository(LanguageRepository)
        private languageRepository: LanguageRepository,

        @repository(FeatureFlagRepository)
        private featureFlagRepository: FeatureFlagRepository,

        @repository(ContentRevisionTranslationRepository)
        private translationRepository: ContentRevisionTranslationRepository,

        @inject('services.GiteaTranslationExportService')
        private giteaExportService: GiteaTranslationExportService,
    ) {
        // Wire repositories into TranslationSteps so DBOS steps can use them.
        // Steps run outside LoopBack DI — this is the bridge.
        registerRepositoriesForSteps({
            getContentRevisionTranslationRepository: async () => this.translationRepository as any,
        });

        // Wire the DI-managed GiteaTranslationExportService singleton into steps
        // so steps never call `new` directly (which would bypass the logger config).
        registerGiteaExportServiceForSteps(this.giteaExportService);

        this.logger.info('[TranslationOrchestrator] Service initialized');
    }

    // ── Start the flow for an approved revision ───────────────────────────────

    /**
     * Called by any facade when a revision transitions DRAFT → APPROVED.
     *
     * Responsibilities:
     *   1. Read active target languages from DB
     *   2. Read feature flags (ai_translation, tts) — snapshot for durability
     *   3. Extract translatable fields from the revision
     *   4. Register in active workflow map
     *   5. Start the master DBOS workflow (idempotent by revisionId)
     *
     * @param revision  The content_revision row (must include sourceLang + dataExtra)
     * @param item      The content_item row (for externalKey → itemId)
     * @param category  Gitea folder name for this content type (e.g. 'user-types')
     * @param fields    Translatable text fields: { title, description }
     *                  The caller extracts these from the source translation row.
     */
    async startRevisionFlow(input: {
        revision: ContentRevision;
        item: ContentItem;
        category: string;
        fields: Record<string, string>;
    }): Promise<{ workflowID: string }> {
        const { revision, item, category, fields } = input;
        const revisionId = revision.id!;
        const sourceLang = revision.sourceLang;
        const itemId = String(item.externalKey);

        this.logger.info('[TranslationOrchestrator] startRevisionFlow called', {
            revisionId,
            category,
            itemId,
            sourceLang,
            fieldKeys: Object.keys(fields),
        });

        // ── Read active target languages ──────────────────────────────────────
        const allLangs = await this.languageRepository.find({ where: { active: true } });
        const targetLangs = allLangs
            .map(l => l.lang)
            .filter(l => l !== sourceLang);

        this.logger.info('[TranslationOrchestrator] Language discovery', {
            revisionId,
            sourceLang,
            allActiveLangs: allLangs.map(l => l.lang),
            targetLangs,
        });

        if (targetLangs.length === 0) {
            this.logger.warn('[TranslationOrchestrator] No active target languages — workflow skipped', {
                revisionId, sourceLang,
            });
            return { workflowID: 'skipped:no-target-langs' };
        }

        // ── Snapshot feature flags ────────────────────────────────────────────
        const [aiFlag, ttsFlag] = await Promise.all([
            this.readFlag(FLAG_AI_TRANSLATION),
            this.readFlag(FLAG_TTS),
        ]);

        const flags: TranslationJobInput['flags'] = {
            aiTranslation: aiFlag,
            tts: ttsFlag,
        };

        this.logger.info('[TranslationOrchestrator] Feature flags snapshot', {
            revisionId, flags,
        });

        // ── Filter non-empty fields ───────────────────────────────────────────
        const filteredFields = this.filterNonEmptyFields(fields);

        this.logger.info('[TranslationOrchestrator] Fields after filtering', {
            revisionId,
            original: Object.keys(fields),
            filtered: Object.keys(filteredFields),
            skipped: Object.keys(fields).filter(k => !filteredFields[k]),
        });

        if (Object.keys(filteredFields).length === 0) {
            this.logger.warn('[TranslationOrchestrator] All fields are empty — workflow skipped', {
                revisionId,
            });
            return { workflowID: 'skipped:empty-fields' };
        }

        // ── Register in active workflow map ───────────────────────────────────
        const registryKey = `${category}:${itemId}`;
        const entry: ActiveWorkflowEntry = {
            revisionId,
            sourceFields: filteredFields,
            startedAt: new Date().toISOString(),
        };
        this.activeWorkflows.set(registryKey, entry);

        this.logger.info('[TranslationOrchestrator] Registered in active workflows map', {
            registryKey, revisionId, activeCount: this.activeWorkflows.size,
        });

        // ── Build workflow input ──────────────────────────────────────────────
        const jobInput: TranslationJobInput = {
            revisionId,
            category,
            itemId,
            sourceLang,
            fields: filteredFields,
            targetLangs,
            flags,
        };

        // ── Start master workflow (idempotent) ────────────────────────────────
        const workflowID = wfId.master(revisionId);

        this.logger.info('[TranslationOrchestrator] Starting master DBOS workflow', {
            workflowID, revisionId, jobInput,
        });

        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID }).run(jobInput);

        this.logger.info('[TranslationOrchestrator] Master workflow started successfully', {
            workflowID, revisionId,
        });

        return { workflowID };
    }

    // ── Weblate webhook handler — by itemId ───────────────────────────────────

    /**
     * Called by the Weblate webhook controller for each item in the
     * translated catalog pulled from Gitea.
     *
     * Looks up the active revision for (category, itemId) from the in-memory
     * registry, then delivers the translated fields to the DBOS child workflow.
     *
     * Returns a typed result so the controller can log exactly what happened
     * for each item without throwing.
     */
    async signalTranslationReceivedByItemId(input: {
        category: string;
        itemId: string;
        lang: string;
        fields: Record<string, string>;
    }): Promise<SignalResult> {
        const { category, itemId, lang, fields } = input;
        const registryKey = `${category}:${itemId}`;

        this.logger.debug('[TranslationOrchestrator] signalTranslationReceivedByItemId called', {
            registryKey, lang, fieldKeys: Object.keys(fields),
        });

        const entry = this.activeWorkflows.get(registryKey);
        if (!entry) {
            this.logger.warn('[TranslationOrchestrator] No active workflow entry found', {
                registryKey, lang,
                knownKeys: Array.from(this.activeWorkflows.keys()),
            });
            return { signaled: false, reason: `no active workflow for ${registryKey}` };
        }

        const { revisionId, sourceFields } = entry;
        const sourceHash = TranslationSteps.computeSourceHash(sourceFields);

        const payload: WeblateWebhookPayload = {
            revisionId,
            lang,
            sourceHash,
            fields,
        };

        this.logger.info('[TranslationOrchestrator] Delivering translation to DBOS child workflow', {
            registryKey, revisionId, lang, sourceHash,
            fieldKeys: Object.keys(fields),
        });

        await this.signalTranslationReceived(payload);

        return { signaled: true, revisionId };
    }

    // ── Weblate webhook handler — by revisionId (internal/test use) ───────────

    /**
     * Direct signal by revisionId + lang.
     * Used by the dev test controller and for future direct integrations.
     * The idempotency key deduplicates Weblate re-deliveries.
     */
    async signalTranslationReceived(payload: WeblateWebhookPayload): Promise<void> {
        const childId = wfId.child(payload.revisionId, payload.lang);

        this.logger.info('[TranslationOrchestrator] DBOS.send to child workflow', {
            childId,
            revisionId: payload.revisionId,
            lang: payload.lang,
            sourceHash: payload.sourceHash,
            topic: recvTopic(payload.lang),
            idempotencyKey: sendKey(payload.revisionId, payload.lang, payload.sourceHash),
            fieldKeys: Object.keys(payload.fields),
        });

        await DBOS.send(
            childId,
            payload,
            recvTopic(payload.lang),
            sendKey(payload.revisionId, payload.lang, payload.sourceHash),
        );

        this.logger.info('[TranslationOrchestrator] Weblate webhook delivered to DBOS', {
            revisionId: payload.revisionId,
            lang: payload.lang,
            sourceHash: payload.sourceHash,
        });
    }

    // ── Status polling ────────────────────────────────────────────────────────

    /**
     * Returns the current status of every language in a revision.
     * Suitable for a dashboard or PA status badge.
     */
    async getRevisionStatus(
        revisionId: string,
        targetLangs: string[],
    ): Promise<RevisionStatusView> {
        this.logger.debug('[TranslationOrchestrator] getRevisionStatus', { revisionId, targetLangs });

        const statuses = await Promise.all(
            targetLangs.map(async lang => {
                const childId = wfId.child(revisionId, lang);
                const [status, mp3Url] = await Promise.all([
                    DBOS.getEvent<TranslationStatus>(childId, evKey.childStatus(lang)),
                    DBOS.getEvent<string | null>(childId, evKey.childMp3(lang)),
                ]);
                return { lang, status, mp3Url: mp3Url ?? null };
            }),
        );

        const masterDone = await DBOS.getEvent<boolean>(
            wfId.master(revisionId),
            evKey.masterDone(),
        );

        return {
            revisionId,
            done: masterDone === true,
            languages: Object.fromEntries(
                statuses.map(s => [s.lang, { status: s.status, mp3Url: s.mp3Url }]),
            ),
        };
    }

    // ── Registry inspection (dev/admin) ───────────────────────────────────────

    /** Returns a snapshot of the in-memory active workflow registry. */
    getActiveWorkflowRegistry(): Record<string, ActiveWorkflowEntry> {
        return Object.fromEntries(this.activeWorkflows.entries());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async readFlag(key: string): Promise<boolean> {
        try {
            const flag = await this.featureFlagRepository.findOne({ where: { flagKey: key } });
            const value = flag?.enabled ?? false;
            this.logger.debug('[TranslationOrchestrator] Feature flag read', { key, value });
            return value;
        } catch (err) {
            this.logger.warn('[TranslationOrchestrator] Feature flag read failed — defaulting to false', {
                key, error: String(err),
            });
            return false;
        }
    }

    /** Remove fields with empty/whitespace-only values — don't push blank strings. */
    private filterNonEmptyFields(fields: Record<string, string>): Record<string, string> {
        return Object.fromEntries(
            Object.entries(fields).filter(([, v]) => v.trim().length > 0),
        );
    }
}