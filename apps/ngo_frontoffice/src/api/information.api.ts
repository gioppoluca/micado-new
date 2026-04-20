/**
 * src/api/information.api.ts
 *
 * HTTP calls for the /information resource (Useful Information Centre).
 *
 * ── Difference from event.api.ts ─────────────────────────────────────────────
 *
 *   Information items have NO non-translatable metadata:
 *     • No startDate / endDate
 *     • No location
 *     • No cost / isFree
 *
 *   The data_extra field is not present in any DTO —
 *   the DB stores it as {} for CRT conformance but we never expose it.
 *
 * ── Two DTO shapes ───────────────────────────────────────────────────────────
 *
 *   Information (flat)
 *     id, title, description, status, sourceLang
 *     categoryId, categoryTitle, topicIds[], userTypeIds[]
 *     Used by: GET /information list, POST /information response.
 *
 *   InformationFull (rich)
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /information/:id, PUT /information/:id.
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET    /information?...          list (filtered + paginated) → Information[]
 *   GET    /information/count?...    count
 *   POST   /information              create → Information
 *   GET    /information/to-production?id=  publish
 *   GET    /information/:id          form open → InformationFull
 *   PUT    /information/:id          form save → 204
 *   PATCH  /information/:id          partial → 204
 *   DELETE /information/:id          delete → 204
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type InformationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/** Flat DTO returned by list and create. */
export interface Information {
    id: number;
    title: string;
    description: string;
    status: InformationStatus;
    sourceLang: string;
    categoryId: number | null;
    topicIds: number[];
    userTypeIds: number[];
    /** Resolved category label — omitted when uncategorised. */
    categoryTitle?: string;
}

export interface InformationTranslation {
    title: string;
    description: string;
    tStatus?: TranslationStatus;
}

export interface RevisionSummary {
    revisionNo: number;
    status: InformationStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/** Rich DTO with all translations. Returned by GET /:id, sent by PUT /:id. */
export interface InformationFull {
    id?: number;
    status?: InformationStatus;
    sourceLang?: string;
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    translations?: Record<string, InformationTranslation>;
    revisions?: RevisionSummary[];
}

export interface InformationListFilter {
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    page?: number;
    pageSize?: number;
}

export type CreateInformationPayload = {
    title?: string;
    description?: string;
    sourceLang?: string;
    categoryId?: number | null;
    topicIds?: number[];
    userTypeIds?: number[];
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchInformationPayload = {
    status?: InformationStatus;
    sourceLang?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function informationStatusKey(i: Pick<Information, 'status'>): string {
    switch (i.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

function buildParams(filter: InformationListFilter): Record<string, string | number> {
    const p: Record<string, string | number> = {};
    if (filter.categoryId != null) p['categoryId'] = filter.categoryId;
    if (filter.topicIds?.length) p['topicIds'] = filter.topicIds.join(',');
    if (filter.userTypeIds?.length) p['userTypeIds'] = filter.userTypeIds.join(',');
    if (filter.page) p['page'] = filter.page;
    if (filter.pageSize) p['pageSize'] = filter.pageSize;
    return p;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const informationApi = {

    async list(filter: InformationListFilter = {}): Promise<Information[]> {
        logger.info('[information.api] list', filter);
        return apiGet<Information[]>('/information', { params: buildParams(filter) });
    },

    async count(filter: InformationListFilter = {}): Promise<number> {
        logger.info('[information.api] count', filter);
        const res = await apiGet<{ count: number }>('/information/count', { params: buildParams(filter) });
        return res.count;
    },

    async getOne(id: number): Promise<InformationFull> {
        logger.info('[information.api] getOne', { id });
        return apiGet<InformationFull>(`/information/${id}`);
    },

    async create(payload: CreateInformationPayload): Promise<Information> {
        logger.info('[information.api] create', { title: payload.title });
        return apiPost<Information>('/information', payload);
    },

    async save(id: number, payload: InformationFull): Promise<void> {
        logger.info('[information.api] save', {
            id, langs: Object.keys(payload.translations ?? {}),
        });
        return apiPut<void>(`/information/${id}`, payload);
    },

    async patch(id: number, payload: PatchInformationPayload): Promise<void> {
        logger.info('[information.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/information/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[information.api] remove', { id });
        return apiDelete(`/information/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[information.api] publish', { id });
        await apiGet<unknown>('/information/to-production', { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 300;

let mockStore: Information[] = [
    {
        id: 1,
        title: 'Come ottenere il permesso di soggiorno',
        description: 'Guida completa per ottenere il **permesso di soggiorno**.',
        status: 'PUBLISHED',
        sourceLang: 'it',
        categoryId: 1,
        categoryTitle: 'Documenti',
        topicIds: [1, 2],
        userTypeIds: [1],
    },
    {
        id: 2,
        title: 'Accesso al sistema sanitario',
        description: 'Come accedere ai servizi sanitari in Italia.',
        status: 'APPROVED',
        sourceLang: 'it',
        categoryId: null,
        topicIds: [3],
        userTypeIds: [1, 2],
    },
    {
        id: 3,
        title: 'Iscrizione anagrafica',
        description: 'Come iscriversi all\'anagrafe comunale.',
        status: 'DRAFT',
        sourceLang: 'it',
        categoryId: 1,
        categoryTitle: 'Documenti',
        topicIds: [],
        userTypeIds: [2],
    },
];

/**
 * Rich records for GET /:id.
 * NOTE: mutations use object spread { ...existing, field: newValue }
 * to avoid the forbidden non-null-assertion-assignment pattern.
 */
const mockFull: Partial<Record<number, InformationFull>> = {
    1: {
        id: 1,
        status: 'PUBLISHED',
        sourceLang: 'it',
        categoryId: 1,
        topicIds: [1, 2],
        userTypeIds: [1],
        translations: {
            it: { title: 'Come ottenere il permesso di soggiorno', description: 'Guida completa per ottenere il **permesso di soggiorno**.', tStatus: 'PUBLISHED' },
            en: { title: 'How to get a residence permit', description: 'Complete guide to getting a **residence permit**.', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2,
        status: 'APPROVED',
        sourceLang: 'it',
        categoryId: null,
        topicIds: [3],
        userTypeIds: [1, 2],
        translations: {
            it: { title: 'Accesso al sistema sanitario', description: 'Come accedere ai servizi sanitari in Italia.', tStatus: 'DRAFT' },
            en: { title: 'Access to the health system', description: 'How to access health services in Italy.', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-02-01T00:00:00Z', createdByName: 'Admin' }],
    },
    3: {
        id: 3,
        status: 'DRAFT',
        sourceLang: 'it',
        categoryId: 1,
        topicIds: [],
        userTypeIds: [2],
        translations: {
            it: { title: 'Iscrizione anagrafica', description: 'Come iscriversi all\'anagrafe comunale.', tStatus: 'DRAFT' },
        },
        revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: '2024-03-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

export function registerInformationMocks(mock: MockRegistry): void {

    // GET /information/count — before /information/:id
    mock.onGet('/information/count').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        return [200, { count: filtered.length }];
    });

    // GET /information/to-production — before /information/:id
    mock.onGet('/information/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(i => i.id === id);
        if (idx === -1) return [404, { error: { message: `Information ${id} not found` } }];
        // Correct: replace whole entry, never mutate in place with !.
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        const existing = mockFull[id];
        if (existing) {
            mockFull[id] = { ...existing, status: 'PUBLISHED' };
        }
        logger.debug('[mock] GET /information/to-production', { id });
        return [200, {}];
    });

    // GET /information/:id — rich
    mock.onGet(/\/information\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            const flat = mockStore.find(i => i.id === id);
            if (!flat) return [404, { error: { message: `Information ${id} not found` } }];
            return [200, {
                id: flat.id,
                status: flat.status,
                sourceLang: flat.sourceLang,
                categoryId: flat.categoryId,
                topicIds: flat.topicIds,
                userTypeIds: flat.userTypeIds,
                translations: {
                    [flat.sourceLang]: {
                        title: flat.title,
                        description: flat.description,
                        tStatus: 'DRAFT',
                    },
                },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: new Date().toISOString(), createdByName: 'System' }],
            }];
        }
        return [200, {
            ...found,
            translations: { ...found.translations },
            topicIds: [...(found.topicIds ?? [])],
            userTypeIds: [...(found.userTypeIds ?? [])],
        }];
    });

    // GET /information — list with filters + pagination
    mock.onGet('/information').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        const page = Number(cfg.params?.['page'] ?? 1);
        const pageSize = Math.min(Number(cfg.params?.['pageSize'] ?? 20), 100);
        const start = (page - 1) * pageSize;
        const paginated = filtered.slice(start, start + pageSize);
        logger.debug('[mock] GET /information', {
            total: filtered.length, page, pageSize, returned: paginated.length,
        });
        return [200, paginated];
    });

    // POST /information
    mock.onPost('/information').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateInformationPayload> = body ? JSON.parse(body) : {};
        const srcLang = input.sourceLang ?? 'it';
        const srcTitle = input.translations?.[srcLang]?.title ?? input.title ?? 'Nuova informazione';
        const srcDesc = input.translations?.[srcLang]?.description ?? input.description ?? '';

        const newItem: Information = {
            id: _nextId++,
            title: srcTitle,
            description: srcDesc,
            status: 'DRAFT',
            sourceLang: srcLang,
            categoryId: input.categoryId ?? null,
            topicIds: input.topicIds ?? [],
            userTypeIds: input.userTypeIds ?? [],
        };
        mockStore.push(newItem);

        mockFull[newItem.id] = {
            id: newItem.id,
            status: 'DRAFT',
            sourceLang: srcLang,
            categoryId: input.categoryId ?? null,
            topicIds: input.topicIds ?? [],
            userTypeIds: input.userTypeIds ?? [],
            translations: input.translations
                ? Object.fromEntries(
                    Object.entries(input.translations).map(([l, c]) => [
                        l,
                        { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                    ]),
                )
                : { [srcLang]: { title: srcTitle, description: srcDesc, tStatus: 'DRAFT' } },
            revisions: [{
                revisionNo: 1,
                status: 'DRAFT',
                createdAt: new Date().toISOString(),
                createdByName: 'System',
            }],
        };

        logger.debug('[mock] POST /information created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PUT /information/:id
    mock.onPut(/\/information\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: InformationFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(i => i.id === id);
        if (idx === -1) return [404, { error: { message: `Information ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        const newStatus = full.status ?? mockStore[idx]!.status;

        // Correct: always replace with spread, never mutate in place
        mockStore[idx] = {
            ...mockStore[idx]!,
            title: srcTr?.title ?? mockStore[idx]!.title,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: newStatus,
            sourceLang: srcLang,
            categoryId: full.categoryId ?? null,
            topicIds: full.topicIds ?? [],
            userTypeIds: full.userTypeIds ?? [],
        };

        // Merge translations: existing + new entries from PUT body
        const prevTrs = mockFull[id]?.translations ?? {};
        const updatedTrs: Record<string, InformationTranslation> = {
            ...prevTrs,
            ...Object.fromEntries(
                Object.entries(full.translations ?? {}).map(([l, c]) => [
                    l,
                    { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                ]),
            ),
        };
        // Mark non-source as STALE when APPROVED
        if (newStatus === 'APPROVED') {
            for (const lang of Object.keys(updatedTrs)) {
                if (lang !== srcLang) {
                    const tr = updatedTrs[lang];
                    if (tr) {
                        updatedTrs[lang] = { ...tr, tStatus: 'STALE' };
                    }
                }
            }
        }

        // Correct: replace whole mockFull entry with spread
        mockFull[id] = {
            ...mockFull[id],
            ...full,
            translations: updatedTrs,
        };

        return [204];
    });

    // PATCH /information/:id
    mock.onPatch(/\/information\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const patch: PatchInformationPayload = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(i => i.id === id);
        if (idx === -1) return [404, { error: { message: `Information ${id} not found` } }];

        // Correct: replace whole store entry with spread
        mockStore[idx] = {
            ...mockStore[idx]!,
            ...(patch.status && { status: patch.status }),
        };

        // Correct: replace whole full entry with spread — no !. mutation
        const existing = mockFull[id];
        if (existing && patch.status) {
            mockFull[id] = { ...existing, status: patch.status };
        }

        return [204];
    });

    // DELETE /information/:id
    mock.onDelete(/\/information\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(i => i.id !== id);
        delete mockFull[id];
        return [204];
    });

    logger.debug('[mock] information handlers registered');
}

/** Apply AND-combined mock-side filters. */
function applyMockFilters(cfg: MockRequestConfig): Information[] {
    const categoryId = cfg.params?.['categoryId'] != null
        ? Number(cfg.params['categoryId'])
        : undefined;
    const topicIds = cfg.params?.['topicIds']
        ? String(cfg.params['topicIds']).split(',').map(Number)
        : undefined;
    const userTypeIds = cfg.params?.['userTypeIds']
        ? String(cfg.params['userTypeIds']).split(',').map(Number)
        : undefined;

    return mockStore.filter(i => {
        if (categoryId !== undefined && i.categoryId !== categoryId) return false;
        if (topicIds?.length && !topicIds.every(tid => i.topicIds.includes(tid))) return false;
        if (userTypeIds?.length && !userTypeIds.every(uid => i.userTypeIds.includes(uid))) return false;
        return true;
    });
}