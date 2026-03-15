/**
 * src/stores/features-store.ts
 *
 * Pinia store for feature flags.
 *
 * Replaces the old Vuex features/ module:
 *   fetchFeatures       → fetchAll(lang?)
 *   updateAllFeatures   → patchOne(id, payload) per flag
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { featuresApi } from 'src/api/features.api';
import type { FeatureFlag, PatchFeatureFlagPayload } from 'src/api/features.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Setup return type ────────────────────────────────────────────────────────

interface FeaturesStoreSetup {
    flags: Ref<FeatureFlag[]>;
    activeKeys: Ref<string[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(lang?: string): Promise<void>;
    fetchActive(): Promise<void>;
    patchOne(id: number, payload: PatchFeatureFlagPayload): Promise<boolean>;
    isEnabled(flagKey: string): boolean;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useFeaturesStore = defineStore('features', (): FeaturesStoreSetup => {
    const flags = ref<FeatureFlag[]>([]);
    const activeKeys = ref<string[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[features-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[features-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    /** Fetch full flag list (with labels) for a given language. */
    async function fetchAll(lang?: string): Promise<void> {
        loading.value = true;
        clearError();
        try {
            flags.value = await featuresApi.list(lang);
            logger.info('[features-store] fetched', { count: flags.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /** Fetch only the enabled flagKey strings (boot / lightweight use). */
    async function fetchActive(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            activeKeys.value = await featuresApi.listActive();
            logger.info('[features-store] active keys', { count: activeKeys.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Toggle / patch a single flag.
     * Optimistically updates the local list so the UI responds immediately,
     * then rolls back on API error.
     */
    async function patchOne(id: number, payload: PatchFeatureFlagPayload): Promise<boolean> {
        const idx = flags.value.findIndex(f => f.id === id);
        const snapshot = idx !== -1 ? { ...flags.value[idx] } : null;

        // Optimistic update
        if (idx !== -1 && payload.enabled !== undefined) {
            flags.value[idx] = { ...flags.value[idx]!, enabled: payload.enabled };
        }

        try {
            await featuresApi.patch(id, payload);
            logger.info('[features-store] patched', { id, payload });
            return true;
        } catch (e) {
            // Roll back
            if (snapshot && idx !== -1) flags.value[idx] = snapshot as FeatureFlag;
            setError(e);
            return false;
        }
    }

    /** Quick check by flagKey string — used by components to gate UI sections. */
    function isEnabled(flagKey: string): boolean {
        const flag = flags.value.find(f => f.flagKey === flagKey);
        if (flag) return flag.enabled;
        // Fall back to activeKeys list if full flags not yet loaded
        return activeKeys.value.includes(flagKey);
    }

    return {
        flags,
        activeKeys,
        loading,
        error,
        fetchAll,
        fetchActive,
        patchOne,
        isEnabled,
        clearError,
    };
});