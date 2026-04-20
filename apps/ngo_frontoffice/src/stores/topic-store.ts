/**
 * src/stores/topic-store.ts
 *
 * Pinia store for the /topics resource.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   topics   — flat list (Topic[]) — drives the list view and tree building
 *   loading  — true while any async operation is in flight
 *   error    — last error message, null when clean
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll()               — GET /topics → replace topics list
 *   getOne(id)               — GET /topics/:id → returns TopicFull (for form)
 *   create(payload)          — POST /topics → push flat record into list
 *   save(id, full)           — PUT /topics/:id (form save — all translations)
 *   patch(id, partial)       — PATCH /topics/:id (status, icon, parentId)
 *   remove(id)               — DELETE + filter list (409 surfaced as error)
 *   publish(id)              — GET to-production → update local status
 *   unpublish(id)            — PATCH status=DRAFT
 *   clearError()
 *
 * ── Tree helpers (client-side) ────────────────────────────────────────────────
 *   toTreeNodes(maxSelectableDepth, excludeId?)
 *     Converts the flat topics[] into the nested structure expected by
 *     vue3-treeselect.  Nodes at depth >= maxSelectableDepth are disabled.
 *     Called by TopicTreeSelect.vue.
 */

import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { topicApi, toTreeNodes } from 'src/api/topic.api';
import type {
    Topic,
    TopicFull,
    CreateTopicPayload,
    PatchTopicPayload,
    TopicTreeNode,
} from 'src/api/topic.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ─────────────────────────────────────────────────────

interface TopicStoreSetup {
    topics: Ref<Topic[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(): Promise<void>;
    getOne(id: number): Promise<TopicFull | null>;
    create(payload: CreateTopicPayload): Promise<Topic | null>;
    save(id: number, full: TopicFull): Promise<boolean>;
    patch(id: number, payload: PatchTopicPayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
    /** Reactive tree nodes for vue3-treeselect. Re-computed on any topics change. */
    treeNodes(maxSelectableDepth: number, excludeId?: number): TopicTreeNode[];
    /** Flat list filtered to published topics only (migrant / process tag pickers). */
    publishedTopics: ComputedRef<Topic[]>;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useTopicStore = defineStore('topic', (): TopicStoreSetup => {

    // ── State ──────────────────────────────────────────────────────────────────

    const topics = ref<Topic[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Computed ───────────────────────────────────────────────────────────────

    const publishedTopics = computed(() => topics.value.filter(t => t.status === 'PUBLISHED'));

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[topic-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[topic-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            topics.value = await topicApi.list();
            logger.info('[topic-store] fetchAll', { count: topics.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<TopicFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await topicApi.getOne(id);
            logger.info('[topic-store] getOne', { id, langs: Object.keys(full.translations ?? {}) });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function create(payload: CreateTopicPayload): Promise<Topic | null> {
        loading.value = true;
        clearError();
        try {
            const created = await topicApi.create(payload);
            topics.value.push(created);
            logger.info('[topic-store] create', { id: created.id, parentId: created.parentId, depth: created.depth });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: TopicFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await topicApi.save(id, full);

            // Sync flat list entry from sourceLang translation
            const srcLang = full.sourceLang;
            const srcTr = srcLang ? full.translations?.[srcLang] : undefined;
            const idx = topics.value.findIndex(t => t.id === id);
            if (idx !== -1) {
                const base: Topic = topics.value[idx] as Topic;
                const merged: Topic = {
                    ...base,
                    topic: srcTr?.title ?? base.topic,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: full.sourceLang ?? base.sourceLang,
                    parentId: full.parentId !== undefined ? full.parentId : base.parentId,
                    // depth stays as-is — backend recomputes; full re-fetch on next open
                };
                if (full.dataExtra !== undefined) merged.dataExtra = full.dataExtra;
                topics.value[idx] = merged;
            }
            logger.info('[topic-store] save', { id, status: full.status, parentId: full.parentId });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchTopicPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await topicApi.patch(id, payload);
            const idx = topics.value.findIndex(t => t.id === id);
            if (idx !== -1) {
                const update: Partial<Topic> = {};
                if (payload.status !== undefined) update.status = payload.status;
                if (payload.sourceLang !== undefined) update.sourceLang = payload.sourceLang;
                if (payload.dataExtra !== undefined) update.dataExtra = payload.dataExtra;
                if (payload.parentId !== undefined) update.parentId = payload.parentId;
                const base: Topic = topics.value[idx] as Topic;
                topics.value[idx] = { ...base, ...update };
            }
            logger.info('[topic-store] patch', { id, fields: Object.keys(payload) });
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
            await topicApi.remove(id);
            topics.value = topics.value.filter(t => t.id !== id);
            logger.warn('[topic-store] remove', { id });
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
            await topicApi.publish(id);
            const idx = topics.value.findIndex(t => t.id === id);
            if (idx !== -1) {
                const base: Topic = topics.value[idx] as Topic;
                topics.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[topic-store] publish', { id });
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

    /**
     * Returns the nested tree for vue3-treeselect.
     * Not a computed() because it depends on runtime args (maxSelectableDepth, excludeId).
     * Called reactively from TopicTreeSelect.vue which watches topics.
     */
    function treeNodes(maxSelectableDepth: number, excludeId?: number): TopicTreeNode[] {
        return toTreeNodes(topics.value, maxSelectableDepth, excludeId);
    }

    return {
        topics,
        loading,
        error,
        fetchAll,
        getOne,
        create,
        save,
        patch,
        remove,
        publish,
        unpublish,
        clearError,
        treeNodes,
        publishedTopics,
    };
});