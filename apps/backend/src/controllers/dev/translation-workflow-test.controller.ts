import { post, requestBody, getModelSchemaRef } from '@loopback/rest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { TranslationMasterWorkflow } from '../../workflows/translation/translation.master.workflow';
import { TranslationJobInput, WeblateWebhookPayload, wfId, sendKey } from '../../workflows/translation/types';

/**
 * Dev/test controller for manually triggering and signalling translation workflows.
 * Remove or guard behind an internal-only route in production.
 */
export class TranslationWorkflowTestController {

    // ── Start a master workflow ─────────────────────────────────────────────

    @post('/dev/workflows/translation/start')
    async start(
        @requestBody() body: {
            revisionId: string;
            category: string;
            fieldKey: string;
            itemId: string;
            sourceText: string;
            targetLangs: string[];
        },
    ) {
        // Validate before handing to DBOS — a missing/non-array targetLangs
        // would survive TS types at runtime if the body is malformed JSON,
        // and would cause "langs is not iterable" deep inside the workflow.
        if (!Array.isArray(body.targetLangs) || body.targetLangs.length === 0) {
            throw Object.assign(new Error('targetLangs must be a non-empty array'), { statusCode: 400 });
        }

        const input: TranslationJobInput = {
            revisionId: body.revisionId,
            category:   body.category,
            fieldKey:   body.fieldKey,
            itemId:     body.itemId,
            sourceText: body.sourceText,
            targetLangs: body.targetLangs,
        };

        const workflowID = wfId.master(body.revisionId);

        await DBOS.startWorkflow(TranslationMasterWorkflow, { workflowID })
            .run(input);

        return { workflowID };
    }

    // ── Signal that Weblate finished a language ─────────────────────────────

    @post('/dev/workflows/translation/signal-import')
    async signal(
        @requestBody() body: {
            revisionId: string;
            lang: string;
            sourceHash: string;
            translation: string;
        },
    ) {
        const payload: WeblateWebhookPayload = {
            revisionId:  body.revisionId,
            lang:        body.lang,
            sourceHash:  body.sourceHash,
            translation: body.translation,
        };

        // The idempotency key prevents duplicate deliveries from re-triggering the child.
        await DBOS.send(
            wfId.child(body.revisionId, body.lang),  // destination workflow UUID
            payload,
            `weblate-import:${body.lang}`,           // topic (matches recvTopic(lang))
            sendKey(body.revisionId, body.lang, body.sourceHash), // idempotency key
        );

        return { ok: true };
    }
}