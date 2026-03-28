/**
 * src/controllers/webhooks/weblate.controller.ts
 *
 * Diagnostic receiver for the Weblate Webhook add-on.
 * Logs EVERYTHING — headers and raw body — and returns 200.
 * No parsing, no assumptions.
 *
 * Configure Weblate to POST to:
 *   http://<backend>/api/weblate/translation_complete
 */

import { post, Request, RestBindings } from '@loopback/rest';
import { inject } from '@loopback/core';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';

export class WeblateWebhookController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,
    ) { }

    @post('/api/weblate/translation_complete')
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
    ): Promise<{ ok: boolean }> {

        // ── headers ───────────────────────────────────────────────────────────
        this.logger.info('[WeblateWebhook] === HEADERS ===');
        for (const [key, value] of Object.entries(req.headers)) {
            this.logger.info(`[WeblateWebhook]   ${key}: ${JSON.stringify(value)}`);
        }

        // ── body ──────────────────────────────────────────────────────────────
        this.logger.info('[WeblateWebhook] === BODY ===');
        this.logger.info('[WeblateWebhook] ${JSON.stringify(req}');
        this.logger.info(`[WeblateWebhook] ${JSON.stringify((req as Request & { body?: unknown }).body ?? '(empty)')}`);

        return { ok: true };
    }
}