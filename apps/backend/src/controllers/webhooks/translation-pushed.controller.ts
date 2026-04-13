/**
 * src/controllers/webhooks/translation-pushed.controller.ts
 *
 * Receives Weblate PUSH webhook events (ActionEvents.PUSH = 18).
 *
 * ── What this does ────────────────────────────────────────────────────────────
 *
 *  1. Generate a unique workerHash for this invocation
 *  2. SELECT FOR UPDATE SKIP LOCKED — claim all NEW staging rows for this component
 *  3. For each claimed row (component + lang): pull the Gitea catalog and
 *     signal the matching DBOS child workflow
 *  4. DELETE all rows with this workerHash (success path)
 *
 * If the handler crashes before step 4, rows remain in PROCESSING status.
 * A background cleanup (or the next push event) resets them to NEW after a
 * timeout. See WeblateCommitEventRepository.resetStuckEvents().
 *
 * ── Why this is safe with concurrent pushes ───────────────────────────────────
 *
 * SKIP LOCKED means two concurrent push handlers for the same component get
 * disjoint row sets. Each processes its own rows and deletes by its own
 * workerHash. They never interfere.
 *
 * ── Weblate payload shape (5.16, ActionEvents.PUSH = 18) ─────────────────────
 *
 *   {
 *     "change_id":  215,
 *     "action":     "Changes pushed",
 *     "timestamp":  "2026-04-12T22:06:23.406880+00:00",
 *     "url":        "/projects/micado/categories/",
 *     "user":       "admin",
 *     "project":    "micado",
 *     "component":  "categories"   ← language is absent (push is component-level)
 *   }
 *
 * ── Addon configuration ───────────────────────────────────────────────────────
 *
 *   Installed:  project-level (ONE addon for all components)
 *   Events:     [18]  (ActionEvents.PUSH only)
 *   URL:        http://backend:3000/api/webhooks/weblate/translation-pushed
 */

import { post, Request, RestBindings, requestBody } from '@loopback/rest';
import { inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { authenticate } from '@loopback/authentication';
//import { authorize } from '@loopback/authorization';
import { LoggingBindings } from '@loopback/logging';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { WeblateCommitEventRepository } from '../../repositories/weblate-commit-event.repository';
import { GiteaTranslationImportService } from '../../services/gitea-translation-import.service';
import { TranslationWorkflowOrchestratorService } from '../../services/translation-workflow-orchestrator.service';

interface WeblatePushBody {
    change_id?: number;
    action?: string;
    timestamp?: string;
    project?: string;
    component?: string;
    url?: string;
    user?: string;
    [key: string]: unknown;
}

export class TranslationPushedController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,

        @repository(WeblateCommitEventRepository)
        private readonly commitEventRepo: WeblateCommitEventRepository,

        @inject('services.GiteaTranslationImportService')
        private readonly giteaImport: GiteaTranslationImportService,

        @inject(TranslationWorkflowOrchestratorService.BINDING)
        private readonly orchestrator: TranslationWorkflowOrchestratorService,
    ) {
        this.logger.info(
            '[WeblatePush] REGISTERED — POST /api/webhooks/weblate/translation-pushed',
        );
    }

    @post('/api/webhooks/weblate/translation-pushed')
    @authenticate.skip()
    //@authorize({ allowedRoles: ['$everyone'] })
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Weblate PUSH webhook body',
            required: false,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                },
            },
        })
        body: WeblatePushBody,
    ): Promise<{ ok: boolean; processed?: number; signaled?: number; message?: string }> {

        const tag = '[WeblatePush]';

        this.logger.info(`${tag} INCOMING  remote=${req.ip}`);
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);

        const component = body?.component ?? null;

        if (!component) {
            this.logger.warn(`${tag} SKIPPED — no component in push payload`);
            return { ok: true, message: 'no component — skipped' };
        }

        // ── Step 1: Generate worker identity ──────────────────────────────────
        const workerHash = randomUUID();

        this.logger.info(
            `${tag} starting  component=${component}  workerHash=${workerHash}`,
        );

        // ── Step 2: Atomically claim all NEW staging rows for this component ──
        let claimedRows: Awaited<ReturnType<typeof this.commitEventRepo.claimNewEvents>>;
        try {
            claimedRows = await this.commitEventRepo.claimNewEvents(component, workerHash);
        } catch (err) {
            this.logger.error(
                `${tag} DB claim FAILED  component=${component}  workerHash=${workerHash}` +
                `  error=${String(err)}`,
            );
            return { ok: true, message: 'db claim failed — logged' };
        }

        if (claimedRows.length === 0) {
            this.logger.info(
                `${tag} no staged commits for component=${component} — nothing to do`,
            );
            return { ok: true, processed: 0, signaled: 0 };
        }

        this.logger.info(
            `${tag} claimed ${claimedRows.length} staged commit(s)` +
            `  component=${component}  workerHash=${workerHash}` +
            `  langs=[${claimedRows.map(r => r.lang).join(',')}]`,
        );

        // ── Step 3: Process each claimed row ──────────────────────────────────
        // Each row corresponds to one (component, lang) commit event.
        // Now that Gitea has been pushed, we fetch the translated catalog
        // and signal the DBOS child workflow.
        const category = component; // component slug = Gitea folder = category
        let signaled = 0;
        let skipped = 0;
        let errors = 0;

        for (const row of claimedRows) {
            const rowTag = `${tag}[${row.lang}|${row.changeId}]`;

            this.logger.info(
                `${rowTag} processing  category=${category}  lang=${row.lang}` +
                `  changeId=${row.changeId}  weblateTs=${row.weblateTs}`,
            );

            // ── 3a. Pull translated catalog from Gitea ─────────────────────────
            let catalogEntries: Record<string, Record<string, string>>;
            try {
                catalogEntries = await this.giteaImport.loadTranslatedFields({
                    category,
                    isoCode: row.lang,
                });
            } catch (err) {
                this.logger.error(
                    `${rowTag} Gitea fetch FAILED  error=${String(err)}`,
                );
                errors++;
                continue;
            }

            const itemCount = Object.keys(catalogEntries).length;
            this.logger.info(
                `${rowTag} catalog loaded  items=${itemCount}`,
            );
            this.logger.debug(`${rowTag} catalog=${JSON.stringify(catalogEntries)}`);

            if (itemCount === 0) {
                this.logger.warn(
                    `${rowTag} empty catalog — no items to signal.` +
                    ` Expected until backend pushes real translation keys.`,
                );
                skipped++;
                continue;
            }

            // ── 3b. Signal each item's DBOS child workflow ─────────────────────
            for (const [itemId, fields] of Object.entries(catalogEntries)) {
                try {
                    const result = await this.orchestrator.signalTranslationReceivedByItemId({
                        category,
                        itemId,
                        lang: row.lang,
                        fields,
                    });

                    if (result.signaled) {
                        this.logger.info(
                            `${rowTag} signaled  itemId=${itemId}` +
                            `  revisionId=${result.revisionId}`,
                        );
                        signaled++;
                    } else {
                        this.logger.warn(
                            `${rowTag} no active workflow  itemId=${itemId}` +
                            `  reason=${result.reason}`,
                        );
                        skipped++;
                    }
                } catch (err) {
                    this.logger.error(
                        `${rowTag} signal FAILED  itemId=${itemId}  error=${String(err)}`,
                    );
                    errors++;
                }
            }
        }

        // ── Step 4: Delete processed rows ─────────────────────────────────────
        // Only delete rows with OUR workerHash — rows claimed by concurrent
        // push handlers (or new rows that arrived during processing) are untouched.
        let deleted = 0;
        try {
            deleted = await this.commitEventRepo.deleteByWorkerHash(workerHash);
            this.logger.info(
                `${tag} deleted ${deleted} row(s)  workerHash=${workerHash}`,
            );
        } catch (err) {
            // Log but don't fail — rows will be reset by resetStuckEvents later
            this.logger.error(
                `${tag} DB delete FAILED  workerHash=${workerHash}  error=${String(err)}`,
            );
        }

        this.logger.info(
            `${tag} complete  component=${component}  workerHash=${workerHash}` +
            `  claimed=${claimedRows.length}  signaled=${signaled}` +
            `  skipped=${skipped}  errors=${errors}  deleted=${deleted}`,
        );

        return { ok: true, processed: claimedRows.length, signaled };
    }
}