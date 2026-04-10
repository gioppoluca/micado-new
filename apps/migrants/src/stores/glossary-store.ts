/**
 * src/stores/glossary-store.ts
 *
 * Pinia store for glossary terms — migrant frontend.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Holds the complete published glossary (no pagination — terms are few).
 *   • Exposes a computed Map for O(1) lookup by term id (used by inline tooltips
 *     and the mention renderer in rich-text content).
 *   • Exposes an alphabetical sorted list for the glossary index page.
 *   • Re-fetches automatically on language change.
 *
 * ── Usage in components ───────────────────────────────────────────────────────
 *
 *   Inline term lookup (e.g. from a rich-text mention):
 *     const { termById } = useGlossaryStore();
 *     const term = termById.get(mentionId);
 *
 *   Glossary index page:
 *     const { sortedTerms, loading } = useGlossaryStore();
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { glossaryApi } from 'src/api/glossary.api';
import type { MigrantGlossaryTerm } from 'src/api/glossary.api';
import { useLanguageStore } from 'src/stores/language-store';
import { useAppStore } from 'src/stores/app-store';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Setup return type ────────────────────────────────────────────────────────

interface GlossaryStoreSetup {
    terms: Ref<MigrantGlossaryTerm[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    /** O(1) lookup by numeric id — rebuilt whenever terms changes. */
    termById: ComputedRef<Map<number, MigrantGlossaryTerm>>;
    /** All terms sorted alphabetically by title (locale-aware). */
    sortedTerms: ComputedRef<MigrantGlossaryTerm[]>;
    fetchAll(): Promise<void>;
    startLanguageWatch(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGlossaryStore = defineStore('glossary-migrant', (): GlossaryStoreSetup => {
    const languageStore = useLanguageStore();
    const appStore = useAppStore();

    // ── State ──────────────────────────────────────────────────────────────────
    const terms = ref<MigrantGlossaryTerm[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Getters ────────────────────────────────────────────────────────────────

    const termById = computed<Map<number, MigrantGlossaryTerm>>(
        () => new Map(terms.value.map(t => [t.id, t])),
    );

    const sortedTerms = computed<MigrantGlossaryTerm[]>(() =>
        [...terms.value].sort((a, b) =>
            a.title.localeCompare(b.title, languageStore.selected?.lang ?? 'en'),
        ),
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
            logger.error('[glossary-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[glossary-store] unexpected error', e);
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
            terms.value = await glossaryApi.listForMigrant(getLangParams());
            logger.info('[glossary-store] fetched', { count: terms.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    function startLanguageWatch(): void {
        watch(
            () => languageStore.selected,
            (lang) => {
                if (lang) {
                    logger.info('[glossary-store] language changed, re-fetching', { lang: lang.lang });
                    void fetchAll();
                }
            },
        );
    }

    return {
        terms,
        loading,
        error,
        termById,
        sortedTerms,
        fetchAll,
        startLanguageWatch,
        clearError,
    };
});