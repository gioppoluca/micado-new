/**
 * src/api/event.api.ts
 *
 * HTTP calls for the /events-migrant public endpoint.
 *
 * ── Backend contract ──────────────────────────────────────────────────────────
 *
 *   GET /events-migrant
 *     ?defaultlang=it&currentlang=it
 *     &categoryId=1
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
 *     startDate   string          — ISO 8601 datetime
 *     endDate     string          — ISO 8601 datetime
 *     location    string | null   — venue / address free text
 *     cost        string | null   — cost string (null when isFree=true)
 *     isFree      boolean         — true if the event is free to attend
 *     categoryId  number | null   — linked category id (subtype='event')
 *     topicIds    number[]        — linked topic ids
 *     userTypeIds number[]        — linked user-type ids
 *
 * ── Language resolution ───────────────────────────────────────────────────────
 *
 *   Backend tries currentlang first (tStatus=PUBLISHED), then falls back to
 *   defaultlang.  Items with no PUBLISHED translation in either language are
 *   omitted.
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MigrantEvent {
    id: number;
    title: string;
    description: string | null;
    lang: string;
    /** ISO 8601 datetime string, e.g. "2025-06-15T10:00:00.000Z" */
    startDate: string;
    /** ISO 8601 datetime string */
    endDate: string;
    location: string | null;
    cost: string | null;
    isFree: boolean;
    categoryId: number | null;
    topicIds: number[];
    userTypeIds: number[];
}

export interface EventMigrantParams {
    defaultlang: string;
    currentlang: string;
    categoryId?: number;
    /** Comma-separated topic ids */
    topicIds?: string;
    /** Comma-separated user-type ids */
    userTypeIds?: string;
    page?: number;
    pageSize?: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const eventApi = {
    /**
     * Fetch published events in the requested language.
     * Unauthenticated — safe to call before Keycloak is initialised.
     */
    async listForMigrant(params: EventMigrantParams): Promise<MigrantEvent[]> {
        logger.info('[event.api] listForMigrant', params);
        return apiGet<MigrantEvent[]>('/events-migrant', { params });
    },

    /**
     * Fetch a single published event by its external key (numeric id).
     * Unauthenticated — enables direct URL access (bookmark, refresh, shared link)
     * without requiring the list to be loaded first.
     * Throws on 404 if the item is not found or has no published translation.
     */
    async getById(id: number, params: Pick<EventMigrantParams, 'defaultlang' | 'currentlang'>): Promise<MigrantEvent> {
        logger.info('[event.api] getById', { id, ...params });
        return apiGet<MigrantEvent>(`/events-migrant/${id}`, { params });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

const MOCK_EVENTS: MigrantEvent[] = [
    {
        id: 1,
        title: 'Welcome to the city — orientation day',
        description: 'A guided tour of essential city services for newcomers.',
        lang: 'en',
        startDate: '2025-07-01T09:00:00.000Z',
        endDate: '2025-07-01T13:00:00.000Z',
        location: 'City Hall, Room 5',
        cost: null,
        isFree: true,
        categoryId: 2,
        topicIds: [1, 2],
        userTypeIds: [1],
    },
    {
        id: 2,
        title: 'Italian language class',
        description: 'Beginner Italian course for adult migrants.',
        lang: 'en',
        startDate: '2025-07-08T18:00:00.000Z',
        endDate: '2025-07-08T20:00:00.000Z',
        location: 'Community Centre, Via Roma 12',
        cost: '€ 5',
        isFree: false,
        categoryId: 2,
        topicIds: [],
        userTypeIds: [],
    },
];

export function registerEventMocks(mock: MockRegistry): void {
    mock.onGet('/events-migrant').reply((config: MockRequestConfig): MockReplyTuple => {
        const params = config.params ?? {};
        let result = [...MOCK_EVENTS];

        const categoryId = params['categoryId'] !== undefined
            ? Number(params['categoryId'])
            : undefined;
        if (categoryId !== undefined) {
            result = result.filter(e => e.categoryId === categoryId);
        }

        const topicIds = params['topicIds']
            ? String(params['topicIds']).split(',').map(Number)
            : undefined;
        if (topicIds?.length) {
            result = result.filter(e => topicIds.every(tid => e.topicIds.includes(tid)));
        }

        const userTypeIds = params['userTypeIds']
            ? String(params['userTypeIds']).split(',').map(Number)
            : undefined;
        if (userTypeIds?.length) {
            result = result.filter(e => userTypeIds.every(uid => e.userTypeIds.includes(uid)));
        }

        const page = Number(params['page'] ?? 1);
        const pageSize = Math.min(Number(params['pageSize'] ?? 20), 100);
        const offset = (page - 1) * pageSize;
        const paged = result.slice(offset, offset + pageSize);

        logger.debug('[mock] GET /events-migrant', { count: paged.length, page, pageSize });
        return [200, paged];
    });

    // Single-item endpoint — matched by regex to capture the numeric id segment
    mock.onGet(/^\/events-migrant\/(\d+)$/).reply((config: MockRequestConfig): MockReplyTuple => {
        const id = Number(config.url?.split('/').pop());
        const found = MOCK_EVENTS.find(e => e.id === id);
        if (!found) {
            logger.debug('[mock] GET /events-migrant/:id — not found', { id });
            return [404, { error: { message: `Event ${id} not found or not published` } }];
        }
        logger.debug('[mock] GET /events-migrant/:id', { id });
        return [200, found];
    });

    logger.debug('[mock] event handlers registered');
}