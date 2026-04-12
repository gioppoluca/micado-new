/**
 * src/controllers/dev/translation-workflow-test.controller.ts
 *
 * Dev/test controller for manually triggering and inspecting the translation workflow.
 *
 * ── IMPORTANT ─────────────────────────────────────────────────────────────────
 * ⚠  Guard or remove before going to production.
 * These endpoints bypass all authorization and allow any caller to:
 *   - start workflows
 *   - inject fake Weblate webhooks
 *   - inspect the active workflow registry
 *   - read raw Gitea catalogs
 *
 * ── Endpoints ────────────────────────────────────────────────────────────────
 *
 *  POST /dev/workflows/translation/start
 *    Start a master workflow directly (bypasses approval flow)
 *
 *  POST /dev/workflows/translation/signal-import
 *    Simulate a Weblate webhook delivery (by revisionId + lang)
 *
 *  POST /dev/workflows/translation/signal-by-item
 *    Simulate a Weblate webhook delivery (by category + itemId + lang)
 *    Reads actual translations from Gitea — mirrors the real webhook path
 *
 *  GET  /dev/workflows/translation/registry
 *    Dump the in-memory active workflow registry
 *
 *  GET  /dev/workflows/translation/gitea-catalog?category=user-types&lang=it
 *    Read the raw Gitea catalog for a given (category, lang) pair
 *
 *  GET  /dev/workflows/translation/status?revisionId=...&langs=it,fr,ar
 *    Poll the DBOS event store for current per-language status
 *
 * ── Example cURLs ────────────────────────────────────────────────────────────
 *
 *  # Start a workflow
 *  curl -X POST http://localhost:3000/dev/workflows/translation/start \
 *    -H 'Content-Type: application/json' \
 *    -d '{"revisionId":"<uuid>","category":"user-types","itemId":"42",
 *         "sourceLang":"en","fields":{"title":"Asylum seeker","description":"..."},
 *         "targetLangs":["it","fr"],"flags":{"aiTranslation":false,"tts":false}}'
 *
 *  # Simulate Weblate webhook (direct, by revisionId)
 *  curl -X POST http://localhost:3000/dev/workflows/translation/signal-import \
 *    -H 'Content-Type: application/json' \
 *    -d '{"revisionId":"<uuid>","lang":"it","sourceHash":"abc123",
 *         "fields":{"title":"Richiedente asilo","description":"..."}}'
 *
 *  # Simulate webhook (via Gitea — reads real catalog)
 *  curl -X POST http://localhost:3000/dev/workflows/translation/signal-by-item \
 *    -H 'Content-Type: application/json' \
 *    -d '{"category":"user-types","itemId":"42","lang":"it"}'
 *
 *  # Inspect registry
 *  curl http://localhost:3000/dev/workflows/translation/registry
 *
 *  # Read Gitea catalog
 *  curl "http://localhost:3000/dev/workflows/translation/gitea-catalog?category=user-types&lang=it"
 *
 *  # Poll status
 *  curl "http://localhost:3000/dev/workflows/translation/status?revisionId=<uuid>&langs=it,fr"
 */

import { api, get, post, param, requestBody } from '@loopback/rest';
import { inject } from '@loopback/core';
import { LoggingBindings } from '@loopback/logging';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { Logger } from 'winston';
import { TranslationMasterWorkflow } from '../../workflows/translation/translation.master.workflow';
import {
    TranslationJobInput,
    WeblateWebhookPayload,
    wfId,
    recvTopic,
    sendKey,
    evKey,
} from '../../workflows/translation/types';
import {
    TranslationWorkflowOrchestratorService,
} from '../../services/translation-workflow-orchestrator.service';
import { GiteaTranslationImportService } from '../../services/gitea-translation-import.service';

@api({ basePath: '/dev/workflows/translation' })
export class TranslationWorkflowTestController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,

        @inject(TranslationWorkflowOrchestratorService.BINDING, { optional: true })
        private readonly orchestrator: TranslationWorkflowOrchestratorService | undefined,

        @inject('services.GiteaTranslationImportService', { optional: true })
        private readonly giteaImport: GiteaTranslationImportService | undefined,
    ) { }

    // ── Start a master workflow ───────────────────────────────────────────────

    /**
     * Start a translation master workflow directly, bypassing the content approval flow.
     * Useful for testing the full Gitea → Weblate → DB pipeline end-to-end.
     */
    @post('/start')
    async start(
        @requestBody({
            description: 'Start a translation master workflow for a revision',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['revisionId', 'category', 'itemId', 'sourceLang', 'fields', 'targetLangs'],
                        properties: {
                            revisionId: { type: 'string', description: 'UUID of the content_revision' },
                            category: { type: 'string', description: 'e.g. user-types, news' },
                            itemId: { type: 'string', description: 'numeric legacy key as string' },
                            sourceLang: { type: 'string', description: 'ISO 639-1, e.g. en' },
                            fields: {
                                type: 'object',
                                description: 'Translatable fields: { title, description }',
                                additionalProperties: { type: 'string' },
                            },
                            targetLangs: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Target language codes e.g. ["it","fr","ar"]',
                            },
                            flags: {
                                type: 'object',
                                properties: {
                                    aiTranslation: { type: 'boolean' },
                                    tts: { type: 'boolean' },
                                },
                                default: { aiTranslation: false, tts: false },
                            },
                        },
                    },
                },
            },
        })
        body: {
            revisionId: string;
            category: string;
            itemId: string;
            sourceLang: string;
            fields: Record<string, string>;
            targetLangs: string[];
            flags?: { aiTranslation?: boolean; tts?: boolean };
        },
    ): Promise<{ workflowID: string }> {
        if (!Array.isArray(body.targetLangs) || body.targetLangs.length === 0) {
            throw Object.assign(new Error('targetLangs must be a non-empty array'), { statusCode: 400 });
        }
        if (!body.fields || Object.keys(body.fields).length === 0) {
            throw Object.assign(new Error('fields must be a non-empty object'), { statusCode: 400 });
        }

        const input: TranslationJobInput = {
            revisionId: body.revisionId,
            category: body.category,
            itemId: body.itemId,
            sourceLang: body.sourceLang,
            fields: body.fields,
            targetLangs: body.targetLangs,
            flags: {
                aiTranslation: body.flags?.aiTranslation ?? false,
                tts: body.flags?.tts ?? false,
            },
        };

        const workflowID = wfId.master(body.revisionId);

        this.logger.info('[DevController] Starting translation workflow', {
            workflowID, ...body,
        });

        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID }).run(input);

        return { workflowID };
    }

    // ── Signal by revisionId (direct — bypasses Gitea) ───────────────────────

    /**
     * Simulate a Weblate webhook by directly providing the translated fields.
     * Bypasses Gitea — useful when you want to test DB persistence only.
     */
    @post('/signal-import')
    async signalDirect(
        @requestBody({
            description: 'Simulate a Weblate webhook delivery (direct — no Gitea read)',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['revisionId', 'lang', 'sourceHash', 'fields'],
                        properties: {
                            revisionId: { type: 'string' },
                            lang: { type: 'string', description: 'e.g. it' },
                            sourceHash: { type: 'string', description: 'SHA of source fields' },
                            fields: {
                                type: 'object',
                                description: 'Translated fields',
                                additionalProperties: { type: 'string' },
                            },
                        },
                    },
                },
            },
        })
        body: {
            revisionId: string;
            lang: string;
            sourceHash: string;
            fields: Record<string, string>;
        },
    ): Promise<{ ok: boolean; childId: string }> {
        const payload: WeblateWebhookPayload = {
            revisionId: body.revisionId,
            lang: body.lang,
            sourceHash: body.sourceHash,
            fields: body.fields,
        };

        const childId = wfId.child(body.revisionId, body.lang);

        this.logger.info('[DevController] Sending direct signal to child workflow', {
            childId, lang: body.lang, revisionId: body.revisionId,
        });

        await DBOS.send(
            childId,
            payload,
            recvTopic(body.lang),
            sendKey(body.revisionId, body.lang, body.sourceHash),
        );

        return { ok: true, childId };
    }

    // ── Signal by itemId (via Gitea — mirrors the real webhook path) ──────────

    /**
     * Simulate the FULL Weblate → backend return path:
     *   1. Read the Gitea catalog for (category, lang)
     *   2. Look up the active revisionId from the orchestrator registry
     *   3. Signal the DBOS child workflow
     *
     * This is the same logic the real WeblateWebhookController executes.
     * Use this to validate the complete round-trip without actually waiting for Weblate.
     */
    @post('/signal-by-item')
    async signalByItem(
        @requestBody({
            description: 'Simulate webhook via Gitea catalog lookup (mirrors real webhook path)',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['category', 'itemId', 'lang'],
                        properties: {
                            category: { type: 'string', description: 'e.g. user-types' },
                            itemId: { type: 'string', description: 'numeric item key' },
                            lang: { type: 'string', description: 'e.g. it' },
                        },
                    },
                },
            },
        })
        body: { category: string; itemId: string; lang: string },
    ): Promise<{
        ok: boolean;
        signaled: boolean;
        revisionId?: string;
        fields?: Record<string, string>;
        reason?: string;
    }> {
        if (!this.orchestrator) {
            return { ok: false, signaled: false, reason: 'orchestrator not available (DBOS not running)' };
        }
        if (!this.giteaImport) {
            return { ok: false, signaled: false, reason: 'GiteaTranslationImportService not available' };
        }

        this.logger.info('[DevController] signal-by-item: loading Gitea catalog', body);

        const catalog = await this.giteaImport.loadTranslatedFields({
            category: body.category,
            isoCode: body.lang,
        });

        const itemFields = catalog[body.itemId];
        if (!itemFields) {
            this.logger.warn('[DevController] signal-by-item: itemId not found in catalog', {
                ...body, availableItems: Object.keys(catalog),
            });
            return {
                ok: true,
                signaled: false,
                reason: `itemId ${body.itemId} not found in catalog for ${body.category}/${body.lang}`,
            };
        }

        this.logger.info('[DevController] signal-by-item: found fields, signaling orchestrator', {
            ...body, fieldKeys: Object.keys(itemFields),
        });

        const result = await this.orchestrator.signalTranslationReceivedByItemId({
            category: body.category,
            itemId: body.itemId,
            lang: body.lang,
            fields: itemFields,
        });

        return {
            ok: true,
            signaled: result.signaled,
            revisionId: result.signaled ? result.revisionId : undefined,
            fields: itemFields,
            reason: !result.signaled ? result.reason : undefined,
        };
    }

    // ── Registry dump ─────────────────────────────────────────────────────────

    /**
     * Dump the orchestrator's in-memory active workflow registry.
     * Shows which (category, itemId) → revisionId mappings are currently live.
     */
    @get('/registry')
    async dumpRegistry(): Promise<{
        activeCount: number;
        entries: Record<string, unknown>;
    }> {
        if (!this.orchestrator) {
            return { activeCount: 0, entries: {} };
        }
        const entries = this.orchestrator.getActiveWorkflowRegistry();
        this.logger.info('[DevController] Registry dump requested', {
            activeCount: Object.keys(entries).length,
        });
        return { activeCount: Object.keys(entries).length, entries };
    }

    // ── Gitea catalog inspector ───────────────────────────────────────────────

    /**
     * Read the raw Gitea JSON catalog for a (category, lang) pair.
     * Returns both the raw key→entry map and the grouped itemId→fields map.
     *
     * Query params:
     *   category  e.g. user-types
     *   lang      e.g. it
     */
    @get('/gitea-catalog')
    async readGiteaCatalog(
        @param.query.string('category') category: string,
        @param.query.string('lang') lang: string,
    ): Promise<{
        path: string;
        raw: Record<string, unknown> | null;
        grouped: Record<string, Record<string, string>>;
        itemCount: number;
        keyCount: number;
    }> {
        if (!this.giteaImport) {
            return { path: '', raw: null, grouped: {}, itemCount: 0, keyCount: 0 };
        }

        const path = `${category}/${lang.toLowerCase()}.json`;

        this.logger.info('[DevController] Reading Gitea catalog', { category, lang, path });

        const [raw, grouped] = await Promise.all([
            this.giteaImport.loadRawCatalog({ category, isoCode: lang }),
            this.giteaImport.loadTranslatedFields({ category, isoCode: lang }),
        ]);

        return {
            path,
            raw,
            grouped,
            itemCount: Object.keys(grouped).length,
            keyCount: raw ? Object.keys(raw).length : 0,
        };
    }

    // ── Workflow status poll ──────────────────────────────────────────────────

    /**
     * Poll the DBOS event store for the current per-language status of a revision.
     *
     * Query params:
     *   revisionId   UUID of the content_revision
     *   langs        comma-separated language codes, e.g. it,fr,ar
     */
    @get('/status')
    async getStatus(
        @param.query.string('revisionId') revisionId: string,
        @param.query.string('langs') langsParam: string,
    ): Promise<unknown> {
        if (!this.orchestrator) {
            return { error: 'orchestrator not available' };
        }

        const targetLangs = langsParam
            ? langsParam.split(',').map(l => l.trim()).filter(Boolean)
            : [];

        if (!revisionId || targetLangs.length === 0) {
            return { error: 'revisionId and langs query params are required' };
        }

        this.logger.info('[DevController] Status poll', { revisionId, targetLangs });

        return this.orchestrator.getRevisionStatus(revisionId, targetLangs);
    }

    // ── DBOS event inspector ──────────────────────────────────────────────────

    /**
     * Read raw DBOS events for a child workflow.
     * Useful to see exactly what events have been set.
     *
     * Query params:
     *   revisionId   UUID of the content_revision
     *   lang         target language code
     */
    @get('/child-events')
    async getChildEvents(
        @param.query.string('revisionId') revisionId: string,
        @param.query.string('lang') lang: string,
    ): Promise<unknown> {
        if (!revisionId || !lang) {
            return { error: 'revisionId and lang are required' };
        }

        const childId = wfId.child(revisionId, lang);

        this.logger.info('[DevController] Reading child workflow events', { childId });

        const [status, mp3Url] = await Promise.all([
            DBOS.getEvent(childId, evKey.childStatus(lang)),
            DBOS.getEvent(childId, evKey.childMp3(lang)),
        ]);

        return {
            childId,
            revisionId,
            lang,
            events: {
                status,
                mp3Url,
            },
        };
    }
}