/**
 * src/stores/language-store.ts
 *
 * Pinia store for the languages resource.
 *
 * Pages never import languageApi directly — they call store actions.
 * This keeps API knowledge out of components and makes the store the
 * single source of truth for language state across the whole app.
 *
 * Return type annotation
 * ──────────────────────
 * The setup function is annotated with an explicit return type interface.
 * Without this, vue-tsc with strict:true infers a narrowed type from the
 * return object literal that can omit functions added incrementally (such as
 * setDefaultByLang), producing false "property does not exist" errors at
 * call sites even though the function is present at runtime.
 *
 * The interface uses Ref<T> for state (matching what the setup function
 * returns before Pinia's ref-unwrapping kicks in at the store boundary) so
 * there is no cast needed.
 */

import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { languageApi } from 'src/api/language.api';
import type {
    Language,
    LanguageListParams,
    CreateLanguagePayload,
    PatchLanguagePayload,
} from 'src/api/language.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Setup return type ────────────────────────────────────────────────────────
// Typed in terms of what the setup function returns (Ref<T> / ComputedRef<T>),
// not what the store exposes after Pinia's unwrapping.  This avoids casts.

interface LanguageStoreSetup {
    languages: Ref<Language[]>;
    selected: Ref<Language | null>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    activeLanguages: ComputedRef<Language[]>;
    defaultLanguage: ComputedRef<Language | null>;
    fetchAll(params?: LanguageListParams): Promise<void>;
    fetchOne(lang: string): Promise<void>;
    select(lang: Language): void;
    setDefaultByLang(langKey: string): void;
    create(payload: CreateLanguagePayload): Promise<Language | null>;
    patch(lang: string, payload: PatchLanguagePayload): Promise<boolean>;
    remove(lang: string): Promise<boolean>;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLanguageStore = defineStore('language', (): LanguageStoreSetup => {
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

    /** Mark a language as selected by its lang key (called by loadData boot). */
    function setDefaultByLang(langKey: string): void {
        const found = languages.value.find(l => l.lang === langKey) ?? null;
        selected.value = found;
        logger.info('[language-store] default set', { langKey, found: !!found });
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
        languages,
        selected,
        loading,
        error,
        activeLanguages,
        defaultLanguage,
        fetchAll,
        fetchOne,
        select,
        setDefaultByLang,
        create,
        patch,
        remove,
        clearError,
    };
});