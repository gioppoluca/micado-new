/**
 * src/api/information.api.ts
 *
 * HTTP calls for the /information-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /information-migrant
 *     ?defaultlang=it&currentlang=it
 *     &categoryId=1
 *     &topicIds=1,2,3
 *     &userTypeIds=1,2
 *     &page=1&pageSize=20
 *
 *   No authentication required (@authenticate.skip()).
 *   All filter params are optional and AND-combined on the backend.
 *
 *   Response shape (per item):
 *     id          number          — externalKey (legacy numeric ID)
 *     title       string          — translated title
 *     description string | null   — translated body (Markdown via tiptap-markdown)
 *     lang        string          — actual language of the resolved translation
 *     categoryId  number | null   — linked category id
 *     topicIds    number[]        — linked topic ids
 *     userTypeIds number[]        — linked user-type ids
 *
 * ── Language resolution ───────────────────────────────────────────────────────
 *
 *   Backend tries currentlang first (tStatus=PUBLISHED), then falls back to
 *   defaultlang.  Items with no PUBLISHED translation in either language are
 *   omitted from the result set entirely.
 *
 * ── Pagination ────────────────────────────────────────────────────────────────
 *
 *   page     1-indexed (default 1)
 *   pageSize max 100  (default 20)
 *
 *   The backend does not return a total count on this endpoint.
 *   Detect end-of-list by checking response.length < pageSize.
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MigrantInformation {
    id: number;
    title: string;
    description: string | null;
    lang: string;
    categoryId: number | null;
    topicIds: number[];
    userTypeIds: number[];
}

export interface InformationMigrantParams {
    defaultlang: string;
    currentlang: string;
    categoryId?: number;
    /** Comma-separated topic ids, e.g. "1,2,3" */
    topicIds?: string;
    /** Comma-separated user-type ids, e.g. "1,2" */
    userTypeIds?: string;
    page?: number;
    pageSize?: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const informationApi = {
    /**
     * Fetch published information items in the requested language.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: InformationMigrantParams): Promise<MigrantInformation[]> {
        logger.info('[information.api] listForMigrant', params);
        return apiGet<MigrantInformation[]>('/information-migrant', { params });
    },

    /**
     * Fetch a single published information item by its external key (numeric id).
     * Unauthenticated — enables direct URL access (bookmark, refresh, shared link)
     * without requiring the list to be loaded first.
     * Throws on 404 if the item is not found or has no published translation.
     */
    async getById(id: number, params: Pick<InformationMigrantParams, 'defaultlang' | 'currentlang'>): Promise<MigrantInformation> {
        logger.info('[information.api] getById', { id, ...params });
        return apiGet<MigrantInformation>(`/information-migrant/${id}`, { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_INFORMATION: MigrantInformation[] = [
    {
        id: 1,
        title: 'How to apply for residence permit',
        description: 'Complete guide to the residence permit application process.\n\nYou will need the following documents...',
        lang: 'en',
        categoryId: 1,
        topicIds: [1],
        userTypeIds: [1],
    },
    {
        id: 2,
        title: 'Healthcare registration',
        description: 'Register with a local GP to access the national health service.',
        lang: 'en',
        categoryId: null,
        topicIds: [2],
        userTypeIds: [1, 2],
    },
    {
        id: 3,
        title: 'Finding a rental apartment',
        description: 'Practical tips for renting accommodation as a newcomer.',
        lang: 'en',
        categoryId: 1,
        topicIds: [1, 3],
        userTypeIds: [],
    },
];

export function registerInformationMocks(mock: MockRegistry): void {
    mock.onGet('/information-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        const params = config.params ?? {};
        let result = [...MOCK_INFORMATION];

        const categoryId = params['categoryId'] !== undefined
            ? Number(params['categoryId'])
            : undefined;
        if (categoryId !== undefined) {
            result = result.filter(i => i.categoryId === categoryId);
        }

        const topicIds = params['topicIds']
            ? String(params['topicIds']).split(',').map(Number)
            : undefined;
        if (topicIds?.length) {
            result = result.filter(i => topicIds.every(tid => i.topicIds.includes(tid)));
        }

        const userTypeIds = params['userTypeIds']
            ? String(params['userTypeIds']).split(',').map(Number)
            : undefined;
        if (userTypeIds?.length) {
            result = result.filter(i => userTypeIds.every(uid => i.userTypeIds.includes(uid)));
        }

        const page = Number(params['page'] ?? 1);
        const pageSize = Math.min(Number(params['pageSize'] ?? 20), 100);
        const offset = (page - 1) * pageSize;
        const paged = result.slice(offset, offset + pageSize);

        logger.debug('[mock] GET /information-migrant', { count: paged.length, page, pageSize });
        return [200, paged];
    });

    // Single-item endpoint — matched by regex to capture the numeric id segment
    mock.onGet(/^\/information-migrant\/(\d+)$/).reply((config: MockRequestConfig): MockReplyTuple => {
        const id = Number(config.url?.split('/').pop());
        const found = MOCK_INFORMATION.find(i => i.id === id);
        if (!found) {
            logger.debug('[mock] GET /information-migrant/:id — not found', { id });
            return [404, { error: { message: `Information ${id} not found or not published` } }];
        }
        logger.debug('[mock] GET /information-migrant/:id', { id });
        return [200, found];
    });

    logger.debug('[mock] information handlers registered');
}