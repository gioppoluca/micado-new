/**
 * src/api/user-type.api.ts
 *
 * HTTP calls for the /user-types resource.
 *
 * ── Two distinct DTO shapes ──────────────────────────────────────────────────
 *
 *   UserType (flat / legacy)
 *     id, user_type, description, status, sourceLang, dataExtra
 *     Used by: GET /user-types list, POST /user-types create response.
 *     Contains only the sourceLang translation.
 *     Binding: q-list rows (icon, label, status badge).
 *
 *   UserTypeFull (rich)
 *     status, sourceLang, dataExtra
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     Used by: GET /user-types/:id (form open), PUT /user-types/:id (form save).
 *     Contains ALL language rows embedded — one round-trip to open, one to save.
 *
 * ── Why no /user-types/:id/translations sub-resource ────────────────────────
 *
 *   The GET /:id response already returns all translations.
 *   The PUT /:id body sends them back.
 *   A separate endpoint would add a second round-trip for no gain.
 *
 * ── Endpoint map ────────────────────────────────────────────────────────────
 *
 *   GET    /user-types                  list → UserType[]
 *   GET    /user-types/count            count
 *   POST   /user-types                  create → UserType (optionally + translations)
 *   GET    /user-types/:id              form open → UserTypeFull (all translations)
 *   PUT    /user-types/:id              form save → 204 (full: metadata + translations)
 *   PATCH  /user-types/:id              partial → 204 (status toggle, icon)
 *   DELETE /user-types/:id              delete → 204
 *   GET    /user-types/to-production    publish workflow → 204
 *   GET    /user-types-migrant          migrant frontend (published, lang-resolved)
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserTypeStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

export interface UserTypeDataExtra {
    icon?: string;
}

/**
 * Flat, legacy-compatible DTO.
 * Returned by list (GET /user-types) and create (POST /user-types).
 * Contains only the sourceLang translation.
 */
export interface UserType {
    id: number;
    user_type: string;
    description: string;
    status: UserTypeStatus;
    sourceLang: string;
    dataExtra?: UserTypeDataExtra;
}

/**
 * Per-language translation entry.
 * tStatus is read-only on write — the backend ignores it on PUT.
 */
export interface UserTypeTranslation {
    title: string;
    description: string;
    /** Read-only. Present in GET responses, ignored in PUT bodies. */
    tStatus?: TranslationStatus;
}

/**
 * Rich DTO with all translations embedded.
 * Returned by GET /user-types/:id (form open).
 * Sent to   PUT /user-types/:id (form save).
 *
 * Note: `user_type` (the flat label field) is NOT present — use
 * translations[sourceLang].title instead, which is the same value.
 */
/**
 * Single revision summary — lightweight, no translation content.
 * Returned inside UserTypeFull.revisions[] by GET /user-types/:id.
 * Read-only: never sent back to the backend on PUT.
 */
export interface RevisionSummary {
    revisionNo: number;
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
    createdAt?: string;
    /** Display name of the actor who created this revision (already unpacked from JSONB). */
    createdByName?: string;
    publishedAt?: string;
}

export interface UserTypeFull {
    id?: number;
    status?: UserTypeStatus;
    sourceLang?: string;
    dataExtra?: UserTypeDataExtra;
    /**
     * All per-language rows keyed by lang code.
     * Missing key = that language was never translated.
     * On PUT: present entries are upserted; absent entries are left untouched.
     */
    translations?: Record<string, UserTypeTranslation>;

    /**
     * All revisions of this item, sorted ascending by revision_no.
     * Populated by GET /user-types/:id — no extra API call needed.
     * Not sent to the backend on PUT (ignored if present).
     */
    revisions?: RevisionSummary[];
}

export type CreateUserTypePayload = Omit<UserType, 'id'> & {
    /**
     * Optional translations map for the initial POST.
     * If provided, the backend persists all entries in one call,
     * saving the form from needing a separate PUT after create.
     */
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchUserTypePayload = Partial<Omit<UserType, 'id'>>;

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function translationStateKey(ut: Pick<UserType, 'status'>): string {
    switch (ut.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

export function isUserTypePublished(ut: Pick<UserType, 'status'>): boolean {
    return ut.status === 'PUBLISHED';
}

export function userTypeIcon(ut: UserType | UserTypeFull): string {
    return (ut.dataExtra?.icon ?? '');
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const userTypeApi = {

    /**
     * List all user types (flat, sourceLang only).
     * Suitable for the list view.
     */
    async list(): Promise<UserType[]> {
        logger.info('[user-type.api] list');
        return apiGet<UserType[]>('/user-types');
    },

    /**
     * Open a user type for editing.
     * Returns UserTypeFull with all per-language translations embedded.
     * One round-trip — no second call for translations.
     */
    async getOne(id: number): Promise<UserTypeFull> {
        logger.info('[user-type.api] getOne', { id });
        return apiGet<UserTypeFull>(`/user-types/${id}`);
    },

    /**
     * Create a new user type.
     * Include `translations` in the payload to persist all language content
     * in a single POST (avoids a subsequent PUT for new records).
     */
    async create(payload: CreateUserTypePayload): Promise<UserType> {
        logger.info('[user-type.api] create', { user_type: payload.user_type });
        return apiPost<UserType>('/user-types', payload);
    },

    /**
     * Save a user type from the PA form.
     * Sends UserTypeFull: metadata (icon, status, sourceLang) + ALL translation tabs.
     * One round-trip — replaces the previous split PATCH + PUT /translations pattern.
     */
    async save(id: number, payload: UserTypeFull): Promise<void> {
        logger.info('[user-type.api] save (full replace)', {
            id,
            status: payload.status,
            langCount: Object.keys(payload.translations ?? {}).length,
        });
        return apiPut<void>(`/user-types/${id}`, payload);
    },

    /**
     * Partial update — status toggle, icon change, or single-field update.
     * Does NOT touch translations unless user_type / description are included.
     */
    async patch(id: number, payload: PatchUserTypePayload): Promise<void> {
        logger.info('[user-type.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/user-types/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[user-type.api] remove', { id });
        return apiDelete(`/user-types/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[user-type.api] publish', { id });
        await apiGet<unknown>(`/user-types/to-production`, { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 10;

let mockStore: UserType[] = [
    { id: 1, user_type: 'Migrant', description: 'Person who has **moved** from one country to another.', status: 'PUBLISHED', sourceLang: 'en', dataExtra: { icon: '' } },
    { id: 2, user_type: 'Asylum seeker', description: 'Person who has applied for **refugee status**.', status: 'APPROVED', sourceLang: 'en', dataExtra: { icon: '' } },
    { id: 3, user_type: 'Refugee', description: 'Person recognised as a refugee under *international law*.', status: 'DRAFT', sourceLang: 'en', dataExtra: { icon: '' } },
];

/** Full translations indexed by numeric id */
const mockFull: Partial<Record<number, UserTypeFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'en', dataExtra: { icon: '' },
        translations: {
            en: { title: 'Migrant', description: 'Person who has **moved** from one country to another.', tStatus: 'PUBLISHED' },
            ar: { title: 'مهاجر', description: 'شخص انتقل من دولة إلى أخرى.', tStatus: 'PUBLISHED' },
            fr: { title: 'Migrant', description: 'Personne qui a **déménagé**.', tStatus: 'STALE' },
        },
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'en', dataExtra: { icon: '' },
        translations: {
            en: { title: 'Asylum seeker', description: 'Person who has applied for **refugee status**.', tStatus: 'APPROVED' },
            ar: { title: 'طالب لجوء', description: '', tStatus: 'STALE' },
        },
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'en', dataExtra: { icon: '' },
        translations: {
            en: { title: 'Refugee', description: 'Person recognised as a refugee under *international law*.', tStatus: 'DRAFT' },
        },
    },
};

export function registerUserTypeMocks(mock: MockRegistry): void {

    // GET /user-types — list (flat)
    mock.onGet('/user-types').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /user-types', { count: mockStore.length });
        return [200, [...mockStore]];
    });

    // GET /user-types/to-production — before /:id to avoid collision
    mock.onGet('/user-types/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(u => u.id === id);
        if (idx === -1) return [404, { error: { message: `UserType ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        return [200, {}];
    });

    // GET /user-types/:id — rich (UserTypeFull)
    mock.onGet(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) return [404, { error: { message: `UserType ${id} not found` } }];
        return [200, { ...found, translations: { ...found.translations } }];
    });

    // POST /user-types — create
    mock.onPost('/user-types').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateUserTypePayload> = body ? JSON.parse(body) : {};
        const newItem: UserType = {
            id: _nextId++,
            user_type: input.user_type ?? 'New type',
            description: input.description ?? '',
            status: 'DRAFT',
            sourceLang: input.sourceLang ?? 'en',
            dataExtra: input.dataExtra ?? { icon: '' },
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id,
            status: newItem.status,
            sourceLang: newItem.sourceLang,
            // Spread conditionally: exactOptionalPropertyTypes forbids explicit undefined
            ...(newItem.dataExtra !== undefined && { dataExtra: newItem.dataExtra }),
            translations: input.translations
                ? Object.fromEntries(
                    Object.entries(input.translations).map(([l, c]) => [
                        l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                    ]),
                )
                : { [newItem.sourceLang]: { title: newItem.user_type, description: newItem.description, tStatus: 'DRAFT' } },
        };
        logger.debug('[mock] POST /user-types created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PUT /user-types/:id — full replace (UserTypeFull)
    mock.onPut(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: UserTypeFull = body ? JSON.parse(body) : {};

        const idx = mockStore.findIndex(u => u.id === id);
        if (idx === -1) return [404, { error: { message: `UserType ${id} not found` } }];

        // Sync flat list entry from sourceLang translation
        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        mockStore[idx] = {
            ...mockStore[idx]!,
            user_type: srcTr?.title ?? mockStore[idx]!.user_type,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
            // Spread conditionally to avoid explicit undefined under exactOptionalPropertyTypes
            ...(full.dataExtra !== undefined
                ? { dataExtra: full.dataExtra }
                : mockStore[idx]!.dataExtra !== undefined
                    ? { dataExtra: mockStore[idx]!.dataExtra }
                    : {}),
        };

        // Merge translations (upsert, never delete)
        mockFull[id] = {
            ...mockFull[id],
            ...full,
            translations: {
                ...(mockFull[id]?.translations ?? {}),
                ...Object.fromEntries(
                    Object.entries(full.translations ?? {}).map(([l, c]) => [
                        l, { title: c.title, description: c.description, tStatus: 'DRAFT' as const },
                    ]),
                ),
            },
        };

        logger.debug('[mock] PUT /user-types/:id', { id, langs: Object.keys(full.translations ?? {}) });
        return [204];
    });

    // PATCH /user-types/:id — partial
    mock.onPatch(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(u => u.id === id);
        if (idx === -1) return [404, { error: { message: `UserType ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: Partial<UserType> = body ? JSON.parse(body) : {};
        // Extract base to typed variable — exactOptionalPropertyTypes forbids
        // spreading an array-indexed value directly into a typed assignment.
        const base: UserType = mockStore[idx] as UserType;
        const patched: UserType = { ...base, ...p };
        mockStore[idx] = patched;
        if (mockFull[id]) mockFull[id].status = patched.status;
        logger.debug('[mock] PATCH /user-types/:id', { id, fields: Object.keys(p) });
        return [204];
    });

    // DELETE /user-types/:id
    mock.onDelete(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(u => u.id !== id);
        delete mockFull[id];
        logger.debug('[mock] DELETE /user-types/:id', { id });
        return [204];
    });

    logger.debug('[mock] user-type handlers registered');
}