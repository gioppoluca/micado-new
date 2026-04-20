/**
 * src/api/event.api.ts
 *
 * HTTP calls for the /events resource.
 *
 * ── Two DTO shapes ───────────────────────────────────────────────────────────
 *
 *   Event (flat/legacy)
 *     id, title, description, status, sourceLang
 *     dataExtra: { startDate, endDate, location, cost, isFree }
 *     categoryId, categoryTitle, topicIds[], userTypeIds[]
 *     Used by: GET /events list, POST /events response.
 *
 *   EventFull (rich)
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /events/:id (form open), PUT /events/:id (save).
 *
 * ── Filters (AND-combined) ───────────────────────────────────────────────────
 *
 *   categoryId  — single event category id
 *   topicIds    — comma-separated string "1,2,3"
 *   userTypeIds — comma-separated string "1,2"
 *   page        — 1-indexed (default 1)
 *   pageSize    — items per page (default 20, max 100)
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET    /events?...           list (filtered + paginated) → Event[]
 *   GET    /events/count?...     count (same filters, no pagination)
 *   POST   /events               create → Event
 *   GET    /events/to-production?id=  publish
 *   GET    /events/:id           form open → EventFull
 *   PUT    /events/:id           form save → 204
 *   PATCH  /events/:id           partial → 204
 *   DELETE /events/:id           delete → 204
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

export interface EventDataExtra {
    startDate?: string;   // ISO 8601
    endDate?: string;     // ISO 8601
    location?: string;
    cost?: string | null;
    isFree?: boolean;
}

/** Flat DTO returned by list and create. */
export interface Event {
    id: number;
    title: string;
    description: string;
    status: EventStatus;
    sourceLang: string;
    dataExtra: EventDataExtra;
    categoryId: number | null;
    topicIds: number[];
    userTypeIds: number[];
    /** Resolved category label — omitted (not present) when uncategorised. */
    categoryTitle?: string;
}

/** Per-language translation entry. */
export interface EventTranslation {
    title: string;
    description: string;
    tStatus?: TranslationStatus;
}

export interface RevisionSummary {
    revisionNo: number;
    status: EventStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/** Rich DTO with all translations. Returned by GET /:id, sent by PUT /:id. */
export interface EventFull {
    id?: number;
    status?: EventStatus;
    sourceLang?: string;
    dataExtra?: EventDataExtra;
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    translations?: Record<string, EventTranslation>;
    revisions?: RevisionSummary[];
}

export interface EventListFilter {
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    page?: number;
    pageSize?: number;
}

export type CreateEventPayload = {
    title?: string;
    description?: string;
    sourceLang?: string;
    dataExtra?: EventDataExtra;
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchEventPayload = {
    status?: EventStatus;
    sourceLang?: string;
    dataExtra?: Partial<EventDataExtra>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function eventStatusKey(e: Pick<Event, 'status'>): string {
    switch (e.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

/** Serialise filter to query params. topicIds and userTypeIds as comma-separated. */
function buildParams(filter: EventListFilter): Record<string, string | number> {
    const p: Record<string, string | number> = {};
    if (filter.categoryId != null) p['categoryId'] = filter.categoryId;
    if (filter.topicIds?.length) p['topicIds'] = filter.topicIds.join(',');
    if (filter.userTypeIds?.length) p['userTypeIds'] = filter.userTypeIds.join(',');
    if (filter.page) p['page'] = filter.page;
    if (filter.pageSize) p['pageSize'] = filter.pageSize;
    return p;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const eventApi = {

    async list(filter: EventListFilter = {}): Promise<Event[]> {
        logger.info('[event.api] list', filter);
        return apiGet<Event[]>('/events', { params: buildParams(filter) });
    },

    async count(filter: EventListFilter = {}): Promise<number> {
        logger.info('[event.api] count', filter);
        const res = await apiGet<{ count: number }>('/events/count', { params: buildParams(filter) });
        return res.count;
    },

    async getOne(id: number): Promise<EventFull> {
        logger.info('[event.api] getOne', { id });
        return apiGet<EventFull>(`/events/${id}`);
    },

    async create(payload: CreateEventPayload): Promise<Event> {
        logger.info('[event.api] create', { title: payload.title });
        return apiPost<Event>('/events', payload);
    },

    async save(id: number, payload: EventFull): Promise<void> {
        logger.info('[event.api] save', {
            id, langs: Object.keys(payload.translations ?? {}),
        });
        return apiPut<void>(`/events/${id}`, payload);
    },

    async patch(id: number, payload: PatchEventPayload): Promise<void> {
        logger.info('[event.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/events/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[event.api] remove', { id });
        return apiDelete(`/events/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[event.api] publish', { id });
        await apiGet<unknown>('/events/to-production', { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 200;

let mockStore: Event[] = [
    {
        id: 1, title: 'Corso di italiano', description: 'Corso **gratuito** di italiano.',
        status: 'PUBLISHED', sourceLang: 'it',
        dataExtra: { startDate: '2025-06-15T09:00:00.000Z', endDate: '2025-06-15T12:00:00.000Z', location: 'Centro Civico, Via Roma 1', isFree: true, cost: null },
        categoryId: 1, categoryTitle: 'Integrazione', topicIds: [1, 2], userTypeIds: [1],
    },
    {
        id: 2, title: 'Microcredito per startup', description: 'Presentazione dei programmi.',
        status: 'APPROVED', sourceLang: 'it',
        dataExtra: { startDate: '2025-07-10T14:00:00.000Z', endDate: '2025-07-10T17:00:00.000Z', location: 'Camera di Commercio', isFree: false, cost: '€ 10' },
        categoryId: 2, categoryTitle: 'Microcredito', topicIds: [2], userTypeIds: [1, 2],
    },
    {
        id: 3, title: 'Orientamento sanitario', description: 'Accesso ai servizi sanitari.',
        status: 'DRAFT', sourceLang: 'it',
        dataExtra: { startDate: '2025-08-05T10:00:00.000Z', endDate: '2025-08-05T12:00:00.000Z', location: '', isFree: true, cost: null },
        categoryId: null, topicIds: [], userTypeIds: [2, 3],
    },
];

const mockFull: Partial<Record<number, EventFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it',
        dataExtra: { startDate: '2025-06-15T09:00:00.000Z', endDate: '2025-06-15T12:00:00.000Z', location: 'Centro Civico, Via Roma 1', isFree: true, cost: null },
        categoryId: 1, topicIds: [1, 2], userTypeIds: [1],
        translations: {
            it: { title: 'Corso di italiano', description: 'Corso **gratuito** di italiano.', tStatus: 'PUBLISHED' },
            en: { title: 'Italian course', description: 'Free Italian course.', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it',
        dataExtra: { startDate: '2025-07-10T14:00:00.000Z', endDate: '2025-07-10T17:00:00.000Z', location: 'Camera di Commercio', isFree: false, cost: '€ 10' },
        categoryId: 2, topicIds: [2], userTypeIds: [1, 2],
        translations: {
            it: { title: 'Microcredito per startup', description: 'Presentazione dei programmi.', tStatus: 'DRAFT' },
            en: { title: 'Microcredit for startups', description: 'Programme presentation.', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-02-01T00:00:00Z', createdByName: 'Admin' }],
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'it',
        dataExtra: { startDate: '2025-08-05T10:00:00.000Z', endDate: '2025-08-05T12:00:00.000Z', location: '', isFree: true, cost: null },
        categoryId: null, topicIds: [], userTypeIds: [2, 3],
        translations: {
            it: { title: 'Orientamento sanitario', description: 'Accesso ai servizi sanitari.', tStatus: 'DRAFT' },
        },
        revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: '2024-03-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

export function registerEventMocks(mock: MockRegistry): void {

    // GET /events/count — before /events/:id
    mock.onGet('/events/count').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        return [200, { count: filtered.length }];
    });

    // GET /events/to-production — before /events/:id
    mock.onGet('/events/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(e => e.id === id);
        if (idx === -1) return [404, { error: { message: `Event ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        logger.debug('[mock] GET /events/to-production', { id });
        return [200, {}];
    });

    // GET /events/:id — rich
    mock.onGet(/\/events\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            const flat = mockStore.find(e => e.id === id);
            if (!flat) return [404, { error: { message: `Event ${id} not found` } }];
            return [200, {
                id: flat.id, status: flat.status, sourceLang: flat.sourceLang,
                dataExtra: flat.dataExtra, categoryId: flat.categoryId,
                topicIds: flat.topicIds, userTypeIds: flat.userTypeIds,
                translations: { [flat.sourceLang]: { title: flat.title, description: flat.description ?? '', tStatus: 'DRAFT' } },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: new Date().toISOString(), createdByName: 'System' }],
            }];
        }
        return [200, { ...found, translations: { ...found.translations }, topicIds: [...(found.topicIds ?? [])], userTypeIds: [...(found.userTypeIds ?? [])] }];
    });

    // GET /events — list with filters + pagination
    mock.onGet('/events').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        const page = Number(cfg.params?.['page'] ?? 1);
        const pageSize = Math.min(Number(cfg.params?.['pageSize'] ?? 20), 100);
        const start = (page - 1) * pageSize;
        const paginated = filtered.slice(start, start + pageSize);
        logger.debug('[mock] GET /events', { total: filtered.length, page, pageSize, returned: paginated.length });
        return [200, paginated];
    });

    // POST /events
    mock.onPost('/events').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateEventPayload> = body ? JSON.parse(body) : {};
        const srcLang = input.sourceLang ?? 'it';
        const srcTitle = input.translations?.[srcLang]?.title ?? input.title ?? 'Nuovo evento';
        const newItem: Event = {
            id: _nextId++,
            title: srcTitle,
            description: input.translations?.[srcLang]?.description ?? input.description ?? '',
            status: 'DRAFT',
            sourceLang: srcLang,
            dataExtra: input.dataExtra ?? {},
            categoryId: input.categoryId ?? null,
            topicIds: input.topicIds ?? [],
            userTypeIds: input.userTypeIds ?? [],
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id, status: 'DRAFT', sourceLang: srcLang,
            dataExtra: input.dataExtra ?? {}, categoryId: input.categoryId ?? null,
            topicIds: input.topicIds ?? [], userTypeIds: input.userTypeIds ?? [],
            translations: input.translations
                ? Object.fromEntries(Object.entries(input.translations).map(([l, c]) => [
                    l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                ]))
                : { [srcLang]: { title: srcTitle, description: input.description ?? '', tStatus: 'DRAFT' } },
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'System' }],
        };
        logger.debug('[mock] POST /events created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PUT /events/:id
    mock.onPut(/\/events\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: EventFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(e => e.id === id);
        if (idx === -1) return [404, { error: { message: `Event ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        mockStore[idx] = {
            ...mockStore[idx]!,
            title: srcTr?.title ?? mockStore[idx]!.title,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
            dataExtra: full.dataExtra ?? mockStore[idx]!.dataExtra,
            categoryId: full.categoryId ?? null,
            topicIds: full.topicIds ?? [],
            userTypeIds: full.userTypeIds ?? [],
        };

        const updatedTrs: Record<string, EventTranslation> = {
            ...(mockFull[id]?.translations ?? {}),
            ...Object.fromEntries(Object.entries(full.translations ?? {}).map(([l, c]) => [
                l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
            ])),
        };
        if (full.status === 'APPROVED') {
            for (const lang of Object.keys(updatedTrs)) {
                if (lang !== srcLang) {
                    updatedTrs[lang] = { ...updatedTrs[lang]!, tStatus: 'STALE' };
                }
            }
        }
        mockFull[id] = { ...mockFull[id], ...full, translations: updatedTrs };
        return [204];
    });

    // PATCH /events/:id
    mock.onPatch(/\/events\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(e => e.id === id);
        if (idx === -1) return [404, { error: { message: `Event ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: PatchEventPayload = body ? JSON.parse(body) : {};
        if (p.status) mockStore[idx] = { ...mockStore[idx] as Event, status: p.status };
        if (p.dataExtra) mockStore[idx] = { ...mockStore[idx] as Event, dataExtra: { ...mockStore[idx]!.dataExtra, ...p.dataExtra } };
        if (mockFull[id] && p.status) mockFull[id].status = p.status;
        return [204];
    });

    // DELETE /events/:id
    mock.onDelete(/\/events\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(e => e.id !== id);
        delete mockFull[id];
        return [204];
    });

    logger.debug('[mock] event handlers registered');
}

/** Apply mock-side filters (AND semantics). */
function applyMockFilters(cfg: MockRequestConfig): Event[] {
    const categoryId = cfg.params?.['categoryId'] != null ? Number(cfg.params['categoryId']) : undefined;
    const topicIds = cfg.params?.['topicIds']
        ? String(cfg.params['topicIds']).split(',').map(Number)
        : undefined;
    const userTypeIds = cfg.params?.['userTypeIds']
        ? String(cfg.params['userTypeIds']).split(',').map(Number)
        : undefined;

    return mockStore.filter(e => {
        if (categoryId !== undefined && e.categoryId !== categoryId) return false;
        if (topicIds?.length && !topicIds.every(tid => e.topicIds.includes(tid))) return false;
        if (userTypeIds?.length && !userTypeIds.every(uid => e.userTypeIds.includes(uid))) return false;
        return true;
    });
}