/**
 * src/controllers/translation-monitor.controller.ts
 *
 * Production endpoint for the PA Settings → Translations monitor page.
 * Aggregates all active DBOS translation workflows into a single response
 * that the frontend can render without further API calls.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 *   @authenticate('keycloak')  — requires a valid Keycloak JWT
 *   @authorize pa_admin        — restricted to PA administrators
 *
 * ── Endpoint ─────────────────────────────────────────────────────────────────
 *   GET /api/translation-monitor
 *
 * ── Response shape ────────────────────────────────────────────────────────────
 *   {
 *     "generatedAt": "2026-04-13T10:00:00Z",
 *     "activeWorkflows": [
 *       {
 *         "registryKey":  "user-types:42",
 *         "category":     "user-types",
 *         "itemId":       "42",
 *         "revisionId":   "uuid",
 *         "startedAt":    "2026-04-13T09:00:00Z",
 *         "sourceFields": { "title": "...", "description": "..." },
 *         "targetLangs":  ["it","fr","ar"],
 *         "languages": {
 *           "it": { "status": "DONE",                "mp3Url": "https://..." },
 *           "fr": { "status": "WAITING_TRANSLATION",  "mp3Url": null },
 *           "ar": { "status": "ERROR",                "mp3Url": null }
 *         },
 *         "done": false
 *       }
 *     ],
 *     "stagedCommits": [
 *       {
 *         "id":         "uuid",
 *         "component":  "user-types",
 *         "lang":       "it",
 *         "changeId":   214,
 *         "status":     "NEW",
 *         "receivedAt": "2026-04-13T09:55:00Z"
 *       }
 *     ]
 *   }
 */

import { get } from '@loopback/rest';
import { inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { LoggingBindings } from '@loopback/logging';
import type { Logger } from 'winston';
import { TranslationWorkflowOrchestratorService } from '../services/translation-workflow-orchestrator.service';
import { WeblateCommitEventRepository } from '../repositories/weblate-commit-event.repository';

// ── Response types (also used by the Vue page for typing) ─────────────────────

export interface LangStatusEntry {
    status: string | null;
    mp3Url: string | null;
}

export interface WorkflowSummary {
    registryKey: string;
    category: string;
    itemId: string;
    revisionId: string;
    startedAt: string;
    sourceFields: Record<string, string>;
    targetLangs: string[];
    languages: Record<string, LangStatusEntry>;
    done: boolean;
}

export interface StagedCommitSummary {
    id: string;
    component: string;
    lang: string;
    changeId: number;
    action: string;
    status: string;
    receivedAt: string | undefined;
    weblateTs: string;
}

export interface TranslationMonitorResponse {
    generatedAt: string;
    activeWorkflows: WorkflowSummary[];
    stagedCommits: StagedCommitSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────

export class TranslationMonitorController {

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: Logger,

        @inject(TranslationWorkflowOrchestratorService.BINDING)
        private readonly orchestrator: TranslationWorkflowOrchestratorService,

        @repository(WeblateCommitEventRepository)
        private readonly commitEventRepo: WeblateCommitEventRepository,
    ) { }

    /**
     * GET /api/translation-monitor
     *
     * Returns a snapshot of all active translation workflows and the staging
     * table contents. Designed to be called by the PA monitor page with a
     * 30-second polling interval.
     *
     * DBOS status queries run in parallel (one per active workflow) to keep
     * latency bounded regardless of how many workflows are active.
     */
    @get('/api/translation-monitor')
    @authenticate('keycloak')
    @authorize({ allowedRoles: ['pa_admin'] })
    async getMonitorSnapshot(): Promise<TranslationMonitorResponse> {
        const generatedAt = new Date().toISOString();
        this.logger.info('[TranslationMonitor] snapshot requested');

        // ── 1. Read in-memory registry ─────────────────────────────────────
        const registry = this.orchestrator.getActiveWorkflowRegistry();
        const registryEntries = Object.entries(registry);

        // ── 2. Fetch DBOS status for all active workflows in parallel ──────
        const workflowSummaries = await Promise.all(
            registryEntries.map(async ([registryKey, entry]) => {

                let revisionStatus;
                try {
                    revisionStatus = await this.orchestrator.getRevisionStatus(
                        entry.revisionId,
                        entry.targetLangs,
                    );
                } catch (err) {
                    this.logger.warn('[TranslationMonitor] getRevisionStatus failed', {
                        registryKey,
                        revisionId: entry.revisionId,
                        error: String(err),
                    });
                    revisionStatus = {
                        revisionId: entry.revisionId,
                        done: false,
                        languages: Object.fromEntries(
                            entry.targetLangs.map(lang => [lang, { status: 'ERROR', mp3Url: null }])
                        ),
                    };
                }

                return {
                    registryKey,
                    category: entry.category,
                    itemId: entry.itemId,
                    revisionId: entry.revisionId,
                    startedAt: entry.startedAt,
                    sourceFields: entry.sourceFields,
                    targetLangs: entry.targetLangs,
                    languages: revisionStatus.languages,
                    done: revisionStatus.done,
                } satisfies WorkflowSummary;
            }),
        );

        // Sort: in-progress first, then done
        workflowSummaries.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return a.startedAt < b.startedAt ? 1 : -1; // newest first within group
        });

        // ── 3. Read staging table ──────────────────────────────────────────
        let stagedRows: StagedCommitSummary[] = [];
        try {
            const rows = await this.commitEventRepo.find({
                order: ['receivedAt DESC'],
                limit: 200,
            });
            stagedRows = rows.map(r => ({
                id: r.id ?? '',
                component: r.component,
                lang: r.lang,
                changeId: r.changeId,
                action: r.action,
                status: r.status,
                receivedAt: r.receivedAt,
                weblateTs: r.weblateTs,
            }));
        } catch (err) {
            this.logger.warn('[TranslationMonitor] staged commits query failed', {
                error: String(err),
            });
        }

        this.logger.info('[TranslationMonitor] snapshot complete', {
            activeWorkflows: workflowSummaries.length,
            stagedCommits: stagedRows.length,
        });

        return { generatedAt, activeWorkflows: workflowSummaries, stagedCommits: stagedRows };
    }
}