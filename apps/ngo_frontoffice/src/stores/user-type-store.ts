/**
 * src/stores/user-type-store.ts
 *
 * Pinia store for the /user-types resource.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   userTypes  — flat list (UserType[]) — drives the list view
 *   loading    — true while any async operation is in flight
 *   error      — last error message, null when clean
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll()               — GET /user-types → replace userTypes list
 *   getOne(id)               — GET /user-types/:id → returns UserTypeFull
 *                              (all translations embedded, for form open)
 *   create(payload)          — POST /user-types → push flat record into list
 *   save(id, full)           — PUT /user-types/:id with UserTypeFull
 *                              (form save — one round-trip, all translations)
 *   patch(id, partial)       — PATCH /user-types/:id (status toggle, icon)
 *   remove(id)               — DELETE + filter list
 *   publish(id)              — GET to-production → flip local status PUBLISHED
 *   unpublish(id)            — PATCH status back to DRAFT
 *   clearError()
 *
 * ── Design note ──────────────────────────────────────────────────────────────
 *   getOne() does NOT cache the UserTypeFull — the form always fetches fresh
 *   on open.  The list (userTypes) stays as the only shared cache so there is
 *   no stale-full-record problem after a save.
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { userTypeApi } from 'src/api/user-type.api';
import type {
    UserType,
    UserTypeFull,
    CreateUserTypePayload,
    PatchUserTypePayload,
} from 'src/api/user-type.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ─────────────────────────────────────────────────────
// Explicit interface prevents vue-tsc from narrowing away action signatures
// when the store is used across components.

interface UserTypeStoreSetup {
    userTypes: Ref<UserType[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(): Promise<void>;
    getOne(id: number): Promise<UserTypeFull | null>;
    create(payload: CreateUserTypePayload): Promise<UserType | null>;
    save(id: number, full: UserTypeFull): Promise<boolean>;
    patch(id: number, payload: PatchUserTypePayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useUserTypeStore = defineStore('userType', (): UserTypeStoreSetup => {

    // ── State ──────────────────────────────────────────────────────────────────

    const userTypes = ref<UserType[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[user-type-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[user-type-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    /** Populate the flat list — used by the list view on mount. */
    async function fetchAll(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            userTypes.value = await userTypeApi.list();
            logger.info('[user-type-store] fetchAll', { count: userTypes.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Fetch a single user type with ALL translations embedded (UserTypeFull).
     * Called when the PA form opens for editing.
     * Returns null on error (error is also set in store.error).
     */
    async function getOne(id: number): Promise<UserTypeFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await userTypeApi.getOne(id);
            logger.info('[user-type-store] getOne', {
                id,
                langs: Object.keys(full.translations ?? {}),
            });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Create a new user type.
     * The payload may include a `translations` map to persist all language
     * content in a single POST (avoids a subsequent PUT for new records).
     * Returns the flat UserType (list shape) on success, null on error.
     */
    async function create(payload: CreateUserTypePayload): Promise<UserType | null> {
        loading.value = true;
        clearError();
        try {
            const created = await userTypeApi.create(payload);
            // Derive a list entry from the flat response and push it
            userTypes.value.push(created);
            logger.info('[user-type-store] create', { id: created.id, label: created.user_type });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Full replace — called by the PA form Save button.
     * Sends UserTypeFull (metadata + all translation tabs) in one PUT.
     * Updates the flat list entry from the sourceLang translation on success.
     * Returns true on success.
     */
    async function save(id: number, full: UserTypeFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.save(id, full);

            // Sync the flat list entry so the list view reflects changes
            // without a full re-fetch.
            const srcLang = full.sourceLang;
            const srcTr = srcLang ? (full.translations?.[srcLang]) : undefined;
            const idx = userTypes.value.findIndex(u => u.id === id);

            if (idx !== -1) {
                // Extract base to a typed variable — avoids the `!` assertion
                // and keeps exactOptionalPropertyTypes happy on the merge.
                const base: UserType = userTypes.value[idx] as UserType;
                const merged: UserType = {
                    ...base,
                    user_type: srcTr?.title ?? base.user_type,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: full.sourceLang ?? base.sourceLang,
                };
                // dataExtra is optional — only override when explicitly provided
                if (full.dataExtra !== undefined) merged.dataExtra = full.dataExtra;
                userTypes.value[idx] = merged;
            }

            logger.info('[user-type-store] save', {
                id,
                langs: Object.keys(full.translations ?? {}),
                status: full.status,
            });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Partial update — status toggle, icon-only change.
     * Does NOT touch translations.
     * Returns true on success.
     */
    async function patch(id: number, payload: PatchUserTypePayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.patch(id, payload);
            const idx = userTypes.value.findIndex(u => u.id === id);
            if (idx !== -1) {
                // exactOptionalPropertyTypes: use conditional spread, never explicit undefined
                const update: Partial<UserType> = {};
                if (payload.status !== undefined) update.status = payload.status;
                if (payload.sourceLang !== undefined) update.sourceLang = payload.sourceLang;
                if (payload.dataExtra !== undefined) update.dataExtra = payload.dataExtra;
                const base: UserType = userTypes.value[idx] as UserType;
                userTypes.value[idx] = { ...base, ...update };
            }
            logger.info('[user-type-store] patch', { id, fields: Object.keys(payload) });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function remove(id: number): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.remove(id);
            userTypes.value = userTypes.value.filter(u => u.id !== id);
            logger.warn('[user-type-store] remove', { id });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function publish(id: number): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.publish(id);
            const idx = userTypes.value.findIndex(u => u.id === id);
            if (idx !== -1) {
                const base: UserType = userTypes.value[idx] as UserType;
                userTypes.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[user-type-store] publish', { id });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function unpublish(id: number): Promise<boolean> {
        return patch(id, { status: 'DRAFT' });
    }

    return {
        userTypes,
        loading,
        error,
        fetchAll,
        getOne,
        create,
        save,
        patch,
        remove,
        publish,
        unpublish,
        clearError,
    };
});