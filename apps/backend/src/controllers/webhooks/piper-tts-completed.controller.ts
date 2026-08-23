/**
 * src/controllers/webhooks/piper-tts-completed.controller.ts
 *
 * Receives the completion callback from the Piper TTS microservice
 * (apps/piper, app/notifier.py — `notify_backend()`), sent once a synthesis
 * job POSTed to Piper's `/jobs` finishes (successfully or not).
 *
 * ── Why this hook exists ──────────────────────────────────────────────────────
 *
 * `POST {PIPER_BASE_URL}/jobs` (called by PiperTtsService.requestSynthesis(),
 * src/services/piper-tts.service.ts) returns 202 immediately — Piper works
 * asynchronously and writes the MP3 to the shared `piper_audio` volume later.
 * This endpoint is how Piper tells the backend "done" (or "failed"), so the
 * backend can eventually resume whatever was waiting on it (a DBOS
 * `DBOS.recv()`, most likely — see the "NOT wired yet" note below) instead of
 * polling the filesystem.
 *
 * ── Current scope of this controller (explicit product decision) ────────────
 *
 * Per instruction: for now this ONLY logs the received payload. No signature
 * verification, no DB writes, no DBOS signal — that is real business logic
 * to be added later. Do not read "logs only" as "not important" — every field
 * below is exactly what the real logic will need, so the log line already
 * doubles as a spec for that follow-up work (see the TODO block in `receive()`).
 *
 * ── Why @authenticate.skip() (same reasoning as the Weblate webhooks) ────────
 *
 * The application has AuthorizationDecision.DENY by default. Without
 * @authenticate.skip(), the request is rejected with 401 BEFORE the method
 * body runs — zero logs, zero processing, silent discard. Piper sends no JWT
 * (it is a small internal service, not a user-facing client), so this
 * endpoint must be public for now.
 *
 * ⚠ SECURITY — deliberately deferred, not forgotten:
 * apps/piper's `app/notifier.py` already supports signing this callback with
 * HMAC-SHA256 when `PIPER_WEBHOOK_SECRET` is set on the Piper side
 * (headers `X-Piper-Timestamp` / `X-Piper-Signature`, see that file's
 * docstring). This controller does not verify it yet. When that work is
 * picked up, `WeblateWebhookSignatureService`
 * (src/services/weblate-webhook-signature.service.ts) is the pattern to
 * follow — same HMAC-SHA256-over-raw-body idea, simpler because both ends of
 * this particular integration are controlled by us.
 *
 * ── Route naming ───────────────────────────────────────────────────────────────
 *
 * Follows the existing `/api/webhooks/<source>/<event>` convention used by
 * the Weblate webhooks (`/api/webhooks/weblate/translation-pushed`, etc.).
 *
 * ⚠ INFRA FOLLOW-UP: apps/piper's default `PIPER_CALLBACK_PATH` is
 * `/webhooks/tts-completed` (see apps/piper/app/config.py), which does NOT
 * match this route. Set `PIPER_CALLBACK_PATH=/api/webhooks/piper/tts-completed`
 * on the `piper` service in docker-compose.yml, alongside the
 * `PIPER_CALLBACK_BASE_URL` addition already noted in the Piper redesign
 * commentary (§8) — otherwise Piper's callback will 404 against this backend.
 *
 * ── Payload shape (mirrors apps/piper's TtsCallbackPayload, app/schemas.py) ──
 *
 *   {
 *     "callback_workflow_id": "tr:6f2ab3d1-...:it",   // opaque, echoed from the job request — see PiperTtsService
 *     "callback_topic":       "piper-tts",             // opaque, echoed from the job request
 *     "output_relative_path": "user-types/it/6f2ab3d1-....mp3",
 *     "lang":                 "it",
 *     "status":                "ready" | "failed",
 *     "public_path":           "/media/audio/user-types/it/6f2ab3d1-....mp3" | null,
 *     "error_message":         null | "synthesis failed: ..."
 *   }
 *
 * ── Manual test via curl ──────────────────────────────────────────────────────
 *
 *   curl -X POST http://localhost:3000/api/webhooks/piper/tts-completed \
 *     -H 'Content-Type: application/json' \
 *     -d '{"callback_workflow_id":"tr:test:it","callback_topic":"piper-tts",
 *          "output_relative_path":"user-types/it/test.mp3","lang":"it",
 *          "status":"ready","public_path":"/media/audio/user-types/it/test.mp3"}'
 */

import {
    post,
    Request,
    RestBindings,
    requestBody,
} from '@loopback/rest';
import { inject } from '@loopback/core';
import { authenticate } from '@loopback/authentication';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';

// ── Piper TTS callback payload (mirrors apps/piper's TtsCallbackPayload) ──────
interface PiperTtsCallbackBody {
    callback_workflow_id?: string;
    callback_topic?: string;
    output_relative_path?: string;
    lang?: string;
    status?: 'ready' | 'failed';
    public_path?: string | null;
    error_message?: string | null;
    [key: string]: unknown;
}

export class PiperTtsCompletedController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,
    ) {
        // Logged once at boot — confirms the route is registered, same
        // convention as WeblateWebhookController.
        this.logger.info(
            '[PiperTtsWebhook] REGISTERED — POST /api/webhooks/piper/tts-completed',
        );
        this.logger.warn(
            '[PiperTtsWebhook] Signature verification DISABLED — logging only, no business logic yet (see class docstring)',
        );
    }

    @post('/api/webhooks/piper/tts-completed')
    // REQUIRED: without this the DENY-by-default auth policy rejects with 401
    // before the method body runs — producing zero logs. See class docstring
    // for the security follow-up (HMAC signature, currently NOT verified).
    @authenticate.skip()
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Piper TTS completion callback body',
            required: false,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                },
            },
        })
        body: PiperTtsCallbackBody,
    ): Promise<{ ok: boolean }> {

        const tag = '[PiperTtsWebhook]';

        // ── Log everything immediately — this IS the current scope, not a
        // placeholder for it. Every field logged here is exactly what the
        // real logic (below) will need once it's implemented. ──────────────
        this.logger.info(`${tag} INCOMING  remote=${req.ip}`);
        this.logger.info(
            `${tag} headers  x-piper-timestamp=${req.headers['x-piper-timestamp'] ?? '(none)'}` +
            `  x-piper-signature=${this.maskSecret(String(req.headers['x-piper-signature'] ?? ''))}`,
        );
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);

        this.logger.info(
            `${tag} parsed  callback_workflow_id=${body?.callback_workflow_id ?? '(missing)'}` +
            `  callback_topic=${body?.callback_topic ?? '(missing)'}` +
            `  lang=${body?.lang ?? '(missing)'}` +
            `  status=${body?.status ?? '(missing)'}` +
            `  output_relative_path=${body?.output_relative_path ?? '(missing)'}` +
            `  public_path=${body?.public_path ?? '(none)'}` +
            `  error_message=${body?.error_message ?? '(none)'}`,
        );

        if (body?.status === 'failed') {
            this.logger.warn(
                `${tag} synthesis FAILED  callback_workflow_id=${body?.callback_workflow_id ?? '(missing)'}` +
                `  error_message=${body?.error_message ?? '(none)'}`,
            );
        }

        // ── TODO (real business logic — not implemented per current scope) ──
        //
        // Once PiperTtsService.requestSynthesis() is actually wired into
        // TranslationSteps.generateMp3() (src/workflows/translation/translation.steps.ts),
        // this handler will need to:
        //
        //   1. Resolve which DBOS workflow is waiting: `body.callback_workflow_id`
        //      is exactly the `processId` PiperTtsService was called with —
        //      see that service's docstring for the wfId.child(...) /
        //      wfId.srcTts(...) assumption.
        //
        //   2. DBOS.send(body.callback_workflow_id, payload, body.callback_topic)
        //      to unblock the waiting DBOS.recv() — same pattern already used
        //      for the Weblate return path
        //      (TranslationWorkflowOrchestratorService.signalTranslationReceived()).
        //
        //   3. On status === 'failed': decide whether to let the DBOS step's
        //      own retry (generateMp3 already has
        //      `{ retriesAllowed: true, maxAttempts: 5 }`) re-request synthesis,
        //      or resume with mp3Url = null (translation is still saved either
        //      way — see TranslationChildWorkflow, which already treats TTS
        //      failure as non-fatal).
        //
        //   4. Consider idempotency: Piper may retry this callback itself
        //      (see apps/piper/app/notifier.py, PIPER_CALLBACK_MAX_ATTEMPTS) —
        //      a duplicate delivery must not fail if the workflow already
        //      moved on. DBOS.send() is itself idempotent by (workflowId,
        //      topic, idempotencyKey) when a key is supplied — mirror
        //      `sendKey()` from src/workflows/translation/types.ts.
        //
        // None of the above is implemented yet — this handler only logs.

        return { ok: true };
    }

    private maskSecret(value: string): string {
        if (!value || value.length <= 8) return value ? '****' : '(none)';
        return `${value.slice(0, 6)}...(len=${value.length})`;
    }
}
