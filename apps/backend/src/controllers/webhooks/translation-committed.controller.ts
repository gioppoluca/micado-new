/**
 * src/controllers/webhooks/translation-committed.controller.ts
 *
 * Receives Weblate COMMIT webhook events (ActionEvents.COMMIT = 17).
 *
 * ── What this does ────────────────────────────────────────────────────────────
 *
 * Stores the incoming payload in the weblate_commit_event staging table
 * with status = 'NEW'. Does nothing else — processing happens when the
 * corresponding PUSH event arrives at /translation-pushed.
 *
 * ── Why decouple commit from push? ───────────────────────────────────────────
 *
 * A COMMIT event fires per-translation (one per language) and arrives BEFORE
 * Weblate pushes to Gitea. Gitea does not have the translated strings yet at
 * this point. The PUSH event fires later (asynchronously via Celery) and
 * signals that Gitea now has the final content. By staging COMMIT events and
 * acting only on PUSH, we guarantee the Gitea catalog is ready when we read it.
 *
 * ── Weblate payload shape (5.16, ActionEvents.COMMIT = 17) ───────────────────
 *
 *   {
 *     "change_id":  214,
 *     "action":     "Changes committed",
 *     "timestamp":  "2026-04-12T22:06:03.057841+00:00",
 *     "url":        "/projects/micado/information/it/",
 *     "author":     "admin",
 *     "user":       "admin",
 *     "project":    "micado",
 *     "component":  "information",
 *     "translation": "it"          ← language code, always present for COMMIT
 *   }
 *
 * ── Addon configuration ───────────────────────────────────────────────────────
 *
 *   Installed:  per-component (one per content-type category)
 *   Events:     [17]  (ActionEvents.COMMIT only)
 *   URL:        http://backend:3000/api/webhooks/weblate/translation-committed
 */

import { post, Request, RestBindings, requestBody } from '@loopback/rest';
import { inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { authenticate } from '@loopback/authentication';
//import { authorize } from '@loopback/authorization';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';
import { WeblateCommitEventRepository } from '../../repositories/weblate-commit-event.repository';

interface WeblateCommitBody {
    change_id?: number;
    action?: string;
    timestamp?: string;
    project?: string;
    component?: string;
    translation?: string;
    url?: string;
    author?: string;
    user?: string;
    [key: string]: unknown;
}

export class TranslationCommittedController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,

        @repository(WeblateCommitEventRepository)
        private readonly commitEventRepo: WeblateCommitEventRepository,
    ) {
        this.logger.info(
            '[WeblateCommit] REGISTERED — POST /api/webhooks/weblate/translation-committed',
        );
    }

    @post('/api/webhooks/weblate/translation-committed')
    @authenticate.skip()
    //@authorize({ allowedRoles: ['$everyone'] })
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Weblate COMMIT webhook body',
            required: false,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                },
            },
        })
        body: WeblateCommitBody,
    ): Promise<{ ok: boolean; id?: string; message?: string }> {

        const tag = '[WeblateCommit]';

        this.logger.info(`${tag} INCOMING  remote=${req.ip}`);
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);

        // ── Validate required routing fields ──────────────────────────────────
        const { component, translation: lang, project, change_id, action, timestamp } = body ?? {};

        if (!component || !lang) {
            this.logger.warn(
                `${tag} SKIPPED — missing component or translation.` +
                `  component=${component}  lang=${lang}` +
                `  (COMMIT events should always have both — check addon configuration)`,
            );
            return { ok: true, message: 'missing component or translation — skipped' };
        }

        if (!change_id) {
            this.logger.warn(`${tag} SKIPPED — missing change_id`);
            return { ok: true, message: 'missing change_id — skipped' };
        }

        // ── Store in staging table ────────────────────────────────────────────
        try {
            const saved = await this.commitEventRepo.create({
                payload: body as Record<string, unknown>,
                project: project ?? 'unknown',
                component,
                lang,
                changeId: change_id,
                action: action ?? 'Changes committed',
                status: 'NEW',
                weblateTs: timestamp ?? new Date().toISOString(),
            });

            this.logger.info(
                `${tag} stored  id=${saved.id}  component=${component}` +
                `  lang=${lang}  changeId=${change_id}`,
            );

            return { ok: true, id: saved.id };

        } catch (err) {
            this.logger.error(
                `${tag} DB insert FAILED  component=${component}  lang=${lang}` +
                `  error=${String(err)}`,
            );
            // Return 200 so Weblate does not retry — we log the failure
            return { ok: true, message: 'db insert failed — logged' };
        }
    }
}