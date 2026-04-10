/**
 * src/stores/content-store.ts
 *
 * Unified content store — migrant frontend.
 *
 * ── Rationale ─────────────────────────────────────────────────────────────────
 *
 *   The home page shows a single merged list of:
 *     • Information items  (type: 'info')
 *     • Process items      (type: 'process')
 *     • Event items        (type: 'event')
 *
 *   All three share the same topic/userType filters.  This store coordinates
 *   the three API calls, merges the results into a typed union, and exposes a
 *   single `items` array that the HomePage can render with a single v-for loop.
 *
 * ── Filter state ──────────────────────────────────────────────────────────────
 *
 *   setTopicFilter(ids)     — replace the active topic ids (AND-combined on backend)
 *   clearFilters()          — reset to "show everything"
 *
 *   Changing a filter triggers a full re-fetch from page 1.
 *
 * ── Pagination (infinite scroll) ─────────────────────────────────────────────
 *
 *   The three content types are paginated independently (each backend endpoint
 *   has its own cursor).  loadNextPage() fires all three in parallel and appends
 *   results.  `hasMore` is true when ANY of the three still has pages left.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const contentStore = useContentStore();
 *   await contentStore.fetchAll();
 *   // contentStore.items → UnifiedContentItem[]
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { informationApi } from 'src/api/information.api';
import { processApi } from 'src/api/process.api';
import { eventApi } from 'src/api/event.api';
import type { MigrantInformation } from 'src/api/information.api';
import type { MigrantProcess } from 'src/api/process.api';
import type { MigrantEvent } from 'src/api/event.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Unified item type ────────────────────────────────────────────────────────

export type ContentItemType = 'info' | 'process' | 'event';

/** A single entry in the merged home-page list. */
export interface UnifiedContentItem {
    /** Discriminator — drives icon and detail-route. */
    type: ContentItemType;
    id: number;
    title: string;
    description: string | null;
    lang: string;
    topicIds: number[];
    /** Present only on events. */
    startDate?: string;
    endDate?: string;
    location?: string | null;
    isFree?: boolean;
    /** Present only on info items. */
    categoryId?: number | null;
}

// ─── Internal pagination cursors ──────────────────────────────────────────────

interface PaginationState {
    page: number;
    hasMore: boolean;
}

const PAGE_SIZE = 20;

// ─── Setup return type ────────────────────────────────────────────────────────

interface ContentStoreSetup {
    items: Ref<UnifiedContentItem[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    hasMore: ComputedRef<boolean>;
    /** Active topic filter — empty means "all topics". */
    topicIds: Ref<number[]>;
    setTopicFilter(ids: number[]): Promise<void>;
    clearFilters(): Promise<void>;
    fetchAll(): Promise<void>;
    loadNextPage(): Promise<void>;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useContentStore = defineStore('content-migrant', (): ContentStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const items = ref<UnifiedContentItem[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const topicIds = ref<number[]>([]);

    const infoPagination = ref<PaginationState>({ page: 1, hasMore: true });
    const processPagination = ref<PaginationState>({ page: 1, hasMore: true });
    const eventPagination = ref<PaginationState>({ page: 1, hasMore: true });

    // ── Getters ────────────────────────────────────────────────────────────────

    const hasMore = computed(
        () => infoPagination.value.hasMore
            || processPagination.value.hasMore
            || eventPagination.value.hasMore,
    );

    // ── Helpers ────────────────────────────────────────────────────────────────

    function getLangParams() {
        return {
            defaultlang: appStore.defaultLang || 'it',
            currentlang: languageStore.selected?.lang || appStore.defaultLang || 'it',
        };
    }

    function topicParam(): string | undefined {
        return topicIds.value.length > 0
            ? topicIds.value.join(',')
            : undefined;
    }

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[content-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[content-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // Map raw API items → UnifiedContentItem

    function mapInfo(raw: MigrantInformation): UnifiedContentItem {
        return {
            type: 'info',
            id: raw.id,
            title: raw.title,
            description: raw.description,
            lang: raw.lang,
            topicIds: raw.topicIds,
            categoryId: raw.categoryId,
        };
    }

    function mapProcess(raw: MigrantProcess): UnifiedContentItem {
        return {
            type: 'process',
            id: raw.id,
            title: raw.title,
            description: raw.description,
            lang: raw.lang,
            topicIds: raw.topicIds,
        };
    }

    function mapEvent(raw: MigrantEvent): UnifiedContentItem {
        return {
            type: 'event',
            id: raw.id,
            title: raw.title,
            description: raw.description,
            lang: raw.lang,
            topicIds: raw.topicIds,
            startDate: raw.startDate,
            endDate: raw.endDate,
            location: raw.location,
            isFree: raw.isFree,
        };
    }

    function resetPagination(): void {
        infoPagination.value = { page: 1, hasMore: true };
        processPagination.value = { page: 1, hasMore: true };
        eventPagination.value = { page: 1, hasMore: true };
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    /**
     * Fetch page 1 of all three content types and replace the items list.
     * Resets pagination state.
     */
    async function fetchAll(): Promise<void> {
        loading.value = true;
        clearError();
        resetPagination();
        const lang = getLangParams();
        const topicP = topicParam();

        try {
            const [infoRes, processRes, eventRes] = await Promise.all([
                informationApi.listForMigrant({ ...lang, ...(topicP ? { topicIds: topicP } : {}), page: 1, pageSize: PAGE_SIZE }),
                processApi.listForMigrant({ ...lang, ...(topicP ? { topicIds: topicP } : {}), page: 1, pageSize: PAGE_SIZE }),
                eventApi.listForMigrant({ ...lang, ...(topicP ? { topicIds: topicP } : {}), page: 1, pageSize: PAGE_SIZE }),
            ]);

            infoPagination.value.hasMore = infoRes.length === PAGE_SIZE;
            processPagination.value.hasMore = processRes.length === PAGE_SIZE;
            eventPagination.value.hasMore = eventRes.length === PAGE_SIZE;

            // Merge: info first, then processes, then events — matches legacy order
            items.value = [
                ...infoRes.map(mapInfo),
                ...processRes.map(mapProcess),
                ...eventRes.map(mapEvent),
            ];

            logger.info('[content-store] fetchAll done', {
                info: infoRes.length,
                process: processRes.length,
                event: eventRes.length,
            });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Append the next page of any content type that still has more items.
     * Parallel fetch — results are appended in the same type order.
     */
    async function loadNextPage(): Promise<void> {
        if (!hasMore.value || loading.value) return;
        loading.value = true;
        const lang = getLangParams();
        const topicP = topicParam();

        try {
            const topicFilter = topicP ? { topicIds: topicP } : {};
            const fetches = await Promise.all([
                infoPagination.value.hasMore
                    ? informationApi.listForMigrant({
                        ...lang,
                        ...topicFilter,
                        page: infoPagination.value.page + 1,
                        pageSize: PAGE_SIZE,
                    })
                    : Promise.resolve([]),

                processPagination.value.hasMore
                    ? processApi.listForMigrant({
                        ...lang,
                        ...topicFilter,
                        page: processPagination.value.page + 1,
                        pageSize: PAGE_SIZE,
                    })
                    : Promise.resolve([]),

                eventPagination.value.hasMore
                    ? eventApi.listForMigrant({
                        ...lang,
                        ...topicFilter,
                        page: eventPagination.value.page + 1,
                        pageSize: PAGE_SIZE,
                    })
                    : Promise.resolve([]),
            ]);

            const [infoRes, processRes, eventRes] = fetches;

            if (infoPagination.value.hasMore) {
                infoPagination.value.page++;
                infoPagination.value.hasMore = infoRes.length === PAGE_SIZE;
                items.value.push(...infoRes.map(mapInfo));
            }
            if (processPagination.value.hasMore) {
                processPagination.value.page++;
                processPagination.value.hasMore = processRes.length === PAGE_SIZE;
                items.value.push(...processRes.map(mapProcess));
            }
            if (eventPagination.value.hasMore) {
                eventPagination.value.page++;
                eventPagination.value.hasMore = eventRes.length === PAGE_SIZE;
                items.value.push(...eventRes.map(mapEvent));
            }

            logger.info('[content-store] loadNextPage done', {
                appendedInfo: infoRes.length,
                appendedProcess: processRes.length,
                appendedEvent: eventRes.length,
            });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function setTopicFilter(ids: number[]): Promise<void> {
        topicIds.value = ids;
        logger.info('[content-store] topic filter changed', { ids });
        await fetchAll();
    }

    async function clearFilters(): Promise<void> {
        topicIds.value = [];
        await fetchAll();
    }

    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[content-store] language changed, re-fetching', { lang: lang.lang });
                    void fetchAll();
                }
            },
        );
    }

    return {
        items,
        loading,
        error,
        hasMore,
        topicIds,
        setTopicFilter,
        clearFilters,
        fetchAll,
        loadNextPage,
        startLanguageWatch,
        clearError,
    };
});