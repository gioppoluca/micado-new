/**
 * src/controllers/dev/translation-workflow-test.controller.ts
 *
 * Dev/test controller for manually triggering and signalling translation workflows.
 *
 * ── IMPORTANT ────────────────────────────────────────────────────────────────
 * Guard or remove this controller before going to production.
 * It bypasses all authorization and lets any caller start workflows
 * or inject fake Weblate webhooks.
 *
 * ── Type shapes (post-redesign) ───────────────────────────────────────────────
 *
 * TranslationJobInput now uses `fields: Record<string, string>` (not fieldKey/sourceText)
 * WeblateWebhookPayload now uses `fields: Record<string, string>` (not translation: string)
 *
 * Example cURL to start a workflow:
 *   curl -X POST http://localhost:3000/dev/workflows/translation/start \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "revisionId": "uuid-of-revision",
 *       "category": "user-types",
 *       "itemId": "42",
 *       "sourceLang": "en",
 *       "fields": { "title": "Asylum seeker", "description": "A person who seeks asylum." },
 *       "targetLangs": ["it", "fr", "ar"],
 *       "flags": { "aiTranslation": false, "tts": false }
 *     }'
 *
 * Example cURL to simulate a Weblate webhook:
 *   curl -X POST http://localhost:3000/dev/workflows/translation/signal-import \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "revisionId": "uuid-of-revision",
 *       "lang": "it",
 *       "sourceHash": "abc123",
 *       "fields": { "title": "Richiedente asilo", "description": "Una persona che chiede asilo." }
 *     }'
 */

import { api, post, requestBody } from '@loopback/rest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationMasterWorkflow } from '../../workflows/translation/translation.master.workflow';
import {
    TranslationJobInput,
    WeblateWebhookPayload,
    wfId,
    recvTopic,
    sendKey,
} from '../../workflows/translation/types';

@api({ basePath: '/dev/workflows/translation' })
export class TranslationWorkflowTestController {

    // ── Start a master workflow ───────────────────────────────────────────────

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
                            revisionId: { type: 'string' },
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
                                description: 'Target language codes, e.g. ["it","fr","ar"]',
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
            throw Object.assign(
                new Error('targetLangs must be a non-empty array'),
                { statusCode: 400 },
            );
        }

        if (!body.fields || Object.keys(body.fields).length === 0) {
            throw Object.assign(
                new Error('fields must be a non-empty object with at least one translatable field'),
                { statusCode: 400 },
            );
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

        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID }).run(input);

        return { workflowID };
    }

    // ── Simulate Weblate webhook (signal a language as complete) ─────────────

    @post('/signal-import')
    async signal(
        @requestBody({
            description: 'Simulate a Weblate webhook delivering a completed translation',
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
                                description: 'Translated fields matching the source keys',
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
    ): Promise<{ ok: boolean }> {
        const payload: WeblateWebhookPayload = {
            revisionId: body.revisionId,
            lang: body.lang,
            sourceHash: body.sourceHash,
            fields: body.fields,
        };

        await DBOS.send(
            wfId.child(body.revisionId, body.lang),
            payload,
            recvTopic(body.lang),
            sendKey(body.revisionId, body.lang, body.sourceHash),
        );

        return { ok: true };
    }
}