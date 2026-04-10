/**
 * src/stores/information-store.ts
 *
 * Pinia store for information items — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Paginated list of published information items in the user's language.
 *   • Client-side filter state (categoryId, topicIds, userTypeIds) that drives
 *     the query params sent to the backend.
 *   • Automatic re-fetch on language change (via startLanguageWatch).
 *   • Infinite-scroll / load-more support via loadNextPage().
 *
 * ── Filter state ──────────────────────────────────────────────────────────────
 *
 *   Filters are stored in the store so the list page can restore them when
 *   the user navigates back (no need for route query params).
 *   setFilter() resets pagination to page 1 and triggers a new fetch.
 *
 * ── Pagination ────────────────────────────────────────────────────────────────
 *
 *   The backend does not return a total count.
 *   `hasMore` is true when the last response contained exactly pageSize items,
 *   meaning there may be more on the next page.
 *   loadNextPage() appends to the existing list (infinite scroll pattern).
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { informationApi } from 'src/api/information.api';
import type { MigrantInformation, InformationMigrantParams } from 'src/api/information.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Filter shape ─────────────────────────────────────────────────────────────

export interface InformationFilter {
    categoryId?: number;
    topicIds?: number[];
    userTypeIds?: number[];
}

// ─── Setup return type ────────────────────────────────────────────────────────

interface InformationStoreSetup {
    items: Ref<MigrantInformation[]>;
    loading: Ref<boolean>;
    loadingMore: Ref<boolean>;
    error: Ref<string | null>;
    filter: Ref<InformationFilter>;
    currentPage: Ref<number>;
    pageSize: Ref<number>;
    hasMore: ComputedRef<boolean>;
    fetchPage(): Promise<void>;
    loadNextPage(): Promise<void>;
    setFilter(f: InformationFilter): void;
    resetFilter(): void;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useInformationStore = defineStore('information-migrant', (): InformationStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const items = ref<MigrantInformation[]>([]);
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<string | null>(null);
    const filter = ref<InformationFilter>({});
    const currentPage = ref(1);
    const pageSize = ref(20);
    /** Tracks the count returned by the last fetch to determine hasMore. */
    const lastFetchCount = ref(0);

    // ── Getters ────────────────────────────────────────────────────────────────

    const hasMore = computed(() => lastFetchCount.value >= pageSize.value);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function buildParams(page: number): InformationMigrantParams {
        const f = filter.value;
        return {
            defaultlang: appStore.defaultLang || 'it',
            currentlang: languageStore.selected?.lang || appStore.defaultLang || 'it',
            ...(f.categoryId !== undefined ? { categoryId: f.categoryId } : {}),
            ...(f.topicIds?.length ? { topicIds: f.topicIds.join(',') } : {}),
            ...(f.userTypeIds?.length ? { userTypeIds: f.userTypeIds.join(',') } : {}),
            page,
            pageSize: pageSize.value,
        };
    }

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[information-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[information-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    /**
     * Fetch page 1, replacing any existing list.
     * Used on initial load, language change, and filter change.
     */
    async function fetchPage(): Promise<void> {
        loading.value = true;
        clearError();
        currentPage.value = 1;
        try {
            const result = await informationApi.listForMigrant(buildParams(1));
            items.value = result;
            lastFetchCount.value = result.length;
            logger.info('[information-store] fetched page 1', { count: result.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Append the next page to the existing list (infinite scroll).
     * No-op if hasMore is false or a fetch is already in progress.
     */
    async function loadNextPage(): Promise<void> {
        if (!hasMore.value || loadingMore.value || loading.value) return;
        loadingMore.value = true;
        try {
            const nextPage = currentPage.value + 1;
            const result = await informationApi.listForMigrant(buildParams(nextPage));
            items.value = [...items.value, ...result];
            lastFetchCount.value = result.length;
            currentPage.value = nextPage;
            logger.info('[information-store] loaded page', { page: nextPage, count: result.length });
        } catch (e) {
            setError(e);
        } finally {
            loadingMore.value = false;
        }
    }

    /**
     * Apply a new filter and reset to page 1.
     * Partial: only the provided keys are updated; omit a key to keep it.
     */
    function setFilter(f: InformationFilter): void {
        filter.value = { ...f };
        logger.info('[information-store] filter set', filter.value);
        void fetchPage();
    }

    function resetFilter(): void {
        filter.value = {};
        void fetchPage();
    }

    /**
     * Watch for language changes and re-fetch from page 1.
     * Call once from MainLayout.vue.
     */
    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[information-store] language changed, re-fetching', { lang: lang.lang });
                    void fetchPage();
                }
            },
        );
    }

    return {
        items,
        loading,
        loadingMore,
        error,
        filter,
        currentPage,
        pageSize,
        hasMore,
        fetchPage,
        loadNextPage,
        setFilter,
        resetFilter,
        startLanguageWatch,
        clearError,
    };
});