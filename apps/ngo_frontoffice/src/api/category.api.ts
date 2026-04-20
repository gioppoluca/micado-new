/**
 * src/api/category.api.ts
 *
 * HTTP calls for the /categories resource.
 *
 * ── Two DTO shapes ───────────────────────────────────────────────────────────
 *
 *   Category (flat/legacy)
 *     id, title, status, sourceLang, subtype
 *     Used by: GET /categories list, POST /categories response.
 *
 *   CategoryFull (rich)
 *     status, sourceLang, subtype
 *     + translations: Record<lang, { title, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /categories/:id (form open), PUT /categories/:id (save).
 *
 * ── Subtype ──────────────────────────────────────────────────────────────────
 *
 *   "event"       → Event & Courses categories (EventCategoriesPage)
 *   "information" → Useful Information categories (future)
 *
 *   The subtype is set at creation and treated as immutable.
 *   PUT ignores subtype in the body — backend preserves the existing value.
 *
 * ── No description field ─────────────────────────────────────────────────────
 *
 *   Categories have only a translatable title. The description column is
 *   stored as "" in the DB but never displayed or edited.
 *
 * ── Endpoint map ────────────────────────────────────────────────────────────
 *
 *   GET    /categories?subtype=     list → Category[]
 *   GET    /categories/count        count
 *   POST   /categories              create → Category
 *   GET    /categories/to-production?id=  publish
 *   GET    /categories/:id          form open → CategoryFull
 *   PUT    /categories/:id          form save → 204
 *   PATCH  /categories/:id          partial → 204
 *   DELETE /categories/:id          delete → 204 (throws 409 if in use)
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CategoryStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type CategorySubtype = 'event' | 'information';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/**
 * Flat DTO — returned by list and create.
 * Contains only the sourceLang translation.
 */
export interface Category {
    id: number;
    title: string;
    status: CategoryStatus;
    sourceLang: string;
    subtype: CategorySubtype;
}

/** Per-language translation entry. */
export interface CategoryTranslation {
    title: string;
    /** Read-only. Present in GET responses, ignored by PUT. */
    tStatus?: TranslationStatus;
}

/** Lightweight revision summary. */
export interface RevisionSummary {
    revisionNo: number;
    status: CategoryStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/**
 * Rich DTO with all translations.
 * Returned by GET /categories/:id.
 * Sent to PUT /categories/:id.
 */
export interface CategoryFull {
    id?: number;
    status?: CategoryStatus;
    sourceLang?: string;
    /** Read-only on PUT — backend preserves the existing value. */
    subtype?: CategorySubtype;
    translations?: Record<string, CategoryTranslation>;
    revisions?: RevisionSummary[];
}

export type CreateCategoryPayload = {
    title?: string;
    sourceLang?: string;
    subtype: CategorySubtype;
    translations?: Record<string, { title: string }>;
};

export type PatchCategoryPayload = Partial<Omit<Category, 'id' | 'subtype'>>;

// ─── Status helpers ───────────────────────────────────────────────────────────

export function categoryStatusKey(c: Pick<Category, 'status'>): string {
    switch (c.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const categoryApi = {

    async list(subtype?: CategorySubtype): Promise<Category[]> {
        logger.info('[category.api] list', { subtype });
        return apiGet<Category[]>('/categories', subtype ? { params: { subtype } } : undefined);
    },

    async getOne(id: number): Promise<CategoryFull> {
        logger.info('[category.api] getOne', { id });
        return apiGet<CategoryFull>(`/categories/${id}`);
    },

    async create(payload: CreateCategoryPayload): Promise<Category> {
        logger.info('[category.api] create', { title: payload.title, subtype: payload.subtype });
        return apiPost<Category>('/categories', payload);
    },

    async save(id: number, payload: CategoryFull): Promise<void> {
        logger.info('[category.api] save', {
            id, langCount: Object.keys(payload.translations ?? {}).length,
        });
        return apiPut<void>(`/categories/${id}`, payload);
    },

    async patch(id: number, payload: PatchCategoryPayload): Promise<void> {
        logger.info('[category.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/categories/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[category.api] remove', { id });
        return apiDelete(`/categories/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[category.api] publish', { id });
        await apiGet<unknown>('/categories/to-production', { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 100;

let mockStore: Category[] = [
    { id: 1, title: 'Integrazione', status: 'PUBLISHED', sourceLang: 'it', subtype: 'event' },
    { id: 2, title: 'Microcredito', status: 'APPROVED', sourceLang: 'it', subtype: 'event' },
    { id: 3, title: 'Corso di lingua', status: 'DRAFT', sourceLang: 'it', subtype: 'event' },
    { id: 4, title: 'Centro di salute', status: 'PUBLISHED', sourceLang: 'it', subtype: 'information' },
];

const mockFull: Partial<Record<number, CategoryFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it', subtype: 'event',
        translations: {
            it: { title: 'Integrazione', tStatus: 'PUBLISHED' },
            en: { title: 'Integration', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it', subtype: 'event',
        translations: {
            it: { title: 'Microcredito', tStatus: 'DRAFT' },
            en: { title: 'Microcredit', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'it', subtype: 'event',
        translations: {
            it: { title: 'Corso di lingua', tStatus: 'DRAFT' },
        },
        revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

export function registerCategoryMocks(mock: MockRegistry): void {

    // GET /categories/count — before /categories/:id
    mock.onGet('/categories/count').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const subtype = cfg.params?.['subtype'] as CategorySubtype | undefined;
        const filtered = subtype ? mockStore.filter(c => c.subtype === subtype) : mockStore;
        return [200, { count: filtered.length }];
    });

    // GET /categories/to-production — before /:id
    mock.onGet('/categories/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(c => c.id === id);
        if (idx === -1) return [404, { error: { message: `Category ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        return [200, {}];
    });

    // GET /categories/:id — rich
    mock.onGet(/\/categories\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            const flat = mockStore.find(c => c.id === id);
            if (!flat) return [404, { error: { message: `Category ${id} not found` } }];
            return [200, {
                id: flat.id, status: flat.status, sourceLang: flat.sourceLang, subtype: flat.subtype,
                translations: { [flat.sourceLang]: { title: flat.title, tStatus: 'DRAFT' } },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: '2024-01-01T00:00:00Z', createdByName: 'System' }],
            }];
        }
        return [200, { ...found, translations: { ...found.translations } }];
    });

    // GET /categories — list with optional subtype filter
    mock.onGet('/categories').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const subtype = cfg.params?.['subtype'] as CategorySubtype | undefined;
        const filtered = subtype ? mockStore.filter(c => c.subtype === subtype) : mockStore;
        logger.debug('[mock] GET /categories', { subtype, count: filtered.length });
        return [200, [...filtered]];
    });

    // POST /categories
    mock.onPost('/categories').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateCategoryPayload> = body ? JSON.parse(body) : {};
        const srcLang = input.sourceLang ?? 'it';
        const srcTitle = input.translations?.[srcLang]?.title ?? input.title ?? 'Nuova categoria';
        const newItem: Category = {
            id: _nextId++,
            title: srcTitle,
            status: 'DRAFT',
            sourceLang: srcLang,
            subtype: input.subtype ?? 'event',
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id, status: newItem.status, sourceLang: srcLang, subtype: newItem.subtype,
            translations: input.translations
                ? Object.fromEntries(Object.entries(input.translations).map(([l, c]) => [
                    l, { title: c.title, tStatus: 'DRAFT' as const },
                ]))
                : { [srcLang]: { title: srcTitle, tStatus: 'DRAFT' } },
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'System' }],
        };
        logger.debug('[mock] POST /categories created', { id: newItem.id, subtype: newItem.subtype });
        return [200, { ...newItem }];
    });

    // PUT /categories/:id
    mock.onPut(/\/categories\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: CategoryFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(c => c.id === id);
        if (idx === -1) return [404, { error: { message: `Category ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        // subtype is immutable — preserve existing
        const existingSubtype = mockStore[idx]!.subtype;
        mockStore[idx] = {
            ...mockStore[idx]!,
            title: srcTr?.title ?? mockStore[idx]!.title,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
            subtype: existingSubtype,
        };

        const updatedTrs: Record<string, CategoryTranslation> = {
            ...(mockFull[id]?.translations ?? {}),
            ...Object.fromEntries(Object.entries(full.translations ?? {}).map(([l, c]) => [
                l, { title: c.title, tStatus: 'DRAFT' as const },
            ])),
        };
        if (full.status === 'APPROVED') {
            for (const lang of Object.keys(updatedTrs)) {
                if (lang !== srcLang) updatedTrs[lang] = { ...updatedTrs[lang]!, tStatus: 'STALE' };
            }
        }
        mockFull[id] = { ...mockFull[id], ...full, subtype: existingSubtype, translations: updatedTrs };
        return [204];
    });

    // PATCH /categories/:id
    mock.onPatch(/\/categories\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(c => c.id === id);
        if (idx === -1) return [404, { error: { message: `Category ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: Partial<Category> = body ? JSON.parse(body) : {};
        mockStore[idx] = { ...mockStore[idx] as Category, ...p };
        if (mockFull[id] && p.status) mockFull[id].status = p?.status;
        return [204];
    });

    // DELETE /categories/:id
    mock.onDelete(/\/categories\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(c => c.id !== id);
        delete mockFull[id];
        return [204];
    });

    logger.debug('[mock] category handlers registered');
}