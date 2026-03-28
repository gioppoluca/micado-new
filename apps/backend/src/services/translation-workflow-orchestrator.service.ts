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
 *       sourceLang: revision.sourceLang,
 *   });
 *
 * ── Content-type agnostic ────────────────────────────────────────────────────
 *
 * The orchestrator does not know about USER_TYPE or NEWS.  The caller
 * provides `category` (Gitea folder name) and the revision data.
 * All future content types reuse this same service entry point.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';
import { TranslationMasterWorkflow } from '../workflows/translation/translation.master.workflow';
import { TranslationSteps, registerRepositoriesForSteps } from '../workflows/translation/translation.steps';
import {
    TranslationJobInput, WeblateWebhookPayload,
    TranslationStatus, wfId, evKey, recvTopic, sendKey,
} from '../workflows/translation/types';
import type { ContentRevision } from '../models/content-revision.model';
import type { ContentItem } from '../models/content-item.model';
import { LanguageRepository } from '../repositories/language.repository';
import { FeatureFlagRepository } from '../repositories/feature-flag.repository';
import { ContentRevisionTranslationRepository } from '../repositories/content-revision-translation.repository';

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

// ─────────────────────────────────────────────────────────────────────────────

@injectable({ scope: BindingScope.SINGLETON })
export class TranslationWorkflowOrchestratorService {

    static readonly BINDING = 'services.TranslationWorkflowOrchestratorService';

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private logger: Logger,

        @repository(LanguageRepository)
        private languageRepository: LanguageRepository,

        @repository(FeatureFlagRepository)
        private featureFlagRepository: FeatureFlagRepository,

        @repository(ContentRevisionTranslationRepository)
        private translationRepository: ContentRevisionTranslationRepository,
    ) {
        // Wire repositories into TranslationSteps so DBOS steps can use them.
        // Steps run outside LoopBack DI — this is the bridge.
        registerRepositoriesForSteps({
            getContentRevisionTranslationRepository: async () => this.translationRepository as any,
        });
    }

    // ── Start the flow for an approved revision ───────────────────────────────

    /**
     * Called by any facade when a revision transitions DRAFT → APPROVED.
     *
     * Responsibilities:
     *   1. Read active target languages from DB
     *   2. Read feature flags (ai_translation, tts) — snapshot for durability
     *   3. Extract translatable fields from the revision
     *   4. Start the master DBOS workflow (idempotent by revisionId)
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

        // ── Read active target languages ──────────────────────────────────────
        const allLangs = await this.languageRepository.find({ where: { active: true } });
        const targetLangs = allLangs
            .map(l => l.lang)
            .filter(l => l !== sourceLang);

        if (targetLangs.length === 0) {
            this.logger.warn('[TranslationOrchestrator] no active target languages — workflow skipped', {
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

        this.logger.info('[TranslationOrchestrator] starting revision flow', {
            revisionId,
            category,
            itemId: String(item.externalKey),
            sourceLang,
            targetLangs,
            flags,
        });

        // ── Build workflow input ──────────────────────────────────────────────
        const jobInput: TranslationJobInput = {
            revisionId,
            category,
            itemId: String(item.externalKey),
            sourceLang,
            fields: this.filterNonEmptyFields(fields),
            targetLangs,
            flags,
        };

        // ── Start master workflow (idempotent) ────────────────────────────────
        const workflowID = wfId.master(revisionId);
        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID }).run(jobInput);

        this.logger.info('[TranslationOrchestrator] master workflow started', {
            workflowID, revisionId,
        });

        return { workflowID };
    }

    // ── Weblate webhook handler ───────────────────────────────────────────────

    /**
     * Called by the Weblate webhook controller when a translation is complete.
     * Delivers the translated fields to the correct child workflow.
     * The idempotency key deduplicates Weblate re-deliveries.
     */
    async signalTranslationReceived(payload: WeblateWebhookPayload): Promise<void> {
        const childId = wfId.child(payload.revisionId, payload.lang);
        await DBOS.send(
            childId,
            payload,
            recvTopic(payload.lang),
            sendKey(payload.revisionId, payload.lang, payload.sourceHash),
        );

        this.logger.info('[TranslationOrchestrator] Weblate webhook delivered', {
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async readFlag(key: string): Promise<boolean> {
        try {
            const flag = await this.featureFlagRepository.findOne({ where: { flagKey: key } });
            return flag?.enabled ?? false;
        } catch {
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