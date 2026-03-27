/**
 * src/api/user-type.api.ts
 *
 * HTTP calls for the /user-types resource.
 *
 * ── Backend schema (UserTypeLegacy — legacy-compatible flat DTO) ──────────────
 *
 *   id          number    — assigned by backend on create
 *   user_type   string    — display label in sourceLang
 *   description string    — rich-text content stored as **Markdown**
 *                           (replaces the legacy nested translations[].description)
 *   status      ENUM      — 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'
 *                           replaces both legacy `translationState` (numeric 0-3)
 *                           and the `published` boolean flag:
 *                             0 editing      → DRAFT
 *                             1 translatable → APPROVED
 *                             published=true → PUBLISHED
 *   sourceLang  string    — ISO code of the authoring language (e.g. 'en')
 *   dataExtra   object    — opaque JSON bag for per-entity extra fields.
 *                           Convention: { icon: "<base64 or URL>" }
 *
 * ── Endpoints (from OpenAPI spec) ────────────────────────────────────────────
 *   GET    /user-types                     list (LoopBack filter param)
 *   GET    /user-types/:id                 single record
 *   GET    /user-types/count               record count
 *   POST   /user-types                     create
 *   PUT    /user-types/:id                 full replace
 *   PATCH  /user-types/:id                 partial update
 *   DELETE /user-types/:id                 delete
 *   GET    /user-types/to-production?id=n  publish — copy to prod translations
 *   GET    /user-types-migrant             translated union for migrant frontend
 *
 * Auth: Bearer JWT — admin/superadmin roles required for all write operations.
 *
 * Mock handlers registered at bottom; active only with VITE_API_MOCK=true.
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserTypeStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Extra metadata stored in the opaque `dataExtra` bag.
 * Typed explicitly so callers don't need to cast.
 */
export interface UserTypeDataExtra {
    /** Base64 data-URL or absolute URL for the user-type icon */
    icon?: string;
}

/**
 * UserType record as returned by the backend (UserTypeLegacy DTO).
 *
 * Key difference from legacy:
 *  - `description` is **Markdown**, not HTML, and is the primary rich-text
 *    field (the old `translations[].description`).
 *  - No nested `translations` array — all content is flat in sourceLang.
 *  - `status` replaces both numeric `translationState` and boolean `published`.
 *  - `dataExtra.icon` replaces the legacy top-level `icon` field.
 */
export interface UserType {
    id: number;
    /** Display label in the source language */
    user_type: string;
    /** Rich-text description stored as Markdown */
    description: string;
    status: UserTypeStatus;
    /** ISO 639-1 code for the authoring language, e.g. 'en' */
    sourceLang: string;
    /** Opaque extra metadata. Use UserTypeDataExtra for typed access. */
    dataExtra?: UserTypeDataExtra;
}

/** Payload for POST /user-types — id assigned by backend */
export type CreateUserTypePayload = Omit<UserType, 'id'>;

/** Payload for PATCH /user-types/:id — all fields optional */
export type PatchUserTypePayload = Partial<CreateUserTypePayload>;

// ─── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Maps UserType.status to the i18n key shown in the translation-state column.
 * Keeps the legacy UI labels intact even though the underlying ENUM has changed.
 */
export function translationStateKey(ut: Pick<UserType, 'status'>): string {
    switch (ut.status) {
        case 'DRAFT':     return 'translation_states.editing';
        case 'APPROVED':  return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED':  return 'translation_states.archived';
        default:          return 'translation_states.editing';
    }
}

/** True when the user type is live on the migrant frontend. */
export function isUserTypePublished(ut: Pick<UserType, 'status'>): boolean {
    return ut.status === 'PUBLISHED';
}

/** Extract icon from dataExtra, returning empty string if absent. */
export function userTypeIcon(ut: UserType): string {
    return ut.dataExtra?.icon ?? '';
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const userTypeApi = {

    /**
     * List all user types.
     * Auth: admin, superadmin
     */
    async list(): Promise<UserType[]> {
        logger.info('[user-type.api] list');
        return apiGet<UserType[]>('/user-types');
    },

    /**
     * Fetch a single user type by id.
     * Auth: admin, superadmin
     */
    async getOne(id: number): Promise<UserType> {
        logger.info('[user-type.api] getOne', { id });
        return apiGet<UserType>(`/user-types/${id}`);
    },

    /**
     * Create a new user type.
     * Returns the created record including the backend-assigned id.
     * Auth: admin, superadmin
     */
    async create(payload: CreateUserTypePayload): Promise<UserType> {
        logger.info('[user-type.api] create', { user_type: payload.user_type });
        return apiPost<UserType>('/user-types', payload);
    },

    /**
     * Partially update a user type (description, status, icon, etc.).
     * Auth: admin, superadmin
     */
    async patch(id: number, payload: PatchUserTypePayload): Promise<void> {
        logger.info('[user-type.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/user-types/${id}`, payload);
    },

    /**
     * Fully replace a user type record.
     * Auth: admin, superadmin
     */
    async replace(id: number, payload: CreateUserTypePayload): Promise<void> {
        logger.info('[user-type.api] replace', { id });
        return apiPut<void>(`/user-types/${id}`, payload);
    },

    /**
     * Delete a user type by id.
     * Auth: admin, superadmin
     */
    async remove(id: number): Promise<void> {
        logger.warn('[user-type.api] remove', { id });
        return apiDelete(`/user-types/${id}`);
    },

    /**
     * Publish a user type: triggers the to-production copy on the backend.
     * After this call the record should be visible to the migrant frontend.
     * Auth: admin, superadmin
     */
    async publish(id: number): Promise<void> {
        logger.info('[user-type.api] publish', { id });
        await apiGet<unknown>(`/user-types/to-production`, { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────
// Active only when VITE_API_MOCK=true. Keep in sync with the real API above.
//
// The mockStore is module-level so mutations in one test (create/patch/delete)
// are visible to subsequent requests within the same browser session.

let _nextId = 10;

let mockStore: UserType[] = [
    {
        id: 1,
        user_type: 'Migrant',
        description: 'Person who has **moved** from one country to another.',
        status: 'PUBLISHED',
        sourceLang: 'en',
        dataExtra: { icon: '' },
    },
    {
        id: 2,
        user_type: 'Asylum seeker',
        description: 'Person who has applied for **refugee status**.',
        status: 'APPROVED',
        sourceLang: 'en',
        dataExtra: { icon: '' },
    },
    {
        id: 3,
        user_type: 'Refugee',
        description: 'Person recognised as a refugee under *international law*.',
        status: 'DRAFT',
        sourceLang: 'en',
        dataExtra: { icon: '' },
    },
];

export function registerUserTypeMocks(mock: MockRegistry): void {

    // GET /user-types — must be registered BEFORE the /:id pattern to avoid collision
    mock.onGet('/user-types').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /user-types', { count: mockStore.length });
        return [200, [...mockStore]];
    });

    // GET /user-types/to-production — must be before /:id regex too
    mock.onGet('/user-types/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        logger.debug('[mock] GET /user-types/to-production', { id });
        const idx = mockStore.findIndex(u => u.id === id);
        if (idx === -1) return [404, { error: `UserType ${id} not found` }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        return [200, {}];
    });

    // GET /user-types/:id
    mock.onGet(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockStore.find(u => u.id === id);
        if (!found) return [404, { error: `UserType ${id} not found` }];
        return [200, { ...found }];
    });

    // POST /user-types — dynamic: each call creates a new record
    mock.onPost('/user-types').reply((cfg: MockRequestConfig): MockReplyTuple => {
        // The mock adapter passes request body via cfg; cast safely
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<UserType> = body ? (JSON.parse(body) as Partial<UserType>) : {};
        const newItem: UserType = {
            id: _nextId++,
            user_type:   input.user_type   ?? 'New type',
            description: input.description ?? '',
            status:      input.status      ?? 'DRAFT',
            sourceLang:  input.sourceLang  ?? 'en',
            dataExtra:   input.dataExtra   ?? { icon: '' },
        };
        mockStore.push(newItem);
        logger.debug('[mock] POST /user-types created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PATCH /user-types/:id
    mock.onPatch(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(u => u.id === id);
        if (idx === -1) return [404, { error: `UserType ${id} not found` }];
        const body = (cfg as unknown as { data?: string }).data;
        const patch: Partial<UserType> = body ? (JSON.parse(body) as Partial<UserType>) : {};
        mockStore[idx] = { ...mockStore[idx]!, ...patch };
        logger.debug('[mock] PATCH /user-types/:id', { id, fields: Object.keys(patch) });
        return [204];
    });

    // DELETE /user-types/:id
    mock.onDelete(/\/user-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const before = mockStore.length;
        mockStore = mockStore.filter(u => u.id !== id);
        logger.debug('[mock] DELETE /user-types/:id', { id, removed: before - mockStore.length });
        return [204];
    });

    logger.debug('[mock] user-type handlers registered');
}
