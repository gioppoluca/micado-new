/**
 * src/stores/topic-store.ts
 *
 * Pinia store for topics — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Holds the full flat list of published topics.
 *   • Exposes a computed tree structure (root nodes + children) for nav menus.
 *   • Automatically re-fetches when the user switches language.
 *   • Language params (defaultlang / currentlang) are read from sibling stores
 *     — components never pass language manually.
 *
 * ── Language reactivity ───────────────────────────────────────────────────────
 *
 *   A watch on languageStore.selected triggers fetchAll() whenever the user
 *   picks a different language.  The watcher is started by calling
 *   startLanguageWatch() which must be called once from a component that is
 *   mounted for the lifetime of the app (e.g. MainLayout.vue).
 *
 *   Why not watch inside the store definition?
 *   Pinia setup stores run at instantiation time (first useTopicStore() call),
 *   which may happen before the language store is populated.  Deferring the
 *   watch to an explicit start() call avoids empty-array flickers.
 *
 * ── Tree structure ────────────────────────────────────────────────────────────
 *
 *   The backend returns a flat list with a `father` field (parent id or null).
 *   The `tree` computed builds a recursive structure suitable for q-tree or
 *   a custom sidebar nav.  Circular references are impossible because the
 *   backend validates the parent chain on write.
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { topicApi } from 'src/api/topic.api';
import type { MigrantTopic } from 'src/api/topic.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Tree node ────────────────────────────────────────────────────────────────

export interface TopicTreeNode {
    id: number;
    label: string;
    icon: string | null;
    children: TopicTreeNode[];
}

// ─── Setup return type ────────────────────────────────────────────────────────

interface TopicStoreSetup {
    topics: Ref<MigrantTopic[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    tree: ComputedRef<TopicTreeNode[]>;
    getById(id: number): MigrantTopic | undefined;
    fetchAll(): Promise<void>;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTopicStore = defineStore('topic-migrant', (): TopicStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const topics = ref<MigrantTopic[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Getters ────────────────────────────────────────────────────────────────

    /**
     * Recursive tree built from the flat list.
     * Root nodes (father=null) become top-level entries.
     */
    const tree = computed<TopicTreeNode[]>(() => {
        function buildChildren(parentId: number | null): TopicTreeNode[] {
            return topics.value
                .filter(t => t.father === parentId)
                .map(t => ({
                    id: t.id,
                    label: t.topic,
                    icon: t.icon,
                    children: buildChildren(t.id),
                }));
        }
        return buildChildren(null);
    });

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
            logger.error('[topic-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[topic-store] unexpected error', e);
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
            topics.value = await topicApi.listForMigrant(getLangParams());
            logger.info('[topic-store] fetched', { count: topics.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    function getById(id: number): MigrantTopic | undefined {
        return topics.value.find(t => t.id === id);
    }

    /**
     * Start watching the selected language.  Call this once from MainLayout.vue
     * (or equivalent) so the watch is active for the full app lifetime.
     */
    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[topic-store] language changed, re-fetching', { lang: lang.lang });
                    void fetchAll();
                }
            },
        );
    }

    return {
        topics,
        loading,
        error,
        tree,
        getById,
        fetchAll,
        startLanguageWatch,
        clearError,
    };
});