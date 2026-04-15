/**
 * src/api/process.api.ts
 *
 * HTTP calls for the /processes-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /processes-migrant
 *     ?defaultlang=it&currentlang=it
 *     &topicIds=1,2
 *     &userTypeIds=1
 *     &page=1&pageSize=20
 *
 *   No authentication required (@authenticate.skip()).
 *
 *   Response shape (per item):
 *     id          number          — externalKey
 *     title       string          — translated title
 *     description string | null   — translated description (Markdown)
 *     lang        string          — actual language of the resolved translation
 *     topicIds    number[]        — linked topic ids
 *     userTypeIds number[]        — linked user-type ids
 *
 * ── Graph data ────────────────────────────────────────────────────────────────
 *
 *   The migrant endpoint returns only the process header (title, description,
 *   relations).  The interactive graph (steps + step-links) is available via
 *   GET /processes/:id/graph — this is an authenticated PA endpoint and is NOT
 *   served to the migrant frontend in the current architecture.
 *
 *   If the migrant app needs to render a read-only process graph in the future,
 *   a separate /processes-migrant/:id/graph endpoint should be added to the
 *   backend with @authenticate.skip() and served from this module.
 *
 * ── Pagination ────────────────────────────────────────────────────────────────
 *
 *   page     1-indexed (default 1)
 *   pageSize max 100  (default 20)
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MigrantProcess {
    id: number;
    title: string;
    description: string | null;
    lang: string;
    topicIds: number[];
    userTypeIds: number[];
}

export interface ProcessMigrantParams {
    defaultlang: string;
    currentlang: string;
    /** Comma-separated topic ids */
    topicIds?: string;
    /** Comma-separated user-type ids */
    userTypeIds?: string;
    page?: number;
    pageSize?: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const processApi = {
    /**
     * Fetch published processes in the requested language.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: ProcessMigrantParams): Promise<MigrantProcess[]> {
        logger.info('[process.api] listForMigrant', params);
        return apiGet<MigrantProcess[]>('/processes-migrant', { params });
    },

    /**
     * Fetch a single published process by its external key (numeric id).
     * Unauthenticated — enables direct URL access (bookmark, refresh, shared link)
     * without requiring the list to be loaded first.
     * Throws on 404 if the item is not found or has no published translation.
     */
    async getById(id: number, params: Pick<ProcessMigrantParams, 'defaultlang' | 'currentlang'>): Promise<MigrantProcess> {
        logger.info('[process.api] getById', { id, ...params });
        return apiGet<MigrantProcess>(`/processes-migrant/${id}`, { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_PROCESSES: MigrantProcess[] = [
    {
        id: 1,
        title: 'Apply for a residence permit',
        description: 'Step-by-step guide to submitting a residence permit application at the Questura.',
        lang: 'en',
        topicIds: [1],
        userTypeIds: [1],
    },
    {
        id: 2,
        title: 'Register with the National Health Service',
        description: 'How to register with a local GP and obtain your health card.',
        lang: 'en',
        topicIds: [2],
        userTypeIds: [1, 2],
    },
    {
        id: 3,
        title: 'Enrol children in school',
        description: 'The process for registering children in the Italian public school system.',
        lang: 'en',
        topicIds: [],
        userTypeIds: [1],
    },
];

export function registerProcessMocks(mock: MockRegistry): void {
    mock.onGet('/processes-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        const params = config.params ?? {};
        let result = [...MOCK_PROCESSES];

        const topicIds = params['topicIds']
            ? String(params['topicIds']).split(',').map(Number)
            : undefined;
        if (topicIds?.length) {
            result = result.filter(p => topicIds.every(tid => p.topicIds.includes(tid)));
        }

        const userTypeIds = params['userTypeIds']
            ? String(params['userTypeIds']).split(',').map(Number)
            : undefined;
        if (userTypeIds?.length) {
            result = result.filter(p => userTypeIds.every(uid => p.userTypeIds.includes(uid)));
        }

        const page = Number(params['page'] ?? 1);
        const pageSize = Math.min(Number(params['pageSize'] ?? 20), 100);
        const offset = (page - 1) * pageSize;
        const paged = result.slice(offset, offset + pageSize);

        logger.debug('[mock] GET /processes-migrant', { count: paged.length, page, pageSize });
        return [200, paged];
    });

    // Single-item endpoint — matched by regex to capture the numeric id segment
    mock.onGet(/^\/processes-migrant\/(\d+)$/).reply((config: MockRequestConfig): MockReplyTuple => {
        const id = Number(config.url?.split('/').pop());
        const found = MOCK_PROCESSES.find(p => p.id === id);
        if (!found) {
            logger.debug('[mock] GET /processes-migrant/:id — not found', { id });
            return [404, { error: { message: `Process ${id} not found or not published` } }];
        }
        logger.debug('[mock] GET /processes-migrant/:id', { id });
        return [200, found];
    });

    logger.debug('[mock] process handlers registered');
}