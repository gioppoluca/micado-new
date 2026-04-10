/**
 * src/stores/event-store.ts
 *
 * Pinia store for events — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Paginated list of published events in the user's language.
 *   • Client-side filter state (categoryId, topicIds, userTypeIds).
 *   • Automatic re-fetch on language change (via startLanguageWatch).
 *   • Infinite-scroll support via loadNextPage().
 *   • Computed helpers for upcoming vs past events (client-side split).
 *
 * ── Date sorting ──────────────────────────────────────────────────────────────
 *
 *   Events are returned by the backend in insertion order.
 *   The `upcoming` and `past` computed getters split and sort client-side:
 *     upcoming: startDate >= now, sorted ASC  (soonest first)
 *     past:     startDate <  now, sorted DESC (most recent first)
 *
 *   For large datasets a server-side sort parameter should be added to the
 *   backend endpoint.  At the current scale this is acceptable.
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { eventApi } from 'src/api/event.api';
import type { MigrantEvent, EventMigrantParams } from 'src/api/event.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Filter shape ─────────────────────────────────────────────────────────────

export interface EventFilter {
    categoryId?: number;
    topicIds?: number[];
    userTypeIds?: number[];
}

// ─── Setup return type ────────────────────────────────────────────────────────

interface EventStoreSetup {
    items: Ref<MigrantEvent[]>;
    loading: Ref<boolean>;
    loadingMore: Ref<boolean>;
    error: Ref<string | null>;
    filter: Ref<EventFilter>;
    currentPage: Ref<number>;
    pageSize: Ref<number>;
    hasMore: ComputedRef<boolean>;
    upcoming: ComputedRef<MigrantEvent[]>;
    past: ComputedRef<MigrantEvent[]>;
    fetchPage(): Promise<void>;
    loadNextPage(): Promise<void>;
    setFilter(f: EventFilter): void;
    resetFilter(): void;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEventStore = defineStore('event-migrant', (): EventStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const items = ref<MigrantEvent[]>([]);
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<string | null>(null);
    const filter = ref<EventFilter>({});
    const currentPage = ref(1);
    const pageSize = ref(20);
    const lastFetchCount = ref(0);

    // ── Getters ────────────────────────────────────────────────────────────────

    const hasMore = computed(() => lastFetchCount.value >= pageSize.value);

    const upcoming = computed<MigrantEvent[]>(() => {
        const now = new Date();
        return items.value
            .filter(e => new Date(e.startDate) >= now)
            .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    });

    const past = computed<MigrantEvent[]>(() => {
        const now = new Date();
        return items.value
            .filter(e => new Date(e.startDate) < now)
            .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    });

    // ── Helpers ────────────────────────────────────────────────────────────────

    function buildParams(page: number): EventMigrantParams {
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
            logger.error('[event-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[event-store] unexpected error', e);
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
            const result = await eventApi.listForMigrant(buildParams(1));
            items.value = result;
            lastFetchCount.value = result.length;
            logger.info('[event-store] fetched page 1', { count: result.length });
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
            const result = await eventApi.listForMigrant(buildParams(nextPage));
            items.value = [...items.value, ...result];
            lastFetchCount.value = result.length;
            currentPage.value = nextPage;
            logger.info('[event-store] loaded page', { page: nextPage, count: result.length });
        } catch (e) {
            setError(e);
        } finally {
            loadingMore.value = false;
        }
    }

    function setFilter(f: EventFilter): void {
        filter.value = { ...f };
        logger.info('[event-store] filter set', filter.value);
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
                    logger.info('[event-store] language changed, re-fetching', { lang: lang.lang });
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
        upcoming,
        past,
        fetchPage,
        loadNextPage,
        setFilter,
        resetFilter,
        startLanguageWatch,
        clearError,
    };
});