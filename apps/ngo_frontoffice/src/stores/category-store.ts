/**
 * src/stores/category-store.ts
 *
 * Pinia store for the /categories resource.
 *
 * A single store handles both "event" and "information" subtypes.
 * The consuming page passes `subtype` to `fetchAll()` to load only
 * the relevant subset.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   categories  — flat list (Category[]) currently loaded
 *   loading     — true while any async operation is in-flight
 *   error       — last error message, null when clean
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll(subtype?)     — GET /categories?subtype= → replace list
 *   getOne(id)             — GET /categories/:id → returns CategoryFull
 *   create(payload)        — POST /categories → push flat record into list
 *   save(id, full)         — PUT /categories/:id
 *   patch(id, partial)     — PATCH /categories/:id (status toggle)
 *   remove(id)             — DELETE + filter list (surfacing 409 via error)
 *   publish(id)            — GET to-production → update local status
 *   unpublish(id)          — PATCH status=DRAFT
 *   clearError()
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { categoryApi } from 'src/api/category.api';
import type {
    Category,
    CategoryFull,
    CategorySubtype,
    CreateCategoryPayload,
    PatchCategoryPayload,
} from 'src/api/category.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ─────────────────────────────────────────────────────

interface CategoryStoreSetup {
    categories: Ref<Category[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(subtype?: CategorySubtype): Promise<void>;
    getOne(id: number): Promise<CategoryFull | null>;
    create(payload: CreateCategoryPayload): Promise<Category | null>;
    save(id: number, full: CategoryFull): Promise<boolean>;
    patch(id: number, payload: PatchCategoryPayload): Promise<boolean>;
    /**
     * Attempts to delete the category.
     * Returns false and sets error if the server returns 409 (category in use).
     */
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useCategoryStore = defineStore('category', (): CategoryStoreSetup => {

    const categories = ref<Category[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[category-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[category-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(subtype?: CategorySubtype): Promise<void> {
        loading.value = true;
        clearError();
        try {
            categories.value = await categoryApi.list(subtype);
            logger.info('[category-store] fetchAll', {
                subtype: subtype ?? 'all', count: categories.value.length,
            });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<CategoryFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await categoryApi.getOne(id);
            logger.info('[category-store] getOne', {
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

    async function create(payload: CreateCategoryPayload): Promise<Category | null> {
        loading.value = true;
        clearError();
        try {
            const created = await categoryApi.create(payload);
            categories.value.push(created);
            logger.info('[category-store] create', {
                id: created.id, title: created.title, subtype: created.subtype,
            });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: CategoryFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await categoryApi.save(id, full);
            const idx = categories.value.findIndex(c => c.id === id);
            if (idx !== -1) {
                const base: Category = categories.value[idx] as Category;
                const srcLang = full.sourceLang ?? base.sourceLang;
                const srcTitle = full.translations?.[srcLang]?.title ?? base.title;
                categories.value[idx] = {
                    ...base,
                    title: srcTitle,
                    status: full.status ?? base.status,
                    sourceLang: srcLang,
                };
            }
            logger.info('[category-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchCategoryPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await categoryApi.patch(id, payload);
            const idx = categories.value.findIndex(c => c.id === id);
            if (idx !== -1) {
                const base: Category = categories.value[idx] as Category;
                categories.value[idx] = { ...base, ...payload };
            }
            logger.info('[category-store] patch', { id, fields: Object.keys(payload) });
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
            await categoryApi.remove(id);
            categories.value = categories.value.filter(c => c.id !== id);
            logger.warn('[category-store] remove', { id });
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
            await categoryApi.publish(id);
            const idx = categories.value.findIndex(c => c.id === id);
            if (idx !== -1) {
                const base: Category = categories.value[idx] as Category;
                categories.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[category-store] publish', { id });
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
        categories, loading, error,
        fetchAll, getOne, create, save, patch, remove,
        publish, unpublish, clearError,
    };
});