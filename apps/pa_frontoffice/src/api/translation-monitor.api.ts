/**
 * src/api/translation-monitor.api.ts
 *
 * HTTP calls for GET /api/translation-monitor.
 * Auth: keycloak JWT required (pa_admin only on the backend).
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types (mirror backend TranslationMonitorController exports) ──────────────

export type TranslationStatus =
    | 'WAITING_TRANSLATION'
    | 'RECEIVED_TRANSLATION'
    | 'GENERATING_MP3'
    | 'SAVING_TO_DB'
    | 'DONE'
    | 'TIMEOUT'
    | 'ERROR';

export interface LangStatusEntry {
    status: TranslationStatus | null;
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
    status: 'NEW' | 'PROCESSING';
    receivedAt: string | undefined;
    weblateTs: string;
}

export interface TranslationMonitorSnapshot {
    generatedAt: string;
    activeWorkflows: WorkflowSummary[];
    stagedCommits: StagedCommitSummary[];
}

// ─── API call ─────────────────────────────────────────────────────────────────

export const translationMonitorApi = {
    async getSnapshot(): Promise<TranslationMonitorSnapshot> {
        logger.info('[translation-monitor.api] getSnapshot');
        return apiGet<TranslationMonitorSnapshot>('/api/translation-monitor');
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_SNAPSHOT: TranslationMonitorSnapshot = {
    generatedAt: new Date().toISOString(),
    activeWorkflows: [
        {
            registryKey: 'information:12',
            category: 'information',
            itemId: '12',
            revisionId: 'aabbcc00-0000-0000-0000-000000000001',
            startedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
            sourceFields: { title: 'Nuove informazioni', description: 'Testo di esempio' },
            targetLangs: ['it', 'fr', 'ar'],
            languages: {
                it: { status: 'DONE', mp3Url: null },
                fr: { status: 'WAITING_TRANSLATION', mp3Url: null },
                ar: { status: 'WAITING_TRANSLATION', mp3Url: null },
            },
            done: false,
        },
        {
            registryKey: 'user-types:7',
            category: 'user-types',
            itemId: '7',
            revisionId: 'aabbcc00-0000-0000-0000-000000000002',
            startedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
            sourceFields: { title: 'Famiglia con figli', description: '' },
            targetLangs: ['it', 'fr', 'ar'],
            languages: {
                it: { status: 'DONE', mp3Url: 'https://example.com/mp3/it.mp3' },
                fr: { status: 'DONE', mp3Url: 'https://example.com/mp3/fr.mp3' },
                ar: { status: 'DONE', mp3Url: 'https://example.com/mp3/ar.mp3' },
            },
            done: true,
        },
        {
            registryKey: 'categories:3',
            category: 'categories',
            itemId: '3',
            revisionId: 'aabbcc00-0000-0000-0000-000000000003',
            startedAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
            sourceFields: { title: 'Sanità', description: 'Servizi sanitari per migranti' },
            targetLangs: ['it', 'fr', 'ar'],
            languages: {
                it: { status: 'GENERATING_MP3', mp3Url: null },
                fr: { status: 'WAITING_TRANSLATION', mp3Url: null },
                ar: { status: 'ERROR', mp3Url: null },
            },
            done: false,
        },
    ],
    stagedCommits: [
        {
            id: 'staged-1',
            component: 'information',
            lang: 'fr',
            changeId: 214,
            action: 'Changes committed',
            status: 'NEW',
            receivedAt: new Date(Date.now() - 1000 * 45).toISOString(),
            weblateTs: new Date(Date.now() - 1000 * 50).toISOString(),
        },
        {
            id: 'staged-2',
            component: 'information',
            lang: 'ar',
            changeId: 215,
            action: 'Changes committed',
            status: 'NEW',
            receivedAt: new Date(Date.now() - 1000 * 43).toISOString(),
            weblateTs: new Date(Date.now() - 1000 * 48).toISOString(),
        },
    ],
};

export function registerTranslationMonitorMocks(mock: MockRegistry): void {
    mock.onGet('/api/translation-monitor').reply((_config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /api/translation-monitor', _config);
        // Refresh generatedAt each call so the UI shows a live timestamp
        return [200, { ...MOCK_SNAPSHOT, generatedAt: new Date().toISOString() }];
    });
    logger.debug('[mock] translation-monitor handlers registered');
}