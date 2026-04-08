/**
 * src/stores/process-store.ts
 *
 * Pinia store for /processes and /processes/:id/graph.
 *
 * ── State ─────────────────────────────────────────────────────────────────────
 *   processes    — paginated flat list
 *   totalCount   — server total for pagination
 *   graph        — current process graph (nodes + edges) for the graph editor
 *   loading      — true while any async op is in-flight
 *   graphLoading — true while graph fetch/save is in-flight
 *   error        — last error message
 *   activeFilter — kept in sync for count reuse on page change
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { processApi } from 'src/api/process.api';
import type {
    Process,
    ProcessFull,
    ProcessGraph,
    ProcessListFilter,
    CreateProcessPayload,
    PatchProcessPayload,
} from 'src/api/process.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ────────────────────────────────────────────────────

interface ProcessStoreSetup {
    processes: Ref<Process[]>;
    totalCount: Ref<number>;
    graph: Ref<ProcessGraph | null>;
    loading: Ref<boolean>;
    graphLoading: Ref<boolean>;
    error: Ref<string | null>;
    activeFilter: Ref<ProcessListFilter>;
    fetchAll(filter?: ProcessListFilter): Promise<void>;
    getOne(id: number): Promise<ProcessFull | null>;
    create(payload: CreateProcessPayload): Promise<Process | null>;
    save(id: number, full: ProcessFull): Promise<boolean>;
    patch(id: number, payload: PatchProcessPayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    fetchGraph(id: number): Promise<ProcessGraph | null>;
    saveGraph(id: number, graph: ProcessGraph): Promise<boolean>;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useProcessStore = defineStore('process', (): ProcessStoreSetup => {

    const processes = ref<Process[]>([]);
    const totalCount = ref(0);
    const graph = ref<ProcessGraph | null>(null);
    const loading = ref(false);
    const graphLoading = ref(false);
    const error = ref<string | null>(null);
    const activeFilter = ref<ProcessListFilter>({ page: 1, pageSize: 20 });

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[process-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[process-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Process CRUD ──────────────────────────────────────────────────────────

    async function fetchAll(filter: ProcessListFilter = {}): Promise<void> {
        loading.value = true;
        clearError();
        activeFilter.value = filter;
        try {
            const [list, count] = await Promise.all([
                processApi.list(filter),
                processApi.count(filter),
            ]);
            processes.value = list;
            totalCount.value = count;
            logger.info('[process-store] fetchAll', { count, page: filter.page ?? 1 });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<ProcessFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await processApi.getOne(id);
            logger.info('[process-store] getOne', { id, langs: Object.keys(full.translations ?? {}) });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function create(payload: CreateProcessPayload): Promise<Process | null> {
        loading.value = true;
        clearError();
        try {
            const created = await processApi.create(payload);
            processes.value.unshift(created);
            totalCount.value++;
            logger.info('[process-store] create', { id: created.id, title: created.title });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: ProcessFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await processApi.save(id, full);
            // Update local list entry
            const idx = processes.value.findIndex(p => p.id === id);
            if (idx !== -1) {
                const base = processes.value[idx] as Process;
                const srcLang = full.sourceLang ?? base.sourceLang;
                const srcTr = full.translations?.[srcLang];
                processes.value[idx] = {
                    ...base,
                    title: srcTr?.title ?? base.title,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: srcLang,
                    topicIds: full.topicIds ?? [],
                    userTypeIds: full.userTypeIds ?? [],
                    producedDocTypeIds: full.producedDocTypeIds ?? [],
                };
            }
            logger.info('[process-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchProcessPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await processApi.patch(id, payload);
            const idx = processes.value.findIndex(p => p.id === id);
            if (idx !== -1) {
                const base = processes.value[idx] as Process;
                processes.value[idx] = {
                    ...base,
                    ...(payload.status && { status: payload.status }),
                };
            }
            logger.info('[process-store] patch', { id, fields: Object.keys(payload) });
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
            await processApi.remove(id);
            processes.value = processes.value.filter(p => p.id !== id);
            totalCount.value = Math.max(0, totalCount.value - 1);
            logger.warn('[process-store] remove', { id });
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
            await processApi.publish(id);
            const idx = processes.value.findIndex(p => p.id === id);
            if (idx !== -1) {
                processes.value[idx] = { ...processes.value[idx] as Process, status: 'PUBLISHED' };
            }
            logger.info('[process-store] publish', { id });
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

    // ── Graph operations ──────────────────────────────────────────────────────

    async function fetchGraph(id: number): Promise<ProcessGraph | null> {
        graphLoading.value = true;
        clearError();
        try {
            const g = await processApi.getGraph(id);
            graph.value = g;
            logger.info('[process-store] fetchGraph', { id, nodes: g.nodes.length, edges: g.edges.length });
            return g;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            graphLoading.value = false;
        }
    }

    async function saveGraph(id: number, g: ProcessGraph): Promise<boolean> {
        graphLoading.value = true;
        clearError();
        try {
            await processApi.saveGraph(id, g);
            graph.value = g;
            // Update stepCount in the flat list
            const idx = processes.value.findIndex(p => p.id === id);
            if (idx !== -1) {
                processes.value[idx] = { ...processes.value[idx] as Process, stepCount: g.nodes.length };
            }
            logger.info('[process-store] saveGraph', { id, nodes: g.nodes.length, edges: g.edges.length });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            graphLoading.value = false;
        }
    }

    return {
        processes, totalCount, graph, loading, graphLoading, error, activeFilter,
        fetchAll, getOne, create, save, patch, remove, publish, unpublish,
        fetchGraph, saveGraph, clearError,
    };
});