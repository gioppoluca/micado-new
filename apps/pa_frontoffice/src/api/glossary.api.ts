/**
 * src/api/glossary.api.ts
 *
 * HTTP calls for the /glossaries resource.
 *
 * ── Two distinct DTO shapes ──────────────────────────────────────────────────
 *
 *   GlossaryTerm (flat / legacy)
 *     id, title, description, status, sourceLang
 *     Used by: GET /glossaries list, POST /glossaries create response.
 *     Contains only the sourceLang translation.
 *
 *   GlossaryFull (rich)
 *     status, sourceLang
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /glossaries/:id (form open), PUT /glossaries/:id (save).
 *
 * ── No dataExtra ─────────────────────────────────────────────────────────────
 *
 *   The glossary has no non-translatable metadata (no icon, no pictures).
 *   All content lives in the translations map.
 *
 * ── Description format ───────────────────────────────────────────────────────
 *
 *   Markdown (via tiptap-markdown). Stored in content_revision_translation.description.
 *   Rendered via RichTextEditor / RichTextViewer.
 *
 * ── CSV import ───────────────────────────────────────────────────────────────
 *
 *   parseCsvRows() converts a raw CSV string into CreateGlossaryPayload[].
 *   Expected format:
 *     title,description
 *     Permesso di soggiorno,Documento che autorizza il soggiorno...
 *
 *   The bulk import flow (GlossaryPage.vue → CsvImportDialog.vue) calls
 *   glossaryApi.create() once per row and collects per-row errors, allowing
 *   the import to continue past individual failures.
 *
 * ── Endpoint map ────────────────────────────────────────────────────────────
 *
 *   GET    /glossaries                list → GlossaryTerm[]
 *   GET    /glossaries/count          count
 *   POST   /glossaries                create → GlossaryTerm
 *   GET    /glossaries/to-production  publish → 204
 *   GET    /glossaries/:id            form open → GlossaryFull
 *   PUT    /glossaries/:id            form save → 204
 *   PATCH  /glossaries/:id            partial → 204 (status toggle)
 *   DELETE /glossaries/:id            delete → 204
 *   GET    /glossaries-migrant        migrant frontend
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GlossaryStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/**
 * Flat, legacy-compatible DTO.
 * Returned by list and create. Contains only the sourceLang translation.
 */
export interface GlossaryTerm {
    id: number;
    title: string;
    description: string;
    status: GlossaryStatus;
    sourceLang: string;
}

/** Per-language translation entry. */
export interface GlossaryTranslation {
    title: string;
    description: string;
    /** Read-only. Present in GET responses, ignored in PUT bodies. */
    tStatus?: TranslationStatus;
}

/** Lightweight revision summary. */
export interface RevisionSummary {
    revisionNo: number;
    status: GlossaryStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/**
 * Rich DTO with all translations embedded.
 * Returned by GET /glossaries/:id.
 * Sent to PUT /glossaries/:id.
 */
export interface GlossaryFull {
    id?: number;
    status?: GlossaryStatus;
    sourceLang?: string;
    translations?: Record<string, GlossaryTranslation>;
    revisions?: RevisionSummary[];
}

export type CreateGlossaryPayload = Omit<GlossaryTerm, 'id' | 'status'> & {
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchGlossaryPayload = Partial<Omit<GlossaryTerm, 'id'>>;

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/** One parsed CSV row, or an error if the row was malformed. */
export type CsvParseResult =
    | { ok: true; row: number; payload: CreateGlossaryPayload }
    | { ok: false; row: number; raw: string; error: string };

/**
 * Parses a CSV string into a list of parse results.
 *
 * Expected format (header required, UTF-8):
 *   title,description
 *   Term label,"Description in **Markdown**"
 *
 * Quoted fields with commas and newlines are supported via basic RFC 4180 parsing.
 * Empty rows are skipped silently.
 *
 * @param csv        Raw CSV file content as a string.
 * @param sourceLang Lang tag to assign to created items (default: app default).
 */
export function parseCsvRows(csv: string, sourceLang: string): CsvParseResult[] {
    const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const results: CsvParseResult[] = [];

    if (lines.length === 0) return results;

    // Strip BOM if present
    const firstLine = lines[0]!.replace(/^\uFEFF/, '').trim();
    if (!firstLine) return results;

    // Validate header
    const headers = splitCsvLine(firstLine).map(h => h.toLowerCase().trim());
    const titleIdx = headers.indexOf('title');
    const descIdx = headers.indexOf('description');
    if (titleIdx === -1) {
        return [{ ok: false, row: 1, raw: firstLine, error: 'Missing required "title" column header' }];
    }

    // Parse data rows (skip header at index 0)
    let rowNum = 1;
    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i]!.trim();
        if (!raw) continue; // skip blank lines
        rowNum++;

        try {
            const cols = splitCsvLine(raw);
            const title = (cols[titleIdx] ?? '').trim();
            const description = descIdx !== -1 ? (cols[descIdx] ?? '').trim() : '';

            if (!title) {
                results.push({ ok: false, row: rowNum, raw, error: 'Empty title' });
                continue;
            }

            results.push({
                ok: true,
                row: rowNum,
                payload: {
                    title,
                    description,
                    sourceLang,
                },
            });
        } catch (e) {
            results.push({
                ok: false,
                row: rowNum,
                raw,
                error: e instanceof Error ? e.message : 'Parse error',
            });
        }
    }
    return results;
}

/**
 * Basic RFC 4180 CSV line splitter.
 * Handles quoted fields containing commas and escaped quotes ("").
 */
function splitCsvLine(line: string): string[] {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++; // skip escaped quote
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                cols.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    cols.push(current);
    return cols;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function glossaryStatusKey(g: Pick<GlossaryTerm, 'status'>): string {
    switch (g.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const glossaryApi = {

    async list(): Promise<GlossaryTerm[]> {
        logger.info('[glossary.api] list');
        return apiGet<GlossaryTerm[]>('/glossaries');
    },

    async getOne(id: number): Promise<GlossaryFull> {
        logger.info('[glossary.api] getOne', { id });
        return apiGet<GlossaryFull>(`/glossaries/${id}`);
    },

    async create(payload: CreateGlossaryPayload): Promise<GlossaryTerm> {
        logger.info('[glossary.api] create', { title: payload.title });
        return apiPost<GlossaryTerm>('/glossaries', payload);
    },

    async save(id: number, payload: GlossaryFull): Promise<void> {
        logger.info('[glossary.api] save', {
            id, langCount: Object.keys(payload.translations ?? {}).length,
        });
        return apiPut<void>(`/glossaries/${id}`, payload);
    },

    async patch(id: number, payload: PatchGlossaryPayload): Promise<void> {
        logger.info('[glossary.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/glossaries/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[glossary.api] remove', { id });
        return apiDelete(`/glossaries/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[glossary.api] publish', { id });
        await apiGet<unknown>('/glossaries/to-production', { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 100;

let mockStore: GlossaryTerm[] = [
    { id: 1, title: 'Permesso di soggiorno', description: 'Documento che **autorizza** il soggiorno sul territorio italiano.', status: 'PUBLISHED', sourceLang: 'it' },
    { id: 2, title: 'Contratto di locazione', description: 'Accordo scritto tra **proprietario** e affittuario.', status: 'APPROVED', sourceLang: 'it' },
    { id: 3, title: 'SPRAR', description: 'Sistema di Protezione per Richiedenti Asilo e Rifugiati.', status: 'DRAFT', sourceLang: 'it' },
    { id: 4, title: 'Residence permit', description: 'Document **authorising** stay on Italian territory.', status: 'PUBLISHED', sourceLang: 'en' },
];

const mockFull: Partial<Record<number, GlossaryFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it',
        translations: {
            it: { title: 'Permesso di soggiorno', description: 'Documento che **autorizza** il soggiorno.', tStatus: 'PUBLISHED' },
            en: { title: 'Residence permit', description: 'Document **authorising** stay.', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it',
        translations: {
            it: { title: 'Contratto di locazione', description: 'Accordo tra proprietario e affittuario.', tStatus: 'DRAFT' },
            en: { title: 'Rental agreement', description: '', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'it',
        translations: {
            it: { title: 'SPRAR', description: 'Sistema di Protezione per Richiedenti Asilo e Rifugiati.', tStatus: 'DRAFT' },
        },
        revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

export function registerGlossaryMocks(mock: MockRegistry): void {

    // GET /glossaries — list
    mock.onGet('/glossaries').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /glossaries', { count: mockStore.length });
        return [200, [...mockStore]];
    });

    // GET /glossaries/to-production — before /:id
    mock.onGet('/glossaries/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(g => g.id === id);
        if (idx === -1) return [404, { error: { message: `Glossary ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        return [200, {}];
    });

    // GET /glossaries/:id — rich
    mock.onGet(/\/glossaries\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            const flat = mockStore.find(g => g.id === id);
            if (!flat) return [404, { error: { message: `Glossary ${id} not found` } }];
            return [200, {
                id: flat.id, status: flat.status, sourceLang: flat.sourceLang,
                translations: { [flat.sourceLang]: { title: flat.title, description: flat.description, tStatus: 'DRAFT' } },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: '2024-01-01T00:00:00Z', createdByName: 'System' }],
            }];
        }
        return [200, { ...found, translations: { ...found.translations } }];
    });

    // POST /glossaries — create
    mock.onPost('/glossaries').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateGlossaryPayload> = body ? JSON.parse(body) : {};
        const newItem: GlossaryTerm = {
            id: _nextId++,
            title: input.title ?? 'Nuovo termine',
            description: input.description ?? '',
            status: 'DRAFT',
            sourceLang: input.sourceLang ?? 'it',
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id, status: newItem.status, sourceLang: newItem.sourceLang,
            translations: input.translations
                ? Object.fromEntries(Object.entries(input.translations).map(([l, c]) => [
                    l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                ]))
                : { [newItem.sourceLang]: { title: newItem.title, description: newItem.description, tStatus: 'DRAFT' } },
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'System' }],
        };
        logger.debug('[mock] POST /glossaries created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PUT /glossaries/:id — full replace
    mock.onPut(/\/glossaries\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: GlossaryFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(g => g.id === id);
        if (idx === -1) return [404, { error: { message: `Glossary ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        mockStore[idx] = {
            ...mockStore[idx]!,
            title: srcTr?.title ?? mockStore[idx]!.title,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
        };

        const updatedTrs: Record<string, GlossaryTranslation> = {
            ...(mockFull[id]?.translations ?? {}),
            ...Object.fromEntries(Object.entries(full.translations ?? {}).map(([l, c]) => [
                l, { title: c.title, description: c.description, tStatus: 'DRAFT' as const },
            ])),
        };
        if (full.status === 'APPROVED') {
            for (const lang of Object.keys(updatedTrs)) {
                if (lang !== srcLang) updatedTrs[lang] = { ...updatedTrs[lang]!, tStatus: 'STALE' };
            }
        }
        mockFull[id] = { ...mockFull[id], ...full, translations: updatedTrs };
        return [204];
    });

    // PATCH /glossaries/:id — partial
    mock.onPatch(/\/glossaries\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(g => g.id === id);
        if (idx === -1) return [404, { error: { message: `Glossary ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: Partial<GlossaryTerm> = body ? JSON.parse(body) : {};
        mockStore[idx] = { ...mockStore[idx] as GlossaryTerm, ...p };
        if (mockFull[id] && p.status) mockFull[id].status = p.status;
        return [204];
    });

    // DELETE /glossaries/:id
    mock.onDelete(/\/glossaries\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(g => g.id !== id);
        delete mockFull[id];
        return [204];
    });

    logger.debug('[mock] glossary handlers registered');
}