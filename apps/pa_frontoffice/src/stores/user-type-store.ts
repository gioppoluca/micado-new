/**
 * src/stores/user-type-store.ts
 *
 * Pinia store for the /user-types resource.
 *
 * Follows the same pattern as language-store.ts:
 *  - Setup function with explicit return-type interface (prevents vue-tsc
 *    from dropping function signatures from the inferred store type)
 *  - All API calls proxied through actions — pages never import userTypeApi
 *  - Error surface via `error` ref + `clearError()` — no thrown exceptions
 *
 * State shape:
 *   userTypes  — flat list of UserType records (backend flat DTO)
 *   loading    — true while any async operation is in flight
 *   error      — last error message, null when clean
 *
 * Actions:
 *   fetchAll()          — populate userTypes from backend
 *   create(payload)     — POST + push into local list
 *   update(id, patch)   — PATCH + splice local list
 *   remove(id)          — DELETE + filter local list
 *   publish(id)         — GET to-production → flip local status to PUBLISHED
 *   unpublish(id)       — PATCH status back to DRAFT
 *   clearError()
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { userTypeApi } from 'src/api/user-type.api';
import type {
    UserType,
    CreateUserTypePayload,
    PatchUserTypePayload,
} from 'src/api/user-type.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ────────────────────────────────────────────────────
// Explicit interface prevents vue-tsc from narrowing away action signatures.

interface UserTypeStoreSetup {
    userTypes: Ref<UserType[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(): Promise<void>;
    create(payload: CreateUserTypePayload): Promise<UserType | null>;
    update(id: number, payload: PatchUserTypePayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUserTypeStore = defineStore('userType', (): UserTypeStoreSetup => {

    // ── State ─────────────────────────────────────────────────────────────────

    const userTypes = ref<UserType[]>([]);
    const loading   = ref(false);
    const error     = ref<string | null>(null);

    // ── Helpers ───────────────────────────────────────────────────────────────

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

    // ── Actions ───────────────────────────────────────────────────────────────

    /**
     * Fetch all user types from the backend and replace local state.
     * The description field contains Markdown — the RichTextEditor/Viewer
     * components handle rendering.
     */
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
     * Create a new user type. The `description` in the payload should be
     * Markdown (as produced by RichTextEditor's v-model).
     * Returns the created record (with backend-assigned id), or null on error.
     */
    async function create(payload: CreateUserTypePayload): Promise<UserType | null> {
        loading.value = true;
        clearError();
        try {
            const created = await userTypeApi.create(payload);
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
     * Patch an existing user type. Merges the patch into the local record
     * so the list updates reactively without a full re-fetch.
     * Returns true on success.
     */
    async function update(id: number, payload: PatchUserTypePayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.patch(id, payload);
            const idx = userTypes.value.findIndex(u => u.id === id);
            if (idx !== -1) {
                userTypes.value[idx] = { ...userTypes.value[idx]!, ...payload };
            }
            logger.info('[user-type-store] update', { id, fields: Object.keys(payload) });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Delete a user type by id and remove it from local state.
     * Returns true on success.
     */
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

    /**
     * Publish a user type: calls the to-production endpoint, then updates
     * the local status to PUBLISHED.
     * Returns true on success.
     */
    async function publish(id: number): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await userTypeApi.publish(id);
            const idx = userTypes.value.findIndex(u => u.id === id);
            if (idx !== -1) {
                userTypes.value[idx] = { ...userTypes.value[idx]!, status: 'PUBLISHED' };
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

    /**
     * Unpublish a user type: PATCHes status back to DRAFT and updates locally.
     * Returns true on success.
     */
    async function unpublish(id: number): Promise<boolean> {
        return update(id, { status: 'DRAFT' });
    }

    return {
        userTypes,
        loading,
        error,
        fetchAll,
        create,
        update,
        remove,
        publish,
        unpublish,
        clearError,
    };
});

