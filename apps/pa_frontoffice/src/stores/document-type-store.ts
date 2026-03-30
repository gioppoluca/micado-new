/**
 * src/stores/document-type-store.ts
 *
 * Pinia store for the /document-types resource.
 * Follows the same pattern as user-type-store.ts.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   documentTypes  — flat list (DocumentType[]) — drives the list view
 *   tenants        — available TENANT options for the validator selector
 *   loading        — true while any async operation is in flight
 *   error          — last error message, null when clean
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll()               — GET /document-types → replace documentTypes list
 *   fetchTenants()           — GET /tenants → replace tenants list
 *   getOne(id)               — GET /document-types/:id → DocumentTypeFull
 *   create(payload)          — POST /document-types → push flat record into list
 *   save(id, full)           — PUT /document-types/:id (full replace)
 *   patch(id, partial)       — PATCH /document-types/:id (status toggle, icon)
 *   remove(id)               — DELETE + filter list
 *   publish(id)              — GET to-production → flip local status PUBLISHED
 *   unpublish(id)            — PATCH status back to DRAFT
 *   clearError()
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { documentTypeApi } from 'src/api/document-type.api';
import type {
    DocumentType,
    DocumentTypeFull,
    TenantOption,
    CreateDocumentTypePayload,
    PatchDocumentTypePayload,
} from 'src/api/document-type.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Return type interface ─────────────────────────────────────────────────────
// Explicit interface prevents vue-tsc from narrowing away action signatures.

interface DocumentTypeStoreSetup {
    documentTypes: Ref<DocumentType[]>;
    tenants: Ref<TenantOption[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(): Promise<void>;
    fetchTenants(): Promise<void>;
    getOne(id: number): Promise<DocumentTypeFull | null>;
    create(payload: CreateDocumentTypePayload): Promise<DocumentType | null>;
    save(id: number, full: DocumentTypeFull): Promise<boolean>;
    patch(id: number, payload: PatchDocumentTypePayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useDocumentTypeStore = defineStore('documentType', (): DocumentTypeStoreSetup => {

    // ── State ──────────────────────────────────────────────────────────────────

    const documentTypes = ref<DocumentType[]>([]);
    const tenants = ref<TenantOption[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[document-type-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[document-type-store] unexpected error', e);
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
            documentTypes.value = await documentTypeApi.list();
            logger.info('[document-type-store] fetchAll', { count: documentTypes.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function fetchTenants(): Promise<void> {
        try {
            tenants.value = await documentTypeApi.listTenants();
            logger.info('[document-type-store] fetchTenants', { count: tenants.value.length });
        } catch (e) {
            // Non-fatal: validator list is optional UI sugar
            logger.warn('[document-type-store] fetchTenants failed', e);
        }
    }

    async function getOne(id: number): Promise<DocumentTypeFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await documentTypeApi.getOne(id);
            logger.info('[document-type-store] getOne', {
                id,
                langs: Object.keys(full.translations ?? {}),
                hotspotCount: (full.hotspots ?? []).length,
            });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function create(payload: CreateDocumentTypePayload): Promise<DocumentType | null> {
        loading.value = true;
        clearError();
        try {
            const created = await documentTypeApi.create(payload);
            documentTypes.value.push(created);
            logger.info('[document-type-store] create', { id: created.id, document: created.document });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: DocumentTypeFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await documentTypeApi.save(id, full);

            // Sync flat list entry so the list view reflects changes without re-fetch
            const srcLang = full.sourceLang;
            const srcTr = srcLang ? (full.translations?.[srcLang]) : undefined;
            const idx = documentTypes.value.findIndex(d => d.id === id);

            if (idx !== -1) {
                const base: DocumentType = documentTypes.value[idx] as DocumentType;
                const merged: DocumentType = {
                    ...base,
                    document: srcTr?.title ?? base.document,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: full.sourceLang ?? base.sourceLang,
                };
                if (full.dataExtra !== undefined) merged.dataExtra = full.dataExtra;
                documentTypes.value[idx] = merged;
            }

            logger.info('[document-type-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchDocumentTypePayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await documentTypeApi.patch(id, payload);
            const idx = documentTypes.value.findIndex(d => d.id === id);
            if (idx !== -1) {
                const update: Partial<DocumentType> = {};
                if (payload.status !== undefined) update.status = payload.status;
                if (payload.sourceLang !== undefined) update.sourceLang = payload.sourceLang;
                if (payload.dataExtra !== undefined) update.dataExtra = payload.dataExtra;
                const base: DocumentType = documentTypes.value[idx] as DocumentType;
                documentTypes.value[idx] = { ...base, ...update };
            }
            logger.info('[document-type-store] patch', { id, fields: Object.keys(payload) });
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
            await documentTypeApi.remove(id);
            documentTypes.value = documentTypes.value.filter(d => d.id !== id);
            logger.warn('[document-type-store] remove', { id });
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
            await documentTypeApi.publish(id);
            const idx = documentTypes.value.findIndex(d => d.id === id);
            if (idx !== -1) {
                const base: DocumentType = documentTypes.value[idx] as DocumentType;
                documentTypes.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[document-type-store] publish', { id });
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
        documentTypes,
        tenants,
        loading,
        error,
        fetchAll,
        fetchTenants,
        getOne,
        create,
        save,
        patch,
        remove,
        publish,
        unpublish,
        clearError,
    };
});