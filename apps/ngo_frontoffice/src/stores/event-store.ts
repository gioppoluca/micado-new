/**
 * src/stores/event-store.ts
 *
 * Pinia store for the /events resource.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   events      — paginated flat list currently displayed
 *   totalCount  — total matching events (for pagination UI)
 *   loading     — true while any async op is in-flight
 *   error       — last error message, null when clean
 *   activeFilter — current filter applied (kept in sync for count re-use)
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll(filter)   — GET /events + GET /events/count → replace list
 *   getOne(id)         — GET /events/:id → returns EventFull (not cached)
 *   create(payload)    — POST /events → push into list head
 *   save(id, full)     — PUT /events/:id
 *   patch(id, partial) — PATCH /events/:id (status toggle etc.)
 *   remove(id)         — DELETE + filter list
 *   publish(id)        — to-production + update local status
 *   unpublish(id)      — PATCH status=DRAFT
 *   clearError()
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { eventApi } from 'src/api/event.api';
import type {
    Event,
    EventFull,
    EventListFilter,
    CreateEventPayload,
    PatchEventPayload,
} from 'src/api/event.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ────────────────────────────────────────────────────

interface EventStoreSetup {
    events: Ref<Event[]>;
    totalCount: Ref<number>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    activeFilter: Ref<EventListFilter>;
    fetchAll(filter?: EventListFilter): Promise<void>;
    getOne(id: number): Promise<EventFull | null>;
    create(payload: CreateEventPayload): Promise<Event | null>;
    save(id: number, full: EventFull): Promise<boolean>;
    patch(id: number, payload: PatchEventPayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEventStore = defineStore('event', (): EventStoreSetup => {

    const events = ref<Event[]>([]);
    const totalCount = ref(0);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const activeFilter = ref<EventListFilter>({ page: 1, pageSize: 20 });

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[event-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[event-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(filter: EventListFilter = {}): Promise<void> {
        loading.value = true;
        clearError();
        activeFilter.value = filter;
        try {
            const [list, count] = await Promise.all([
                eventApi.list(filter),
                eventApi.count(filter),
            ]);
            events.value = list;
            totalCount.value = count;
            logger.info('[event-store] fetchAll', {
                count, page: filter.page ?? 1, filter,
            });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<EventFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await eventApi.getOne(id);
            logger.info('[event-store] getOne', {
                id, langs: Object.keys(full.translations ?? {}),
            });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function create(payload: CreateEventPayload): Promise<Event | null> {
        loading.value = true;
        clearError();
        try {
            const created = await eventApi.create(payload);
            events.value.unshift(created);
            totalCount.value++;
            logger.info('[event-store] create', { id: created.id, title: created.title });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: EventFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await eventApi.save(id, full);
            const idx = events.value.findIndex(e => e.id === id);
            if (idx !== -1) {
                const base: Event = events.value[idx] as Event;
                const srcLang = full.sourceLang ?? base.sourceLang;
                const srcTr = full.translations?.[srcLang];
                events.value[idx] = {
                    ...base,
                    title: srcTr?.title ?? base.title,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: srcLang,
                    dataExtra: full.dataExtra ?? base.dataExtra,
                    categoryId: full.categoryId ?? null,
                    topicIds: full.topicIds ?? [],
                    userTypeIds: full.userTypeIds ?? [],
                };
            }
            logger.info('[event-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchEventPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await eventApi.patch(id, payload);
            const idx = events.value.findIndex(e => e.id === id);
            if (idx !== -1) {
                const base: Event = events.value[idx] as Event;
                events.value[idx] = {
                    ...base,
                    ...(payload.status && { status: payload.status }),
                    ...(payload.dataExtra && { dataExtra: { ...base.dataExtra, ...payload.dataExtra } }),
                };
            }
            logger.info('[event-store] patch', { id, fields: Object.keys(payload) });
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
            await eventApi.remove(id);
            events.value = events.value.filter(e => e.id !== id);
            totalCount.value = Math.max(0, totalCount.value - 1);
            logger.warn('[event-store] remove', { id });
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
            await eventApi.publish(id);
            const idx = events.value.findIndex(e => e.id === id);
            if (idx !== -1) {
                events.value[idx] = { ...events.value[idx] as Event, status: 'PUBLISHED' };
            }
            logger.info('[event-store] publish', { id });
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
        events, totalCount, loading, error, activeFilter,
        fetchAll, getOne, create, save, patch, remove,
        publish, unpublish, clearError,
    };
});