/**
 * src/stores/information-store.ts
 *
 * Pinia store for the /information resource (Useful Information Centre).
 *
 * Identical in structure to event-store.ts, without dataExtra handling.
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { informationApi } from 'src/api/information.api';
import type {
    Information,
    InformationFull,
    InformationListFilter,
    CreateInformationPayload,
    PatchInformationPayload,
} from 'src/api/information.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ────────────────────────────────────────────────────

interface InformationStoreSetup {
    items: Ref<Information[]>;
    totalCount: Ref<number>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    activeFilter: Ref<InformationListFilter>;
    fetchAll(filter?: InformationListFilter): Promise<void>;
    getOne(id: number): Promise<InformationFull | null>;
    create(payload: CreateInformationPayload): Promise<Information | null>;
    save(id: number, full: InformationFull): Promise<boolean>;
    patch(id: number, payload: PatchInformationPayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useInformationStore = defineStore('information', (): InformationStoreSetup => {

    const items = ref<Information[]>([]);
    const totalCount = ref(0);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const activeFilter = ref<InformationListFilter>({ page: 1, pageSize: 20 });

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[information-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[information-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(filter: InformationListFilter = {}): Promise<void> {
        loading.value = true;
        clearError();
        activeFilter.value = filter;
        try {
            const [list, count] = await Promise.all([
                informationApi.list(filter),
                informationApi.count(filter),
            ]);
            items.value = list;
            totalCount.value = count;
            logger.info('[information-store] fetchAll', { count, page: filter.page ?? 1 });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<InformationFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await informationApi.getOne(id);
            logger.info('[information-store] getOne', {
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

    async function create(payload: CreateInformationPayload): Promise<Information | null> {
        loading.value = true;
        clearError();
        try {
            const created = await informationApi.create(payload);
            items.value.unshift(created);
            totalCount.value++;
            logger.info('[information-store] create', { id: created.id, title: created.title });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: InformationFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await informationApi.save(id, full);
            const idx = items.value.findIndex(i => i.id === id);
            if (idx !== -1) {
                const base: Information = items.value[idx] as Information;
                const srcLang = full.sourceLang ?? base.sourceLang;
                const srcTr = full.translations?.[srcLang];
                items.value[idx] = {
                    ...base,
                    title: srcTr?.title ?? base.title,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: srcLang,
                    categoryId: full.categoryId ?? null,
                    topicIds: full.topicIds ?? [],
                    userTypeIds: full.userTypeIds ?? [],
                };
            }
            logger.info('[information-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchInformationPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await informationApi.patch(id, payload);
            const idx = items.value.findIndex(i => i.id === id);
            if (idx !== -1) {
                const base: Information = items.value[idx] as Information;
                items.value[idx] = {
                    ...base,
                    ...(payload.status && { status: payload.status }),
                };
            }
            logger.info('[information-store] patch', { id, fields: Object.keys(payload) });
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
            await informationApi.remove(id);
            items.value = items.value.filter(i => i.id !== id);
            totalCount.value = Math.max(0, totalCount.value - 1);
            logger.warn('[information-store] remove', { id });
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
            await informationApi.publish(id);
            const idx = items.value.findIndex(i => i.id === id);
            if (idx !== -1) {
                const base: Information = items.value[idx] as Information;
                items.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[information-store] publish', { id });
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
        items, totalCount, loading, error, activeFilter,
        fetchAll, getOne, create, save, patch, remove,
        publish, unpublish, clearError,
    };
});