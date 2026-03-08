/**
 * src/stores/language-store.ts
 *
 * Pinia store for the languages resource.
 *
 * Pages never import languageApi directly — they call store actions.
 * This keeps API knowledge out of components and makes the store the
 * single source of truth for language state across the whole app.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { languageApi } from 'src/api/language.api';
import type {
    Language,
    LanguageListParams,
    CreateLanguagePayload,
    PatchLanguagePayload,
} from 'src/api/language.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

export const useLanguageStore = defineStore('language', () => {
    // ── State ──────────────────────────────────────────────────────────────────
    const languages = ref<Language[]>([]);
    const selected = ref<Language | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Getters ────────────────────────────────────────────────────────────────
    const activeLanguages = computed(() =>
        languages.value.filter(l => l.active),
    );

    const defaultLanguage = computed(() =>
        languages.value.find(l => l.isDefault) ?? null,
    );

    // ── Helpers ────────────────────────────────────────────────────────────────
    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[language-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[language-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(params?: LanguageListParams): Promise<void> {
        loading.value = true;
        clearError();
        try {
            languages.value = await languageApi.list(params);
            logger.info('[language-store] fetched', { count: languages.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function fetchOne(lang: string): Promise<void> {
        loading.value = true;
        clearError();
        try {
            selected.value = await languageApi.getOne(lang);
            logger.info('[language-store] fetchOne done', { lang });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    function select(lang: Language): void {
        selected.value = lang;
        logger.info('[language-store] selected', { lang: lang.lang });
    }

    async function create(payload: CreateLanguagePayload): Promise<Language | null> {
        loading.value = true;
        clearError();
        try {
            const created = await languageApi.create(payload);
            languages.value.push(created);
            logger.info('[language-store] created', { lang: created.lang });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function patch(lang: string, payload: PatchLanguagePayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await languageApi.patch(lang, payload);
            // Update local cache optimistically
            const idx = languages.value.findIndex(l => l.lang === lang);
            if (idx !== -1) {
                languages.value[idx] = { ...languages.value[idx]!, ...payload };
            }
            logger.info('[language-store] patched', { lang });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function remove(lang: string): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await languageApi.remove(lang);
            languages.value = languages.value.filter(l => l.lang !== lang);
            if (selected.value?.lang === lang) selected.value = null;
            logger.warn('[language-store] removed', { lang });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    return {
        // state
        languages,
        selected,
        loading,
        error,
        // getters
        activeLanguages,
        defaultLanguage,
        // actions
        fetchAll,
        fetchOne,
        select,
        create,
        patch,
        remove,
        clearError,
    };
});