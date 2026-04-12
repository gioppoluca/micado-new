/**
 * src/controllers/webhooks/weblate.controller.ts
 *
 * Receives the POST from the Weblate "weblate.webhook.webhook" add-on after
 * every EVENT_POST_COMMIT (integer 4) — i.e. when Weblate commits translated
 * strings to the Gitea repo.
 *
 * ── Why this endpoint must be public ─────────────────────────────────────────
 *
 * The application uses AuthorizationDecision.DENY by default.  Any endpoint
 * without @authenticate.skip() is rejected with 401 BEFORE the method body
 * runs — meaning zero logs and no processing.  Weblate sends no JWT token,
 * so this endpoint MUST be marked as public.  Security is provided by the
 * optional HMAC-SHA256 signature instead.
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/webhooks/weblate/translation-complete
 *
 * ── Weblate payload shape ─────────────────────────────────────────────────────
 *
 * Weblate's webhook addon sends a JSON body like:
 *
 *   {
 *     "component": { "slug": "user-types", "project": { "slug": "micado" } },
 *     "translation": {
 *       "language_code": "it",
 *       "component": { "slug": "user-types" },
 *       "web_url": "http://weblate.localhost/projects/micado/user-types/it/"
 *     },
 *     "event": "post_commit"
 *   }
 *
 * We extract compSlug + langCode, then pull the translated JSON from Gitea,
 * and signal the waiting DBOS child workflow for each item in the catalog.
 *
 * ── HMAC signature ────────────────────────────────────────────────────────────
 *
 * Set WEBLATE_WEBHOOK_SECRET on the backend container.  When set, the controller
 * validates the X-Weblate-Signature header (format: "sha256=<hex>").
 * Leave empty to disable signature checking (useful during initial testing).
 *
 * ── Sequence of log tags to look for ─────────────────────────────────────────
 *
 *   [WeblateWebhook] REGISTERED          ← logged at boot, confirms route is live
 *   [WeblateWebhook] INCOMING            ← logged on every POST
 *   [WeblateWebhook] parsed              ← shows extracted compSlug + langCode
 *   [WeblateWebhook] catalog loaded      ← shows how many items Gitea returned
 *   [WeblateWebhook] signaled            ← per-item DBOS signal result
 *   [WeblateWebhook] complete            ← summary of the whole call
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
import { authorize } from '@loopback/authorization';
import { LoggingBindings } from '@loopback/logging';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'winston';
import { TranslationWorkflowOrchestratorService } from '../../services/translation-workflow-orchestrator.service';
import { GiteaTranslationImportService } from '../../services/gitea-translation-import.service';

// ── Weblate webhook body shape ────────────────────────────────────────────────
// Only the fields we actually use — Weblate sends more.
interface WeblateWebhookBody {
    event?: string;
    component?: {
        slug?: string;
        project?: { slug?: string };
    };
    translation?: {
        language_code?: string;
        component?: { slug?: string };
        web_url?: string;
    };
    // Some Weblate versions send language as a string, others as an object
    language?: { code?: string } | string;
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
        // Log at construction time (happens once at boot) so you can confirm the
        // route is registered even before the first webhook arrives.
        this.logger.info(
            '[WeblateWebhook] REGISTERED — POST /api/webhooks/weblate/translation-complete is live',
        );
        this.logger.info(
            `[WeblateWebhook] Signature check: ${process.env.WEBLATE_WEBHOOK_SECRET?.trim() ? 'ENABLED' : 'DISABLED (set WEBLATE_WEBHOOK_SECRET to enable)'}`,
        );
    }

    // ── Endpoint ────────────────────────────────────────────────────────────────

    @post('/api/webhooks/weblate/translation-complete')
    // ↓ REQUIRED: without this, the DENY-by-default auth policy rejects the
    //   request with 401 before the method body runs — producing zero logs.
    @authenticate.skip()
    // ↓ REQUIRED alongside authenticate.skip() when the app uses
    //   AuthorizationComponent with defaultDecision DENY.
    @authorize({ allowedRoles: ['$everyone'] })
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Weblate webhook POST body',
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

        // ── 1. Log incoming request — visible at default log level ──────────────
        this.logger.info(`${tag} INCOMING POST /api/webhooks/weblate/translation-complete`);
        this.logger.info(`${tag} remote=${req.ip}  content-type=${req.headers['content-type'] ?? '(none)'}`);

        // Log all headers at debug level (too verbose for info)
        this.logger.debug(`${tag} headers=${JSON.stringify(req.headers)}`);

        // Log full body at info level — we WANT this visible during testing
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);

        // ── 2. HMAC signature verification ──────────────────────────────────────
        const secret = process.env.WEBLATE_WEBHOOK_SECRET?.trim() ?? '';
        if (secret) {
            const sigHeader = req.headers['x-weblate-signature'];
            if (!sigHeader) {
                this.logger.warn(`${tag} REJECTED — missing X-Weblate-Signature header`);
                throw new HttpErrors.Forbidden('Missing webhook signature');
            }
            const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

            // LoopBack already parsed the body — re-serialize for HMAC verification.
            // This matches what Weblate signed (compact JSON, sorted keys not required).
            const bodyForHmac = JSON.stringify(body);
            const valid = this.verifySignature(bodyForHmac, signature, secret);

            if (!valid) {
                this.logger.warn(
                    `${tag} REJECTED — signature mismatch ` +
                    `received=${this.maskSecret(signature)}`,
                );
                throw new HttpErrors.Forbidden('Invalid webhook signature');
            }
            this.logger.info(`${tag} signature OK`);
        } else {
            this.logger.warn(`${tag} signature check DISABLED (WEBLATE_WEBHOOK_SECRET not set)`);
        }

        // ── 3. Extract routing fields ────────────────────────────────────────────
        const compSlug = body?.translation?.component?.slug
            ?? body?.component?.slug
            ?? null;

        const langCode = this.extractLangCode(body);

        this.logger.info(
            `${tag} parsed  event=${body?.event ?? '(none)'}  ` +
            `compSlug=${compSlug ?? '(missing)'}  ` +
            `langCode=${langCode ?? '(missing)'}  ` +
            `webUrl=${body?.translation?.web_url ?? '(none)'}`,
        );

        if (!compSlug || !langCode) {
            this.logger.warn(
                `${tag} SKIPPED — compSlug or langCode missing.` +
                `  compSlug=${compSlug}  langCode=${langCode}` +
                `  Returning 200 to prevent Weblate retries.`,
            );
            return { ok: true, message: 'missing routing fields — logged and ignored' };
        }

        // ── 4. Component slug IS the Gitea folder / category ───────────────────
        // Convention set in gitea-init + weblate-init + GiteaTranslationExportService:
        //   Weblate component slug  = Gitea folder name = content-type category
        const category = compSlug;

        // ── 5. Pull translations from Gitea ─────────────────────────────────────
        this.logger.info(`${tag} fetching Gitea catalog  category=${category}  lang=${langCode}`);

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
            // Return 200 so Weblate doesn't retry — the DBOS child will timeout
            // after 7 days and can be manually replayed via the dev controller.
            return { ok: true, message: 'gitea fetch failed — logged' };
        }

        const itemCount = Object.keys(catalogEntries).length;
        this.logger.info(
            `${tag} catalog loaded  category=${category}  lang=${langCode}  items=${itemCount}`,
        );

        if (itemCount === 0) {
            this.logger.warn(
                `${tag} catalog is empty — no items to signal.` +
                `  category=${category}  lang=${langCode}` +
                `  This is expected until the backend pushes real translation keys.`,
            );
            return { ok: true, message: 'empty catalog — no items to signal' };
        }

        this.logger.debug(`${tag} catalog entries=${JSON.stringify(catalogEntries)}`);

        // ── 6. Signal each item's child workflow ─────────────────────────────────
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
                        `${tag} no active workflow  category=${category}  itemId=${itemId}` +
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

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private extractLangCode(body: WeblateWebhookBody | undefined): string | null {
        if (!body) return null;
        // translation.language_code is the most reliable (present in all versions)
        if (body.translation?.language_code) return body.translation.language_code;
        // Some versions put language as a nested object
        if (typeof body.language === 'object' && body.language?.code) return body.language.code;
        // Oldest versions send language as a plain string
        if (typeof body.language === 'string') return body.language;
        return null;
    }

    private verifySignature(payload: string, signature: string, secret: string): boolean {
        try {
            // Weblate format: "sha256=<hex>"
            const eqIdx = signature.indexOf('=');
            if (eqIdx === -1) return false;
            const algo = signature.slice(0, eqIdx);
            const receivedHex = signature.slice(eqIdx + 1);
            if (algo !== 'sha256' || !receivedHex) return false;

            const expected = createHmac('sha256', secret).update(payload).digest('hex');

            // Constant-time comparison prevents timing attacks
            const receivedBuf = Buffer.from(receivedHex, 'hex');
            const expectedBuf = Buffer.from(expected, 'hex');
            if (receivedBuf.length !== expectedBuf.length) return false;
            return timingSafeEqual(receivedBuf, expectedBuf);
        } catch {
            return false;
        }
    }

    private maskSecret(value: string): string {
        if (!value || value.length <= 8) return '****';
        return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
    }
}