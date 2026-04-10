/**
 * src/stores/process-store.ts
 *
 * Pinia store for processes — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Paginated list of published processes in the user's language.
 *   • Filter state (topicIds, userTypeIds) — processes have no categoryId.
 *   • Automatic re-fetch on language change (via startLanguageWatch).
 *   • Infinite-scroll support via loadNextPage().
 *
 * ── Note on graph data ────────────────────────────────────────────────────────
 *
 *   The migrant endpoint returns only the process header (title, description,
 *   topicIds, userTypeIds).  Step-by-step graph data (nodes + edges) is
 *   currently only available via the authenticated PA endpoint
 *   GET /processes/:id/graph.
 *
 *   When a read-only process graph page is built for the migrant app, a new
 *   action `fetchGraph(id)` should be added here, calling a future public
 *   /processes-migrant/:id/graph endpoint.
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { processApi } from 'src/api/process.api';
import type { MigrantProcess, ProcessMigrantParams } from 'src/api/process.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Filter shape ─────────────────────────────────────────────────────────────

export interface ProcessFilter {
    topicIds?: number[];
    userTypeIds?: number[];
}

// ─── Setup return type ────────────────────────────────────────────────────────

interface ProcessStoreSetup {
    items: Ref<MigrantProcess[]>;
    loading: Ref<boolean>;
    loadingMore: Ref<boolean>;
    error: Ref<string | null>;
    filter: Ref<ProcessFilter>;
    currentPage: Ref<number>;
    pageSize: Ref<number>;
    hasMore: ComputedRef<boolean>;
    fetchPage(): Promise<void>;
    loadNextPage(): Promise<void>;
    setFilter(f: ProcessFilter): void;
    resetFilter(): void;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useProcessStore = defineStore('process-migrant', (): ProcessStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const items = ref<MigrantProcess[]>([]);
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<string | null>(null);
    const filter = ref<ProcessFilter>({});
    const currentPage = ref(1);
    const pageSize = ref(20);
    const lastFetchCount = ref(0);

    // ── Getters ────────────────────────────────────────────────────────────────

    const hasMore = computed(() => lastFetchCount.value >= pageSize.value);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function buildParams(page: number): ProcessMigrantParams {
        const f = filter.value;
        return {
            defaultlang: appStore.defaultLang || 'it',
            currentlang: languageStore.selected?.lang || appStore.defaultLang || 'it',
            ...(f.topicIds?.length ? { topicIds: f.topicIds.join(',') } : {}),
            ...(f.userTypeIds?.length ? { userTypeIds: f.userTypeIds.join(',') } : {}),
            page,
            pageSize: pageSize.value,
        };
    }

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[process-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[process-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchPage(): Promise<void> {
        loading.value = true;
        clearError();
        currentPage.value = 1;
        try {
            const result = await processApi.listForMigrant(buildParams(1));
            items.value = result;
            lastFetchCount.value = result.length;
            logger.info('[process-store] fetched page 1', { count: result.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function loadNextPage(): Promise<void> {
        if (!hasMore.value || loadingMore.value || loading.value) return;
        loadingMore.value = true;
        try {
            const nextPage = currentPage.value + 1;
            const result = await processApi.listForMigrant(buildParams(nextPage));
            items.value = [...items.value, ...result];
            lastFetchCount.value = result.length;
            currentPage.value = nextPage;
            logger.info('[process-store] loaded page', { page: nextPage, count: result.length });
        } catch (e) {
            setError(e);
        } finally {
            loadingMore.value = false;
        }
    }

    function setFilter(f: ProcessFilter): void {
        filter.value = { ...f };
        logger.info('[process-store] filter set', filter.value);
        void fetchPage();
    }

    function resetFilter(): void {
        filter.value = {};
        void fetchPage();
    }

    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[process-store] language changed, re-fetching', { lang: lang.lang });
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