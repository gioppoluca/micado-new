/**
 * src/stores/category-store.ts
 *
 * Pinia store for categories — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Holds all published categories (both subtypes: 'information', 'event', 'both').
 *   • Exposes filtered computed getters by subtype for convenience.
 *   • Re-fetches automatically when the user switches language.
 *
 * ── Subtype semantics ─────────────────────────────────────────────────────────
 *
 *   'information' — applies only to information items
 *   'event'       — applies only to events
 *   'both'        — appears in both information and event filter UIs
 *
 *   The computed getters `informationCategories` and `eventCategories` include
 *   subtype='both' entries so the UI does not need to merge manually.
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { categoryApi } from 'src/api/category.api';
import type { MigrantCategory } from 'src/api/category.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Setup return type ────────────────────────────────────────────────────────

interface CategoryStoreSetup {
    categories: Ref<MigrantCategory[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    informationCategories: ComputedRef<MigrantCategory[]>;
    eventCategories: ComputedRef<MigrantCategory[]>;
    getById(id: number): MigrantCategory | undefined;
    fetchAll(): Promise<void>;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCategoryStore = defineStore('category-migrant', (): CategoryStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const categories = ref<MigrantCategory[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Getters ────────────────────────────────────────────────────────────────

    /** Categories usable for filtering information items (subtype = 'information' | 'both'). */
    const informationCategories = computed<MigrantCategory[]>(() =>
        categories.value.filter(c => c.subtype === 'information' || c.subtype === 'both'),
    );

    /** Categories usable for filtering events (subtype = 'event' | 'both'). */
    const eventCategories = computed<MigrantCategory[]>(() =>
        categories.value.filter(c => c.subtype === 'event' || c.subtype === 'both'),
    );

    // ── Helpers ────────────────────────────────────────────────────────────────

    function getLangParams() {
        return {
            defaultlang: appStore.defaultLang || 'it',
            currentlang: languageStore.selected?.lang || appStore.defaultLang || 'it',
        };
    }

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[category-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[category-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            // Fetch all subtypes in one call (no subtype filter = all returned).
            categories.value = await categoryApi.listForMigrant(getLangParams());
            logger.info('[category-store] fetched', { count: categories.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    function getById(id: number): MigrantCategory | undefined {
        return categories.value.find(c => c.id === id);
    }

    /**
     * Start watching the selected language.  Call once from MainLayout.vue.
     */
    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[category-store] language changed, re-fetching', { lang: lang.lang });
                    void fetchAll();
                }
            },
        );
    }

    return {
        categories,
        loading,
        error,
        informationCategories,
        eventCategories,
        getById,
        fetchAll,
        startLanguageWatch,
        clearError,
    };
});