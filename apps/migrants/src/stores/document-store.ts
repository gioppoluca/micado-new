/**
 * src/stores/document-store.ts
 *
 * Pinia store for the Document Wallet.
 *
 * ── Responsibilities ──────────────────────────────────────────────────────────
 *
 *   • Cached list of the migrant's document summaries (no binary).
 *   • Cached list of published document types (for the type picker).
 *   • Selected document (with full binary) for the detail/edit view.
 *   • Upload, update, delete actions.
 *
 * ── Binary strategy ───────────────────────────────────────────────────────────
 *
 *   The list stores summaries only.  fetchOne() loads the full binary on demand
 *   and caches the result in selectedDocument.  This avoids loading all binaries
 *   upfront when showing the list.
 *
 * ── Document types ────────────────────────────────────────────────────────────
 *
 *   Fetched once from GET /document-types-migrant (public, no auth required).
 *   Cached in documentTypes — does not need language reactivity because the
 *   type picker only needs the name.  If the language changes, the user will
 *   see the new label on next mount.
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { documentApi } from 'src/api/document.api';
import { apiGet } from 'src/api/client';
import type { MigrantDocument, MigrantDocumentSummary, UploadDocumentPayload, UpdateDocumentPayload } from 'src/api/document.api';
import { isApiError } from 'src/api/client';
import { useAppStore } from 'src/stores/app-store';
import { useLanguageStore } from 'src/stores/language-store';
import { logger } from 'src/services/Logger';

// ─── Document type shape from GET /document-types-migrant ─────────────────────

export interface MigrantDocumentType {
    id: number;
    /** Translated name of the document type. */
    document: string;
    description?: string;
    icon?: string;
    issuer?: string;
    validable?: boolean;
    validity_duration?: number;
}

// ─── Setup return type ────────────────────────────────────────────────────────

interface DocumentStoreSetup {
    documents: Ref<MigrantDocumentSummary[]>;
    documentTypes: Ref<MigrantDocumentType[]>;
    selectedDocument: Ref<MigrantDocument | null>;
    loading: Ref<boolean>;
    uploading: Ref<boolean>;
    error: Ref<string | null>;
    fetchList(): Promise<void>;
    fetchDocumentTypes(): Promise<void>;
    fetchOne(id: string): Promise<void>;
    upload(payload: UploadDocumentPayload): Promise<MigrantDocument | null>;
    update(id: string, payload: UpdateDocumentPayload): Promise<MigrantDocument | null>;
    remove(id: string): Promise<boolean>;
    clearSelected(): void;
    clearError(): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDocumentStore = defineStore('document', (): DocumentStoreSetup => {
    const documents = ref<MigrantDocumentSummary[]>([]);
    const documentTypes = ref<MigrantDocumentType[]>([]);
    const selectedDocument = ref<MigrantDocument | null>(null);
    const loading = ref(false);
    const uploading = ref(false);
    const error = ref<string | null>(null);

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[document-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[document-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchList(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            documents.value = await documentApi.list();
            logger.info('[document-store] fetchList', { count: documents.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function fetchDocumentTypes(): Promise<void> {
        if (documentTypes.value.length > 0) return; // already loaded
        try {
            const appStore = useAppStore();
            const langStore = useLanguageStore();
            const defaultlang = appStore.defaultLang;
            const currentlang = langStore.selected?.lang ?? defaultlang;
            const types = await apiGet<MigrantDocumentType[]>('/document-types-migrant', {
                params: { defaultlang, currentlang },
            });
            documentTypes.value = types;
            logger.info('[document-store] fetchDocumentTypes', { count: types.length });
        } catch (e) {
            logger.error('[document-store] fetchDocumentTypes failed', e);
            // Non-fatal: the type picker will be empty but the page still works
        }
    }

    async function fetchOne(id: string): Promise<void> {
        loading.value = true;
        clearError();
        try {
            selectedDocument.value = await documentApi.getOne(id);
            logger.info('[document-store] fetchOne', { id });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function upload(payload: UploadDocumentPayload): Promise<MigrantDocument | null> {
        uploading.value = true;
        clearError();
        try {
            const created = await documentApi.upload(payload);
            // Add summary to the list
            const { fileData: _fd, ...summary } = created;
            documents.value = [summary, ...documents.value];
            logger.info('[document-store] upload done', { id: created.id });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            uploading.value = false;
        }
    }

    async function update(id: string, payload: UpdateDocumentPayload): Promise<MigrantDocument | null> {
        uploading.value = true;
        clearError();
        try {
            const updated = await documentApi.update(id, payload);
            // Refresh the list entry
            const { fileData: _fd, ...summary } = updated;
            const idx = documents.value.findIndex(d => d.id === id);
            if (idx !== -1) documents.value[idx] = summary;
            if (selectedDocument.value?.id === id) selectedDocument.value = updated;
            logger.info('[document-store] update done', { id });
            return updated;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            uploading.value = false;
        }
    }

    async function remove(id: string): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await documentApi.remove(id);
            documents.value = documents.value.filter(d => d.id !== id);
            if (selectedDocument.value?.id === id) selectedDocument.value = null;
            logger.warn('[document-store] removed', { id });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    function clearSelected(): void {
        selectedDocument.value = null;
    }

    return {
        documents, documentTypes, selectedDocument,
        loading, uploading, error,
        fetchList, fetchDocumentTypes, fetchOne,
        upload, update, remove,
        clearSelected, clearError,
    };
});
