/**
 * src/stores/glossary-store.ts
 *
 * Pinia store for the /glossaries resource.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *   terms    — flat list (GlossaryTerm[]) — drives the list view
 *   loading  — true while any async operation is in flight
 *   error    — last error message, null when clean
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   fetchAll()         — GET /glossaries → replace terms list
 *   getOne(id)         — GET /glossaries/:id → returns GlossaryFull (for form)
 *   create(payload)    — POST /glossaries → push flat record into list
 *   save(id, full)     — PUT /glossaries/:id (form save — all translations)
 *   patch(id, partial) — PATCH /glossaries/:id (status toggle)
 *   remove(id)         — DELETE + filter list
 *   publish(id)        — GET to-production → update local status
 *   unpublish(id)      — PATCH status=DRAFT
 *   bulkImport(rows)   — sequential create() calls for CSV import;
 *                        returns a BulkImportReport instead of throwing
 *   clearError()
 */

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { glossaryApi } from 'src/api/glossary.api';
import type {
    GlossaryTerm,
    GlossaryFull,
    CreateGlossaryPayload,
    PatchGlossaryPayload,
    CsvParseResult,
} from 'src/api/glossary.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Bulk import report ───────────────────────────────────────────────────────

/** Result of a single row during bulk CSV import. */
export interface RowImportResult {
    row: number;
    title: string;
    ok: boolean;
    error?: string;
}

/** Aggregate report returned by bulkImport(). */
export interface BulkImportReport {
    /** Number of rows successfully created. */
    successCount: number;
    /** Failed rows with row number, title (or raw text) and error message. */
    failures: RowImportResult[];
}

// ─── Return type interface ─────────────────────────────────────────────────────

interface GlossaryStoreSetup {
    terms: Ref<GlossaryTerm[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    fetchAll(): Promise<void>;
    getOne(id: number): Promise<GlossaryFull | null>;
    create(payload: CreateGlossaryPayload): Promise<GlossaryTerm | null>;
    save(id: number, full: GlossaryFull): Promise<boolean>;
    patch(id: number, payload: PatchGlossaryPayload): Promise<boolean>;
    remove(id: number): Promise<boolean>;
    publish(id: number): Promise<boolean>;
    unpublish(id: number): Promise<boolean>;
    /**
     * Import a list of pre-parsed CSV rows.
     * Runs sequentially — continues past individual row failures.
     * Returns a BulkImportReport instead of throwing.
     * Does NOT set store.error (errors are in the report).
     */
    bulkImport(rows: CsvParseResult[]): Promise<BulkImportReport>;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useGlossaryStore = defineStore('glossary', (): GlossaryStoreSetup => {

    const terms = ref<GlossaryTerm[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[glossary-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[glossary-store] unexpected error', e);
        }
    }

    function clearError(): void { error.value = null; }

    // ── Actions ────────────────────────────────────────────────────────────────

    async function fetchAll(): Promise<void> {
        loading.value = true;
        clearError();
        try {
            terms.value = await glossaryApi.list();
            logger.info('[glossary-store] fetchAll', { count: terms.value.length });
        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    async function getOne(id: number): Promise<GlossaryFull | null> {
        loading.value = true;
        clearError();
        try {
            const full = await glossaryApi.getOne(id);
            logger.info('[glossary-store] getOne', { id, langs: Object.keys(full.translations ?? {}) });
            return full;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function create(payload: CreateGlossaryPayload): Promise<GlossaryTerm | null> {
        loading.value = true;
        clearError();
        try {
            const created = await glossaryApi.create(payload);
            terms.value.push(created);
            logger.info('[glossary-store] create', { id: created.id, title: created.title });
            return created;
        } catch (e) {
            setError(e);
            return null;
        } finally {
            loading.value = false;
        }
    }

    async function save(id: number, full: GlossaryFull): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await glossaryApi.save(id, full);
            const srcLang = full.sourceLang;
            const srcTr = srcLang ? full.translations?.[srcLang] : undefined;
            const idx = terms.value.findIndex(g => g.id === id);
            if (idx !== -1) {
                const base: GlossaryTerm = terms.value[idx] as GlossaryTerm;
                terms.value[idx] = {
                    ...base,
                    title: srcTr?.title ?? base.title,
                    description: srcTr?.description ?? base.description,
                    status: full.status ?? base.status,
                    sourceLang: full.sourceLang ?? base.sourceLang,
                };
            }
            logger.info('[glossary-store] save', { id, status: full.status });
            return true;
        } catch (e) {
            setError(e);
            return false;
        } finally {
            loading.value = false;
        }
    }

    async function patch(id: number, payload: PatchGlossaryPayload): Promise<boolean> {
        loading.value = true;
        clearError();
        try {
            await glossaryApi.patch(id, payload);
            const idx = terms.value.findIndex(g => g.id === id);
            if (idx !== -1) {
                const update: Partial<GlossaryTerm> = {};
                if (payload.status !== undefined) update.status = payload.status;
                if (payload.sourceLang !== undefined) update.sourceLang = payload.sourceLang;
                const base: GlossaryTerm = terms.value[idx] as GlossaryTerm;
                terms.value[idx] = { ...base, ...update };
            }
            logger.info('[glossary-store] patch', { id, fields: Object.keys(payload) });
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
            await glossaryApi.remove(id);
            terms.value = terms.value.filter(g => g.id !== id);
            logger.warn('[glossary-store] remove', { id });
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
            await glossaryApi.publish(id);
            const idx = terms.value.findIndex(g => g.id === id);
            if (idx !== -1) {
                const base: GlossaryTerm = terms.value[idx] as GlossaryTerm;
                terms.value[idx] = { ...base, status: 'PUBLISHED' };
            }
            logger.info('[glossary-store] publish', { id });
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
     * Bulk import from parsed CSV rows.
     *
     * Processes rows sequentially — an individual row failure does NOT abort
     * the remaining rows. This lets the user see a full report at the end
     * and fix only the problematic rows.
     *
     * Parse-level failures (CsvParseResult with ok:false) are counted as
     * failures without making any API call.
     *
     * Does NOT set store.loading or store.error — the caller (CsvImportDialog)
     * manages its own progress state and displays the report.
     */
    async function bulkImport(rows: CsvParseResult[]): Promise<BulkImportReport> {
        let successCount = 0;
        const failures: RowImportResult[] = [];

        for (const result of rows) {
            if (!result.ok) {
                // Parse-level failure — no API call needed
                failures.push({
                    row: result.row,
                    title: result.raw,
                    ok: false,
                    error: result.error,
                });
                continue;
            }

            try {
                const created = await glossaryApi.create(result.payload);
                terms.value.push(created);
                successCount++;
                logger.debug('[glossary-store] bulkImport row ok', {
                    row: result.row, title: result.payload.title,
                });
            } catch (e) {
                const message = isApiError(e) ? e.message : 'Unexpected error';
                failures.push({
                    row: result.row,
                    title: result.payload.title,
                    ok: false,
                    error: message,
                });
                logger.warn('[glossary-store] bulkImport row failed', {
                    row: result.row, title: result.payload.title, error: message,
                });
            }
        }

        logger.info('[glossary-store] bulkImport complete', {
            total: rows.length, successCount, failCount: failures.length,
        });

        return { successCount, failures };
    }

    return {
        terms, loading, error,
        fetchAll, getOne, create, save, patch, remove,
        publish, unpublish, bulkImport, clearError,
    };
});