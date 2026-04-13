/**
 * src/controllers/webhooks/translation-pushed.controller.ts
 *
 * Receives Weblate PUSH webhook events (ActionEvents.PUSH = 18).
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 * The PUSH event signals that Weblate has written translated strings to Gitea.
 * At this point the Gitea catalog is guaranteed to be up-to-date.
 *
 * This handler:
 *  1. Claims ALL NEW rows from weblate_commit_event regardless of component.
 *     The `component` field in the PUSH webhook payload is unreliable —
 *     Weblate may report any component for a project-level push. Each staged
 *     row carries its own reliable (component, lang) from the COMMIT event.
 *
 *  2. For each claimed row, reads the translated catalog from Gitea using
 *     the (component, lang) from the row itself.
 *
 *  3. For each item in the catalog, extracts revisionId and sourceHash from
 *     the Gitea catalog meta (written by pushSourceFieldsToGitea in
 *     translation.steps.ts). Uses these to signal the DBOS child workflow
 *     DIRECTLY — without using the in-memory active workflow registry.
 *     This survives server restarts correctly.
 *
 *  4. Falls back to the registry-based path (signalTranslationReceivedByItemId)
 *     for items whose Gitea catalog was written before the meta fields were added.
 *
 *  5. Deletes all rows claimed by this worker (by workerHash) after processing.
 *     Concurrent push handlers use SKIP LOCKED — they get disjoint row sets.
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
 *     "component":  "categories"   ← NOT RELIABLE — do not use for routing
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
import { authorize } from '@loopback/authorization';
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
    /** NOT reliable for routing — present but may be wrong component slug */
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
    @authorize({ allowedRoles: ['$everyone'] })
    async receive(
        @inject(RestBindings.Http.REQUEST) req: Request,
        @requestBody({
            description: 'Weblate PUSH webhook body (ActionEvents.PUSH = 18)',
            required: false,
            content: {
                'application/json': {
                    schema: { type: 'object', additionalProperties: true },
                },
            },
        })
        body: WeblatePushBody,
    ): Promise<{ ok: boolean; claimed?: number; signaled?: number; message?: string }> {

        const tag = '[WeblatePush]';

        this.logger.info(`${tag} INCOMING  remote=${req.ip}`);
        this.logger.info(`${tag} body=${JSON.stringify(body)}`);
        // Note: body.component is logged for diagnostics but NOT used for routing
        this.logger.info(
            `${tag} push event — will claim ALL new staged commits` +
            `  (ignoring body.component='${body?.component ?? '(none)'}' — unreliable)`,
        );

        // ── Step 1: Generate unique worker identity ────────────────────────────
        const workerHash = randomUUID();

        this.logger.info(`${tag} workerHash=${workerHash}`);

        // ── Step 2: Claim ALL NEW staging rows (no component filter) ─────────
        // SKIP LOCKED means concurrent pushes get disjoint row sets.
        // Each row carries its own (component, lang) from the original COMMIT event.
        let claimedRows: Awaited<ReturnType<typeof this.commitEventRepo.claimNewEvents>>;
        try {
            claimedRows = await this.commitEventRepo.claimNewEvents(workerHash);
        } catch (err) {
            this.logger.error(
                `${tag} DB claim FAILED  workerHash=${workerHash}  error=${String(err)}`,
            );
            return { ok: true, message: 'db claim failed — logged' };
        }

        if (claimedRows.length === 0) {
            this.logger.info(`${tag} no staged commits to process — nothing to do`);
            return { ok: true, claimed: 0, signaled: 0 };
        }

        this.logger.info(
            `${tag} claimed ${claimedRows.length} row(s)  workerHash=${workerHash}` +
            `  rows=${JSON.stringify(claimedRows.map(r => `${r.component}/${r.lang}`))}`,
        );

        // ── Step 3: Process each claimed row ──────────────────────────────────
        let signaled = 0;
        let skipped = 0;
        let errors = 0;

        for (const row of claimedRows) {
            const rowTag = `${tag}[${row.component}/${row.lang}|${row.changeId}]`;

            this.logger.info(
                `${rowTag} processing  component=${row.component}  lang=${row.lang}` +
                `  changeId=${row.changeId}  weblateTs=${row.weblateTs}`,
            );

            // ── 3a. Read translated catalog from Gitea ─────────────────────────
            // Use component+lang from the ROW (from the COMMIT event), not from
            // the PUSH body — the row values are always correct.
            let catalogItems: Record<string, {
                fields: Record<string, string>;
                revisionId: string | null;
                sourceHash: string | null;
            }>;

            try {
                catalogItems = await this.giteaImport.loadTranslatedFieldsWithMeta({
                    category: row.component,   // component slug = Gitea folder = category
                    isoCode: row.lang,
                });
            } catch (err) {
                this.logger.error(`${rowTag} Gitea fetch FAILED  error=${String(err)}`);
                errors++;
                continue;
            }

            const itemCount = Object.keys(catalogItems).length;
            this.logger.info(`${rowTag} catalog loaded  items=${itemCount}`);
            this.logger.debug(`${rowTag} catalog=${JSON.stringify(catalogItems)}`);

            if (itemCount === 0) {
                this.logger.warn(
                    `${rowTag} empty catalog — no items to signal.` +
                    ` Normal until backend pushes real translation keys via approval flow.`,
                );
                skipped++;
                continue;
            }

            // ── 3b. Signal DBOS child workflow per catalog item ────────────────
            for (const [itemId, item] of Object.entries(catalogItems)) {
                const itemTag = `${rowTag}[item=${itemId}]`;

                this.logger.info(
                    `${itemTag} revisionId=${item.revisionId ?? '(null)'}` +
                    `  sourceHash=${item.sourceHash ?? '(null)'}` +
                    `  fieldKeys=${JSON.stringify(Object.keys(item.fields))}`,
                );

                if (!item.revisionId || !item.sourceHash) {
                    // Catalog was pushed before meta was added — fall back to
                    // registry-based lookup (works if server hasn't restarted).
                    this.logger.warn(
                        `${itemTag} no revisionId/sourceHash in Gitea meta — ` +
                        `falling back to registry lookup (may fail after restart)`,
                    );

                    try {
                        const result = await this.orchestrator.signalTranslationReceivedByItemId({
                            category: row.component,
                            itemId,
                            lang: row.lang,
                            fields: item.fields,
                        });

                        if (result.signaled) {
                            this.logger.info(
                                `${itemTag} signaled via registry  revisionId=${result.revisionId}`,
                            );
                            signaled++;
                        } else {
                            this.logger.warn(
                                `${itemTag} registry lookup failed  reason=${result.reason}` +
                                ` — re-push source to Gitea to write meta fields`,
                            );
                            skipped++;
                        }
                    } catch (err) {
                        this.logger.error(`${itemTag} registry signal FAILED  error=${String(err)}`);
                        errors++;
                    }
                    continue;
                }

                // ── Primary path: signal directly by revisionId (no registry needed) ──
                try {
                    await this.orchestrator.signalTranslationByRevisionId({
                        revisionId: item.revisionId,
                        lang: row.lang,
                        sourceHash: item.sourceHash,
                        fields: item.fields,
                    });

                    this.logger.info(
                        `${itemTag} signaled directly  revisionId=${item.revisionId}`,
                    );
                    signaled++;
                } catch (err) {
                    this.logger.error(
                        `${itemTag} direct signal FAILED  revisionId=${item.revisionId}` +
                        `  error=${String(err)}`,
                    );
                    errors++;
                }
            }
        }

        // ── Step 4: Delete processed rows by workerHash ────────────────────────
        // Only touches rows this worker claimed — concurrent handlers unaffected.
        let deleted = 0;
        try {
            deleted = await this.commitEventRepo.deleteByWorkerHash(workerHash);
            this.logger.info(`${tag} deleted ${deleted} row(s)  workerHash=${workerHash}`);
        } catch (err) {
            // Non-fatal — rows stay as PROCESSING and will be reset by resetStuckEvents
            this.logger.error(
                `${tag} DB delete FAILED  workerHash=${workerHash}  error=${String(err)}`,
            );
        }

        this.logger.info(
            `${tag} complete  workerHash=${workerHash}` +
            `  claimed=${claimedRows.length}  signaled=${signaled}` +
            `  skipped=${skipped}  errors=${errors}  deleted=${deleted}`,
        );

        return { ok: true, claimed: claimedRows.length, signaled };
    }
}