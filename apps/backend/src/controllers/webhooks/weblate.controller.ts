/**
 * src/controllers/webhooks/weblate.controller.ts
 *
 * Receives POST from Weblate's "weblate.webhook.webhook" add-on (Weblate ≥ 5.11).
 *
 * ── Why @authenticate.skip() is REQUIRED ─────────────────────────────────────
 *
 * The application has AuthorizationDecision.DENY by default.
 * Without @authenticate.skip(), the request is rejected with 401 BEFORE the
 * method body runs — zero logs, zero processing, silent discard.
 * Weblate sends no JWT token, so this endpoint must be public.
 * Security is provided by the Standard Webhooks signature instead.
 *
 * ── Event enum confusion (documented to prevent future mistakes) ──────────────
 *
 * Weblate has TWO completely different integer enums:
 *
 *   AddonEvent  (weblate/addons/events.py)     — add-on lifecycle hooks (1–15)
 *               used as the `events` field on @DBOS.step() decorators
 *
 *   ActionEvents (weblate/trans/actions.py)    — translation history actions (0–88)
 *               used as the `events` field in the WEBHOOK ADDON configuration
 *
 * The webhook add-on form field "events" takes ActionEvents integers.
 * Correct values for this project:
 *   17 = COMMIT   — Weblate commits changes to the local git repo
 *   18 = PUSH     — Weblate pushes to Gitea  ← primary trigger
 *
 * ── Weblate 5.16 payload shape ────────────────────────────────────────────────
 *
 * Weblate sends a flat JSON body (Standard Webhooks schema):
 *   {
 *     "change_id":  12345,
 *     "action":     "Changes pushed",      // human-readable, not reliable for routing
 *     "timestamp":  "2026-04-12T20:47:43+00:00",
 *     "project":    "micado",
 *     "component":  "categories",          // ← slug = our category / Gitea folder
 *     "translation": "it"                  // ← language code
 *   }
 *
 * ── Standard Webhooks signature ───────────────────────────────────────────────
 *
 * Headers:
 *   webhook-id:        <uuid hex>
 *   webhook-timestamp: <unix timestamp float>
 *   webhook-signature: v1,<base64(HMAC-SHA256(secret, "{id}.{ts}.{body}"))>
 *
 * The secret in Weblate is stored as "whsec_<base64>" — the "whsec_" prefix is
 * stripped and the remainder is base64-decoded before use as the HMAC key.
 * Set WEBLATE_WEBHOOK_SECRET to the raw base64 value (with or without "whsec_").
 * Leave empty to disable signature checking during testing.
 *
 * ── Log tags to search for ────────────────────────────────────────────────────
 *
 *   [WeblateWebhook] REGISTERED     — at boot, confirms route is live
 *   [WeblateWebhook] INCOMING       — every POST received
 *   [WeblateWebhook] parsed         — extracted component + lang
 *   [WeblateWebhook] catalog loaded — how many items Gitea returned
 *   [WeblateWebhook] signaled       — per-item DBOS signal result
 *   [WeblateWebhook] complete       — call summary
 *
 * ── Manual test via curl ──────────────────────────────────────────────────────
 *
 *   curl -X POST http://localhost:3000/api/webhooks/weblate/translation-complete \
 *     -H 'Content-Type: application/json' \
 *     -d '{"change_id":1,"action":"Changes pushed","timestamp":"2026-01-01T00:00:00+00:00",
 *          "project":"micado","component":"user-types","translation":"it"}'
 */

import {
    post,
    Request,
    RestBindings,
    requestBody,
    HttpErrors,
} from '@loopback/rest';
import { inject } from '@loopback/core';
import { authenticate } from '@loopback/authentication';
//import { authorize } from '@loopback/authorization';
import { LoggingBindings } from '@loopback/logging';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'winston';
import { TranslationWorkflowOrchestratorService } from '../../services/translation-workflow-orchestrator.service';
import { GiteaTranslationImportService } from '../../services/gitea-translation-import.service';
// ── Weblate 5.16 webhook payload (Standard Webhooks schema) ──────────────────
interface WeblateWebhookBody {
    /** Weblate Change pk */
    change_id?: number;
    /** Human-readable action name e.g. "Changes pushed", "Changes committed" */
    action?: string;
    /** ISO 8601 timestamp */
    timestamp?: string;
    /** Project slug */
    project?: string;
    /** Component slug — this IS our Gitea folder / category name */
    component?: string;
    /** Language code e.g. "it", "fr" — present on translation-level events */
    translation?: string;
    /** Translation URL in Weblate UI */
    url?: string;
    /** Username of the author */
    author?: string;
    /** Username of the acting user */
    user?: string;
}

export class WeblateWebhookController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,

        @inject(TranslationWorkflowOrchestratorService.BINDING)
        private readonly orchestrator: TranslationWorkflowOrchestratorService,

        @inject('services.GiteaTranslationImportService')
        private readonly giteaImport: GiteaTranslationImportService,
    ) {
        // Logged once at boot — confirms the route is registered.
        // If you DON'T see this in backend logs on startup, the controller
        // was not picked up by the boot artifact (check controllers/index.ts).
        this.logger.info(
            '[WeblateWebhook] REGISTERED — POST /api/webhooks/weblate/translation-complete',
        );
        this.logger.info(
            `[WeblateWebhook] Signature: ${process.env.WEBLATE_WEBHOOK_SECRET?.trim() ? 'ENABLED (Standard Webhooks)' : 'DISABLED — set WEBLATE_WEBHOOK_SECRET to enable'}`,
        );
        this.logger.info(
            '[WeblateWebhook] Listening for ActionEvents: 17=COMMIT, 18=PUSH',
        );
    }

    @post('/api/webhooks/weblate/translation-complete')
    // REQUIRED: without this the DENY-by-default auth policy rejects with 401
    // before the method body runs — producing zero logs.
    @authenticate.skip()
    // REQUIRED: tells the custom RoleAuthorizerProvider to ALLOW without a principal.
    // The authorizer checks allowedRoles.includes('$everyone') first, before
    // requiring a principal — see src/auth/role.authorizer.ts case 1.
    // @authorize({ allowedRoles: ['$everyone'] })
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Weblate Standard Webhooks POST body',
            required: false,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                },
            },
        })
        body: WeblateWebhookBody,
    ): Promise<{ ok: boolean; message?: string }> {

        const tag = '[WeblateWebhook]';

        // ── 1. Log everything immediately — visible even if processing fails ──────
        this.logger.info(`${tag} INCOMING  remote=${req.ip}`);
        this.logger.info(
            `${tag} headers  webhook-id=${req.headers['webhook-id'] ?? '(none)'}` +
            `  webhook-timestamp=${req.headers['webhook-timestamp'] ?? '(none)'}` +
            `  webhook-signature=${this.maskSecret(String(req.headers['webhook-signature'] ?? ''))}`,
        );
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);

        // ── 2. Standard Webhooks signature verification ───────────────────────────
        // Weblate signs: "{webhook-id}.{webhook-timestamp}.{body}"
        // Secret: base64-decoded after stripping "whsec_" prefix
        const rawSecret = process.env.WEBLATE_WEBHOOK_SECRET?.trim() ?? '';
        if (rawSecret) {
            const msgId = req.headers['webhook-id'];
            const msgTs = req.headers['webhook-timestamp'];
            const sigHeader = req.headers['webhook-signature'];

            if (!msgId || !msgTs || !sigHeader) {
                this.logger.warn(
                    `${tag} REJECTED — missing Standard Webhooks headers` +
                    `  id=${!!msgId} ts=${!!msgTs} sig=${!!sigHeader}`,
                );
                throw new HttpErrors.Forbidden('Missing webhook signature headers');
            }

            const bodyStr = JSON.stringify(body);
            const valid = this.verifyStandardWebhook(
                String(msgId),
                String(msgTs),
                bodyStr,
                String(sigHeader),
                rawSecret,
            );

            if (!valid) {
                this.logger.warn(`${tag} REJECTED — signature mismatch`);
                throw new HttpErrors.Forbidden('Invalid webhook signature');
            }
            this.logger.info(`${tag} signature OK`);
        } else {
            this.logger.warn(`${tag} signature check DISABLED`);
        }

        // ── 3. Extract routing fields from the flat Weblate 5.16 payload ─────────
        // component → Gitea folder = our category slug
        // translation → language code
        const compSlug = body?.component ?? null;
        const langCode = body?.translation ?? null;
        const action = body?.action ?? '(none)';

        this.logger.info(
            `${tag} parsed  action="${action}"  component=${compSlug ?? '(missing)'}` +
            `  translation=${langCode ?? '(missing)'}  url=${body?.url ?? '(none)'}`,
        );

        // ── 4. Only process events that have a translation language ───────────────
        // COMMIT (17) may not have a translation field — only the PUSH (18) event
        // for a specific language does. We only need to act when we know which
        // language was pushed.
        if (!compSlug) {
            this.logger.warn(`${tag} SKIPPED — no component in payload. action="${action}"`);
            return { ok: true, message: 'no component — skipped' };
        }

        if (!langCode) {
            // COMMIT events are component-level and lack a translation code.
            // We still log them but don't try to pull translations yet.
            this.logger.info(
                `${tag} NOTED — no translation language in payload (probably a COMMIT event).` +
                `  action="${action}"  component=${compSlug}. Waiting for PUSH event.`,
            );
            return { ok: true, message: 'no translation language — noted, waiting for push' };
        }

        // ── 5. Component slug = Gitea folder = category ───────────────────────────
        const category = compSlug;

        // ── 6. Pull translated catalog from Gitea ─────────────────────────────────
        this.logger.info(
            `${tag} fetching Gitea catalog  category=${category}  lang=${langCode}`,
        );

        let catalogEntries: Record<string, Record<string, string>>;
        try {
            catalogEntries = await this.giteaImport.loadTranslatedFields({
                category,
                isoCode: langCode,
            });
        } catch (err) {
            this.logger.error(
                `${tag} Gitea fetch FAILED  category=${category}  lang=${langCode}  error=${String(err)}`,
            );
            return { ok: true, message: 'gitea fetch failed — logged' };
        }

        const itemCount = Object.keys(catalogEntries).length;
        this.logger.info(
            `${tag} catalog loaded  category=${category}  lang=${langCode}  items=${itemCount}`,
        );
        this.logger.debug(`${tag} catalog=${JSON.stringify(catalogEntries)}`);

        if (itemCount === 0) {
            this.logger.warn(
                `${tag} catalog is empty — no items to signal.` +
                `  This is expected until the backend pushes real translation keys.`,
            );
            return { ok: true, message: 'empty catalog — no items to signal' };
        }

        // ── 7. Signal DBOS child workflows ────────────────────────────────────────
        let signaled = 0;
        let skipped = 0;
        let errors = 0;

        for (const [itemId, fields] of Object.entries(catalogEntries)) {
            try {
                const result = await this.orchestrator.signalTranslationReceivedByItemId({
                    category,
                    itemId,
                    lang: langCode,
                    fields,
                });

                if (result.signaled) {
                    this.logger.info(
                        `${tag} signaled  category=${category}  itemId=${itemId}` +
                        `  lang=${langCode}  revisionId=${result.revisionId}`,
                    );
                    signaled++;
                } else {
                    this.logger.warn(
                        `${tag} no workflow  category=${category}  itemId=${itemId}` +
                        `  lang=${langCode}  reason=${result.reason}`,
                    );
                    skipped++;
                }
            } catch (err) {
                this.logger.error(
                    `${tag} signal FAILED  category=${category}  itemId=${itemId}` +
                    `  lang=${langCode}  error=${String(err)}`,
                );
                errors++;
            }
        }

        this.logger.info(
            `${tag} complete  category=${category}  lang=${langCode}` +
            `  total=${itemCount}  signaled=${signaled}  skipped=${skipped}  errors=${errors}`,
        );

        return { ok: true };
    }

    // ── Standard Webhooks signature verification ──────────────────────────────────
    //
    // Algorithm (from Standard Webhooks spec):
    //   key    = base64_decode(secret.removeprefix("whsec_"))
    //   toSign = "{msgId}.{timestamp}.{body}"
    //   sig    = base64_encode(HMAC-SHA256(key, toSign))
    //
    // Header format: "v1,<base64>"  (may contain multiple signatures: "v1,<a> v1,<b>")
    //
    private verifyStandardWebhook(
        msgId: string,
        timestamp: string,
        body: string,
        sigHeader: string,
        rawSecret: string,
    ): boolean {
        try {
            // Strip optional "whsec_" prefix and base64-decode the secret
            const secretB64 = rawSecret.replace(/^whsec_/, '');
            const key = Buffer.from(secretB64, 'base64');

            const toSign = `${msgId}.${timestamp}.${body}`;
            const expected = createHmac('sha256', key).update(toSign).digest('base64');

            // Header may contain multiple signatures separated by spaces
            const signatures = sigHeader.split(' ');
            for (const sig of signatures) {
                // Format: "v1,<base64>"
                const commaIdx = sig.indexOf(',');
                if (commaIdx === -1) continue;
                const version = sig.slice(0, commaIdx);
                const received = sig.slice(commaIdx + 1);
                if (version !== 'v1') continue;

                // Constant-time comparison
                const expectedBuf = Buffer.from(expected, 'base64');
                const receivedBuf = Buffer.from(received, 'base64');
                if (expectedBuf.length === receivedBuf.length &&
                    timingSafeEqual(expectedBuf, receivedBuf)) {
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }

    private maskSecret(value: string): string {
        if (!value || value.length <= 8) return value ? '****' : '(none)';
        return `${value.slice(0, 6)}...(len=${value.length})`;
    }
}