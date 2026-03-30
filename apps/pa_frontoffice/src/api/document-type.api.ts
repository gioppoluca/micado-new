/**
 * src/api/document-type.api.ts
 *
 * HTTP calls for the /document-types resource.
 *
 * ── Two distinct DTO shapes ──────────────────────────────────────────────────
 *
 *   DocumentType (flat / legacy)
 *     id, document, description, status, sourceLang, dataExtra
 *     Used by: GET /document-types list, POST /document-types create response.
 *     dataExtra carries: icon, issuer, model_template, validable,
 *                        validity_duration, pictures[]
 *
 *   DocumentTypeFull (rich)
 *     status, sourceLang, dataExtra (with pictures[])
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + hotspots: DocumentHotspot[]
 *     + validatorIds: string[]   (TENANT content_item UUIDs)
 *     + revisions: RevisionSummary[]
 *     Used by: GET /document-types/:id (form open), PUT /document-types/:id (save).
 *
 * ── Endpoint map ────────────────────────────────────────────────────────────
 *
 *   GET    /document-types                  list → DocumentType[]
 *   GET    /document-types/count            count
 *   POST   /document-types                  create → DocumentType
 *   GET    /document-types/to-production    publish → 204
 *   GET    /document-types/:id              form open → DocumentTypeFull
 *   PUT    /document-types/:id              form save → 204
 *   PATCH  /document-types/:id              partial → 204
 *   DELETE /document-types/:id              delete → 204
 *   GET    /document-types-migrant          migrant frontend
 *   GET    /tenants                         tenant list for validator selector
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentTypeStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/** One picture entry inside dataExtra.pictures[]. */
export interface DocumentPicture {
    /** Stable UUID — assigned by backend on first save, never changes. */
    id: string;
    /** Base64 data URI (data:image/png;base64,...). */
    image: string;
    /** 1-based display order. */
    order: number;
}

export interface DocumentTypeDataExtra {
    icon?: string;
    issuer?: string;
    /** PDF base64 data URI or null. */
    model_template?: string | null;
    validable: boolean;
    validity_duration?: number | null;
    pictures?: DocumentPicture[];
}

/**
 * Flat, legacy-compatible DTO.
 * Returned by list and create. Contains only sourceLang translation.
 */
export interface DocumentType {
    id: number;
    /** Document name in the source language. Maps to content_revision_translation.title. */
    document: string;
    description: string;
    status: DocumentTypeStatus;
    sourceLang: string;
    dataExtra: DocumentTypeDataExtra;
}

/** Per-language translation for the document name and description. */
export interface DocumentTypeTranslation {
    title: string;
    description: string;
    /** Read-only on PUT. */
    tStatus?: TranslationStatus;
}

/** Per-language translation for a hotspot pin. */
export interface HotspotTranslation {
    title: string;
    message: string;
    /** Read-only on PUT. */
    tStatus?: TranslationStatus;
}

/**
 * A hotspot pin linked to one of the document's pictures.
 * id = undefined → new pin, facade creates a PICTURE_HOTSPOT content_item.
 * id = uuid     → existing pin, facade updates it.
 */
export interface DocumentHotspot {
    id?: string;
    /** Must match an entry in dataExtra.pictures[].id. */
    pictureId: string;
    /** Pixel coordinate from picture left edge (0-100 as percentage). */
    x: number;
    /** Pixel coordinate from picture top edge (0-100 as percentage). */
    y: number;
    sortOrder?: number;
    translations?: Record<string, HotspotTranslation>;
}

/** Lightweight revision summary for the version history panel. */
export interface RevisionSummary {
    revisionNo: number;
    status: DocumentTypeStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/** Tenant option for the validator multi-select. */
export interface TenantOption {
    /** content_item UUID of the TENANT. */
    value: string;
    label: string;
}

/**
 * Rich DTO — used by GET /document-types/:id and PUT /document-types/:id.
 */
export interface DocumentTypeFull {
    id?: number;
    status?: DocumentTypeStatus;
    sourceLang?: string;
    dataExtra?: DocumentTypeDataExtra;
    translations?: Record<string, DocumentTypeTranslation>;
    hotspots?: DocumentHotspot[];
    /** UUIDs of TENANT content_items authorised to validate this document. */
    validatorIds?: string[];
    revisions?: RevisionSummary[];
}

export type CreateDocumentTypePayload = Omit<DocumentType, 'id'> & {
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchDocumentTypePayload = Partial<Omit<DocumentType, 'id'>>;

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function documentTypeStatusKey(dt: Pick<DocumentType, 'status'>): string {
    switch (dt.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

export function documentTypeIcon(dt: DocumentType | DocumentTypeFull): string {
    return dt.dataExtra?.icon ?? '';
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const documentTypeApi = {

    async list(): Promise<DocumentType[]> {
        logger.info('[document-type.api] list');
        return apiGet<DocumentType[]>('/document-types');
    },

    /** Returns DocumentTypeFull with all translations, hotspots, validators. */
    async getOne(id: number): Promise<DocumentTypeFull> {
        logger.info('[document-type.api] getOne', { id });
        return apiGet<DocumentTypeFull>(`/document-types/${id}`);
    },

    async create(payload: CreateDocumentTypePayload): Promise<DocumentType> {
        logger.info('[document-type.api] create', { document: payload.document });
        return apiPost<DocumentType>('/document-types', payload);
    },

    async save(id: number, payload: DocumentTypeFull): Promise<void> {
        logger.info('[document-type.api] save', {
            id,
            status: payload.status,
            langCount: Object.keys(payload.translations ?? {}).length,
            hotspotCount: (payload.hotspots ?? []).length,
        });
        return apiPut<void>(`/document-types/${id}`, payload);
    },

    async patch(id: number, payload: PatchDocumentTypePayload): Promise<void> {
        logger.info('[document-type.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/document-types/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[document-type.api] remove', { id });
        return apiDelete(`/document-types/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[document-type.api] publish', { id });
        await apiGet<unknown>('/document-types/to-production', { params: { id } });
    },

    /** Fetch available tenants for the validator selector. */
    async listTenants(): Promise<TenantOption[]> {
        logger.info('[document-type.api] listTenants');
        return apiGet<TenantOption[]>('/tenants');
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 10;

let mockStore: DocumentType[] = [
    {
        id: 1,
        document: 'Permesso di soggiorno',
        description: 'Documento che autorizza il soggiorno sul territorio italiano.',
        status: 'PUBLISHED',
        sourceLang: 'it',
        dataExtra: {
            validable: true,
            issuer: 'Questura',
            model_template: null,
            validity_duration: 365,
            pictures: [],
        },
    },
    {
        id: 2,
        document: 'Carta d\'identità',
        description: 'Documento di identità rilasciato dal Comune.',
        status: 'APPROVED',
        sourceLang: 'it',
        dataExtra: {
            validable: false,
            issuer: 'Comune',
            model_template: null,
            validity_duration: 3650,
            pictures: [
                { id: 'pic-mock-1', image: '', order: 1 },
            ],
        },
    },
    {
        id: 3,
        document: 'Codice fiscale',
        description: 'Codice identificativo fiscale.',
        status: 'DRAFT',
        sourceLang: 'it',
        dataExtra: {
            validable: false,
            issuer: 'Agenzia delle Entrate',
            model_template: null,
            validity_duration: null,
            pictures: [],
        },
    },
];

const mockFull: Partial<Record<number, DocumentTypeFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it',
        dataExtra: { validable: true, issuer: 'Questura', model_template: null, validity_duration: 365, pictures: [] },
        translations: {
            it: { title: 'Permesso di soggiorno', description: 'Documento che autorizza il soggiorno sul territorio italiano.', tStatus: 'PUBLISHED' },
            en: { title: 'Residence permit', description: 'Document authorising stay on Italian territory.', tStatus: 'PUBLISHED' },
        },
        hotspots: [],
        validatorIds: ['tenant-uuid-1'],
        revisions: [
            { revisionNo: 1, status: 'PUBLISHED', createdAt: '2025-01-10T10:00:00Z', createdByName: 'Admin', publishedAt: '2025-01-15T12:00:00Z' },
        ],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it',
        dataExtra: {
            validable: false, issuer: 'Comune', model_template: null, validity_duration: 3650,
            pictures: [{ id: 'pic-mock-1', image: '', order: 1 }],
        },
        translations: {
            it: { title: 'Carta d\'identità', description: 'Documento di identità rilasciato dal Comune.', tStatus: 'APPROVED' },
            en: { title: 'Identity card', description: '', tStatus: 'STALE' },
        },
        hotspots: [
            {
                id: 'hotspot-mock-1',
                pictureId: 'pic-mock-1',
                x: 30,
                y: 45,
                sortOrder: 1,
                translations: {
                    it: { title: 'Numero documento', message: 'Il numero identificativo del documento.', tStatus: 'APPROVED' },
                    en: { title: 'Document number', message: 'The document identification number.', tStatus: 'STALE' },
                },
            },
        ],
        validatorIds: [],
        revisions: [
            { revisionNo: 1, status: 'APPROVED', createdAt: '2025-02-01T09:00:00Z', createdByName: 'Admin' },
        ],
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'it',
        dataExtra: { validable: false, issuer: 'Agenzia delle Entrate', model_template: null, validity_duration: null, pictures: [] },
        translations: {
            it: { title: 'Codice fiscale', description: 'Codice identificativo fiscale.', tStatus: 'DRAFT' },
        },
        hotspots: [],
        validatorIds: [],
        revisions: [
            { revisionNo: 1, status: 'DRAFT', createdAt: '2025-03-01T08:00:00Z', createdByName: 'Admin' },
        ],
    },
};

const mockTenants: TenantOption[] = [
    { value: 'tenant-uuid-1', label: 'Questura di Torino' },
    { value: 'tenant-uuid-2', label: 'Comune di Torino — Anagrafe' },
    { value: 'tenant-uuid-3', label: 'INPS — Sede di Torino' },
    { value: 'tenant-uuid-4', label: 'Agenzia delle Entrate — TO1' },
];

export function registerDocumentTypeMocks(mock: MockRegistry): void {

    // GET /tenants
    mock.onGet('/tenants').reply((): MockReplyTuple => {
        return [200, [...mockTenants]];
    });

    // GET /document-types — list
    mock.onGet('/document-types').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /document-types', { count: mockStore.length });
        return [200, [...mockStore]];
    });

    // GET /document-types/to-production — before /:id
    mock.onGet('/document-types/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(d => d.id === id);
        if (idx === -1) return [404, { error: { message: `DocumentType ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        logger.debug('[mock] GET /document-types/to-production', { id });
        return [200, {}];
    });

    // GET /document-types/:id — full
    mock.onGet(/\/document-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) return [404, { error: { message: `DocumentType ${id} not found` } }];
        return [200, JSON.parse(JSON.stringify(found))];
    });

    // POST /document-types
    mock.onPost('/document-types').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateDocumentTypePayload> = body ? JSON.parse(body) : {};
        const newItem: DocumentType = {
            id: _nextId++,
            document: input.document ?? 'New document type',
            description: input.description ?? '',
            status: 'DRAFT',
            sourceLang: input.sourceLang ?? 'it',
            dataExtra: {
                validable: false,
                ...(input.dataExtra ?? {}),
                pictures: (input.dataExtra?.pictures ?? []),
            },
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id,
            status: newItem.status,
            sourceLang: newItem.sourceLang,
            dataExtra: newItem.dataExtra,
            translations: input.translations
                ? Object.fromEntries(
                    Object.entries(input.translations).map(([l, c]) => [
                        l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                    ]),
                )
                : { [newItem.sourceLang]: { title: newItem.document, description: newItem.description, tStatus: 'DRAFT' } },
            hotspots: [],
            validatorIds: [],
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'Admin' }],
        };
        logger.debug('[mock] POST /document-types created', { id: newItem.id });
        return [200, { ...newItem }];
    });

    // PUT /document-types/:id — full replace
    mock.onPut(/\/document-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: DocumentTypeFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(d => d.id === id);
        if (idx === -1) return [404, { error: { message: `DocumentType ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];

        mockStore[idx] = {
            ...mockStore[idx]!,
            document: srcTr?.title ?? mockStore[idx]!.document,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
            dataExtra: { ...mockStore[idx]!.dataExtra, ...(full.dataExtra ?? {}) },
        };

        mockFull[id] = {
            ...mockFull[id],
            ...full,
            translations: {
                ...(mockFull[id]?.translations ?? {}),
                ...Object.fromEntries(
                    Object.entries(full.translations ?? {}).map(([l, c]) => [
                        l, { title: c.title, description: c.description, tStatus: 'DRAFT' as const },
                    ]),
                ),
            },
            hotspots: full.hotspots ?? mockFull[id]?.hotspots ?? [],
            validatorIds: full.validatorIds ?? mockFull[id]?.validatorIds ?? [],
        };

        // Simulate APPROVED → STALE for non-source translations
        if (full.status === 'APPROVED') {
            const fullEntry = mockFull[id];
            if (fullEntry?.translations) {
                for (const [lang, tr] of Object.entries(fullEntry.translations)) {
                    if (lang !== srcLang && tr.tStatus === 'DRAFT') {
                        fullEntry.translations[lang]!.tStatus = 'STALE';
                    }
                }
            }
        }

        logger.debug('[mock] PUT /document-types/:id', { id });
        return [204];
    });

    // PATCH /document-types/:id
    mock.onPatch(/\/document-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(d => d.id === id);
        if (idx === -1) return [404, { error: { message: `DocumentType ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: Partial<DocumentType> = body ? JSON.parse(body) : {};
        const base: DocumentType = mockStore[idx] as DocumentType;
        mockStore[idx] = { ...base, ...p };
        if (mockFull[id]) mockFull[id].status = mockStore[idx]?.status;
        logger.debug('[mock] PATCH /document-types/:id', { id });
        return [204];
    });

    // DELETE /document-types/:id
    mock.onDelete(/\/document-types\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(d => d.id !== id);
        delete mockFull[id];
        logger.debug('[mock] DELETE /document-types/:id', { id });
        return [204];
    });

    logger.debug('[mock] document-type handlers registered');
}