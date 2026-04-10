/**
 * src/stores/settings-store.ts
 *
 * Pinia store for public settings — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Fetches and caches all public settings needed by the Welcome page and
 *     other public surfaces (app name, welcome texts, feature descriptions).
 *   • Exposes a typed helper `get(key)` so components never do raw array finds.
 *   • Welcome-page text keys (from legacy `mixed_settings`):
 *       welcome.info     — description text for the "Basic Information" section
 *       welcome.guides   — description text for "Step-by-Step Instructions"
 *       welcome.event    — description text for "Events & Courses"
 *       welcome.plan     — description text for "Integration Plans"
 *       welcome.doc      — description text for "My Documents"
 *   • The store is populated once at app start by the loadData boot (or lazily
 *     on first call to fetchAll).  Components should never call the API directly.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const settingsStore = useSettingsStore();
 *   const infoText = settingsStore.get('welcome.info');
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { settingsApi } from 'src/api/settings.api';
import type { PublicSetting } from 'src/api/settings.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Setup return type ────────────────────────────────────────────────────────

interface SettingsStoreSetup {
    settings: Ref<PublicSetting[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    /** Typed lookup — returns empty string when key is missing. */
    get(key: string): string;
    fetchAll(): Promise<void>;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSettingsStore = defineStore('settings-migrant', (): SettingsStoreSetup => {

    // ── State ──────────────────────────────────────────────────────────────────
    const settings = ref<PublicSetting[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[settings-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[settings-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Getters ────────────────────────────────────────────────────────────────

    /**
     * Look up a setting value by key.
     * Accepts both 'public.myKey' and 'myKey' (normalised internally).
     * Returns an empty string when the key is not present — components should
     * treat empty string as "use default / hide block".
     */
    function get(key: string): string {
        const normalised = key.startsWith('public.') ? key : `public.${key}`;
        return (
            settings.value.find(s => s.key === normalised || s.key === key)?.value ?? ''
        );
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(): Promise<void> {
        if (loading.value) return;
        loading.value = true;
        clearError();
        try {
            settings.value = await settingsApi.list();
            logger.info('[settings-store] fetched', { count: settings.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    return {
        settings,
        loading,
        error,
        get,
        fetchAll,
        clearError,
    };
});