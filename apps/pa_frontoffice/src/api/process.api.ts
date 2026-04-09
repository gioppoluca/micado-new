/**
 * src/api/process.api.ts
 *
 * HTTP calls for /processes and /processes/:id/graph.
 *
 * ── Two DTO shapes (process metadata) ────────────────────────────────────────
 *
 *   Process (flat)
 *     id, title, description, status, sourceLang
 *     topicIds[], userTypeIds[], producedDocTypeIds[]
 *     stepCount   — convenience for list display
 *     Used by: GET /processes list, POST /processes response.
 *
 *   ProcessFull (rich)
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /processes/:id, PUT /processes/:id.
 *
 * ── Graph DTO ─────────────────────────────────────────────────────────────────
 *
 *   ProcessGraph { nodes: GraphNode[], edges: GraphEdge[] }
 *   Used by: GET /processes/:id/graph, PUT /processes/:id/graph.
 *
 *   GraphNode mirrors VueFlow's Node type — the frontend can feed this
 *   directly into <VueFlow :nodes="graph.nodes" :edges="graph.edges" />.
 *
 * ── Endpoint map ──────────────────────────────────────────────────────────────
 *
 *   GET    /processes?topicIds=&userTypeIds=&page=&pageSize=
 *   GET    /processes/count?...
 *   POST   /processes
 *   GET    /processes/to-production?id=
 *   GET    /processes/:id
 *   PUT    /processes/:id
 *   PATCH  /processes/:id
 *   DELETE /processes/:id
 *   GET    /processes/:id/graph
 *   PUT    /processes/:id/graph
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Process metadata types ───────────────────────────────────────────────────

export type ProcessStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

/** Flat DTO returned by list and create. */
export interface Process {
    id: number;
    title: string;
    description: string;
    status: ProcessStatus;
    sourceLang: string;
    topicIds: number[];
    userTypeIds: number[];
    producedDocTypeIds: number[];
    /** Number of steps in the graph. */
    stepCount: number;
}

export interface ProcessTranslation {
    title: string;
    description: string;
    tStatus?: TranslationStatus;
}

export interface RevisionSummary {
    revisionNo: number;
    status: ProcessStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/** Rich DTO with all translations. */
export interface ProcessFull {
    id?: number;
    status?: ProcessStatus;
    sourceLang?: string;
    topicIds?: number[];
    userTypeIds?: number[];
    producedDocTypeIds?: number[];
    translations?: Record<string, ProcessTranslation>;
    revisions?: RevisionSummary[];
}

export interface ProcessListFilter {
    topicIds?: number[];
    userTypeIds?: number[];
    page?: number;
    pageSize?: number;
}

export type CreateProcessPayload = {
    title?: string;
    description?: string;
    sourceLang?: string;
    topicIds?: number[];
    userTypeIds?: number[];
    producedDocTypeIds?: number[];
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchProcessPayload = {
    status?: ProcessStatus;
    sourceLang?: string;
};

// ─── Graph types (VueFlow-compatible) ────────────────────────────────────────

export interface RequiredDocument {
    documentTypeId: number;
    cost: string;
    isOut: boolean;
}

export interface GraphNodeTranslation {
    title: string;
    description?: string;
    tStatus?: TranslationStatus;
}

export interface GraphNodeData {
    title: string;
    description?: string;
    status: ProcessStatus;
    sourceLang: string;
    location?: string;
    cost?: string;
    isFree?: boolean;
    url?: string;
    iconUrl?: string;
    requiredDocuments: RequiredDocument[];
    translations: Record<string, GraphNodeTranslation>;
}

export interface GraphEdgeTranslation {
    title: string;
    tStatus?: TranslationStatus;
}

export interface GraphEdgeData {
    status: ProcessStatus;
    sourceLang: string;
    translations: Record<string, GraphEdgeTranslation>;
}

/**
 * Domain node shape — compatible with VueFlow's Node<GraphNodeData>.
 * Named ProcessNode to avoid clash with VueFlow's internal GraphNode type.
 */
export interface ProcessNode {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: GraphNodeData;
}

/**
 * Domain edge shape — compatible with VueFlow's Edge<GraphEdgeData>.
 * Named ProcessEdge to avoid clash with VueFlow's internal GraphEdge type.
 */
export interface ProcessEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    label?: string;
    data?: GraphEdgeData;
}

export interface ProcessGraph {
    nodes: ProcessNode[];
    edges: ProcessEdge[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function processStatusKey(p: Pick<Process, 'status'>): string {
    switch (p.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

function buildParams(filter: ProcessListFilter): Record<string, string | number> {
    const p: Record<string, string | number> = {};
    if (filter.topicIds?.length) p['topicIds'] = filter.topicIds.join(',');
    if (filter.userTypeIds?.length) p['userTypeIds'] = filter.userTypeIds.join(',');
    if (filter.page) p['page'] = filter.page;
    if (filter.pageSize) p['pageSize'] = filter.pageSize;
    return p;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const processApi = {

    async list(filter: ProcessListFilter = {}): Promise<Process[]> {
        logger.info('[process.api] list', filter);
        return apiGet<Process[]>('/processes', { params: buildParams(filter) });
    },

    async count(filter: ProcessListFilter = {}): Promise<number> {
        logger.info('[process.api] count', filter);
        const res = await apiGet<{ count: number }>('/processes/count', { params: buildParams(filter) });
        return res.count;
    },

    async getOne(id: number): Promise<ProcessFull> {
        logger.info('[process.api] getOne', { id });
        return apiGet<ProcessFull>(`/processes/${id}`);
    },

    async create(payload: CreateProcessPayload): Promise<Process> {
        logger.info('[process.api] create', { title: payload.title });
        return apiPost<Process>('/processes', payload);
    },

    async save(id: number, payload: ProcessFull): Promise<void> {
        logger.info('[process.api] save', { id, langs: Object.keys(payload.translations ?? {}) });
        return apiPut<void>(`/processes/${id}`, payload);
    },

    async patch(id: number, payload: PatchProcessPayload): Promise<void> {
        logger.info('[process.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/processes/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[process.api] remove', { id });
        return apiDelete(`/processes/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[process.api] publish', { id });
        await apiGet<unknown>('/processes/to-production', { params: { id } });
    },

    async getGraph(id: number): Promise<ProcessGraph> {
        logger.info('[process.api] getGraph', { id });
        return apiGet<ProcessGraph>(`/processes/${id}/graph`);
    },

    async saveGraph(id: number, graph: ProcessGraph): Promise<void> {
        logger.info('[process.api] saveGraph', {
            id, nodes: graph.nodes.length, edges: graph.edges.length,
        });
        return apiPut<void>(`/processes/${id}/graph`, graph);
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 100;

let mockStore: Process[] = [
    {
        id: 1,
        title: 'Ottenere il permesso di soggiorno',
        description: 'Guida **passo per passo** per ottenere il permesso di soggiorno.',
        status: 'PUBLISHED',
        sourceLang: 'it',
        topicIds: [1],
        userTypeIds: [1],
        producedDocTypeIds: [1],
        stepCount: 4,
    },
    {
        id: 2,
        title: 'Iscrivere i figli a scuola',
        description: 'Come iscrivere i tuoi figli al sistema scolastico italiano.',
        status: 'APPROVED',
        sourceLang: 'it',
        topicIds: [2],
        userTypeIds: [1, 2],
        producedDocTypeIds: [],
        stepCount: 3,
    },
    {
        id: 3,
        title: 'Richiedere la residenza',
        description: 'Procedura per la registrazione anagrafica.',
        status: 'DRAFT',
        sourceLang: 'it',
        topicIds: [],
        userTypeIds: [],
        producedDocTypeIds: [],
        stepCount: 0,
    },
];

const mockFull: Partial<Record<number, ProcessFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it',
        topicIds: [1], userTypeIds: [1], producedDocTypeIds: [1],
        translations: {
            it: { title: 'Ottenere il permesso di soggiorno', description: 'Guida **passo per passo**.', tStatus: 'PUBLISHED' },
            en: { title: 'Get a residence permit', description: 'Step-by-step guide.', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it',
        topicIds: [2], userTypeIds: [1, 2], producedDocTypeIds: [],
        translations: {
            it: { title: 'Iscrivere i figli a scuola', description: 'Come iscrivere i tuoi figli.', tStatus: 'DRAFT' },
            en: { title: 'Enroll children at school', description: 'How to enroll your children.', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-02-01T00:00:00Z', createdByName: 'Admin' }],
    },
    3: {
        id: 3, status: 'DRAFT', sourceLang: 'it',
        topicIds: [], userTypeIds: [], producedDocTypeIds: [],
        translations: {
            it: { title: 'Richiedere la residenza', description: 'Procedura per la registrazione anagrafica.', tStatus: 'DRAFT' },
        },
        revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: '2024-03-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

/** Mock graph store — empty graphs by default. */
const mockGraphs: Partial<Record<number, ProcessGraph>> = {
    1: {
        nodes: [
            { id: '1', type: 'step', position: { x: 200, y: 50 }, data: { title: 'Raccogliere i documenti', description: 'Fotocopia passaporto + visto.', status: 'PUBLISHED', sourceLang: 'it', location: 'Casa', cost: '', isFree: true, url: '', iconUrl: '', requiredDocuments: [], translations: { it: { title: 'Raccogliere i documenti', description: 'Fotocopia passaporto + visto.', tStatus: 'PUBLISHED' } } } },
            { id: '2', type: 'step', position: { x: 200, y: 200 }, data: { title: 'Compilare il kit postale', description: 'Recarsi all\'ufficio postale abilitato.', status: 'PUBLISHED', sourceLang: 'it', location: 'Ufficio postale', cost: '30 €', isFree: false, url: '', iconUrl: '', requiredDocuments: [{ documentTypeId: 1, cost: '16 €', isOut: false }], translations: { it: { title: 'Compilare il kit postale', tStatus: 'PUBLISHED' } } } },
            { id: '3', type: 'step', position: { x: 200, y: 350 }, data: { title: 'Attendere la convocazione', description: 'La Questura invierà la convocazione.', status: 'PUBLISHED', sourceLang: 'it', location: '', cost: '', isFree: true, url: '', iconUrl: '', requiredDocuments: [], translations: { it: { title: 'Attendere la convocazione', tStatus: 'PUBLISHED' } } } },
            { id: '4', type: 'step', position: { x: 200, y: 500 }, data: { title: 'Presentarsi in Questura', description: 'Portare tutti i documenti originali.', status: 'PUBLISHED', sourceLang: 'it', location: 'Questura', cost: '', isFree: true, url: '', iconUrl: '', requiredDocuments: [], translations: { it: { title: 'Presentarsi in Questura', tStatus: 'PUBLISHED' } } } },
        ],
        edges: [
            { id: 'e1', source: '1', target: '2', type: 'step-link', label: 'Poi', data: { status: 'PUBLISHED', sourceLang: 'it', translations: { it: { title: 'Poi', tStatus: 'PUBLISHED' } } } },
            { id: 'e2', source: '2', target: '3', type: 'step-link', label: 'Poi', data: { status: 'PUBLISHED', sourceLang: 'it', translations: { it: { title: 'Poi', tStatus: 'PUBLISHED' } } } },
            { id: 'e3', source: '3', target: '4', type: 'step-link', label: 'Poi', data: { status: 'PUBLISHED', sourceLang: 'it', translations: { it: { title: 'Poi', tStatus: 'PUBLISHED' } } } },
        ],
    },
};

export function registerProcessMocks(mock: MockRegistry): void {

    // GET /processes/count — before /processes
    mock.onGet('/processes/count').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        return [200, { count: filtered.length }];
    });

    // GET /processes/to-production — before /processes/:id
    mock.onGet('/processes/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(p => p.id === id);
        if (idx === -1) return [404, { error: { message: `Process ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        const existing = mockFull[id];
        if (existing) mockFull[id] = { ...existing, status: 'PUBLISHED' };
        return [200, {}];
    });

    // GET /processes/:id/graph — before /processes/:id
    mock.onGet(/\/processes\/\d+\/graph/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const parts = (cfg.url ?? '').split('/');
        const id = Number(parts[parts.length - 2]);
        const graph = mockGraphs[id] ?? { nodes: [], edges: [] };
        return [200, { nodes: [...graph.nodes], edges: [...graph.edges] }];
    });

    // PUT /processes/:id/graph
    mock.onPut(/\/processes\/\d+\/graph/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const parts = (cfg.url ?? '').split('/');
        const id = Number(parts[parts.length - 2]);
        const body = (cfg as unknown as { data?: string }).data;
        const graph: ProcessGraph = body ? JSON.parse(body) : { nodes: [], edges: [] };
        mockGraphs[id] = { nodes: [...graph.nodes], edges: [...graph.edges] };
        // Update stepCount in the flat list
        const idx = mockStore.findIndex(p => p.id === id);
        if (idx !== -1) {
            mockStore[idx] = { ...mockStore[idx]!, stepCount: graph.nodes.length };
        }
        logger.debug('[mock] PUT /processes/:id/graph', { id, nodes: graph.nodes.length });
        return [204];
    });

    // GET /processes/:id — rich DTO
    mock.onGet(/\/processes\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            const flat = mockStore.find(p => p.id === id);
            if (!flat) return [404, { error: { message: `Process ${id} not found` } }];
            return [200, {
                id: flat.id, status: flat.status, sourceLang: flat.sourceLang,
                topicIds: flat.topicIds, userTypeIds: flat.userTypeIds,
                producedDocTypeIds: flat.producedDocTypeIds,
                translations: { [flat.sourceLang]: { title: flat.title, description: flat.description, tStatus: 'DRAFT' } },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: new Date().toISOString(), createdByName: 'System' }],
            }];
        }
        return [200, {
            ...found,
            translations: { ...found.translations },
            topicIds: [...(found.topicIds ?? [])],
            userTypeIds: [...(found.userTypeIds ?? [])],
            producedDocTypeIds: [...(found.producedDocTypeIds ?? [])],
        }];
    });

    // GET /processes — list
    mock.onGet('/processes').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const filtered = applyMockFilters(cfg);
        const page = Number(cfg.params?.['page'] ?? 1);
        const pageSize = Math.min(Number(cfg.params?.['pageSize'] ?? 20), 100);
        const start = (page - 1) * pageSize;
        return [200, filtered.slice(start, start + pageSize)];
    });

    // POST /processes
    mock.onPost('/processes').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateProcessPayload> = body ? JSON.parse(body) : {};
        const srcLang = input.sourceLang ?? 'it';
        const srcTitle = input.translations?.[srcLang]?.title ?? input.title ?? 'Nuovo processo';
        const newItem: Process = {
            id: _nextId++,
            title: srcTitle,
            description: input.translations?.[srcLang]?.description ?? input.description ?? '',
            status: 'DRAFT',
            sourceLang: srcLang,
            topicIds: input.topicIds ?? [],
            userTypeIds: input.userTypeIds ?? [],
            producedDocTypeIds: input.producedDocTypeIds ?? [],
            stepCount: 0,
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id, status: 'DRAFT', sourceLang: srcLang,
            topicIds: input.topicIds ?? [],
            userTypeIds: input.userTypeIds ?? [],
            producedDocTypeIds: input.producedDocTypeIds ?? [],
            translations: input.translations
                ? Object.fromEntries(Object.entries(input.translations).map(([l, c]) => [
                    l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                ]))
                : { [srcLang]: { title: srcTitle, description: input.description ?? '', tStatus: 'DRAFT' } },
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'System' }],
        };
        mockGraphs[newItem.id] = { nodes: [], edges: [] };
        return [200, { ...newItem }];
    });

    // PUT /processes/:id
    mock.onPut(/\/processes\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: ProcessFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(p => p.id === id);
        if (idx === -1) return [404, { error: { message: `Process ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        const newStatus = full.status ?? mockStore[idx]!.status;

        mockStore[idx] = {
            ...mockStore[idx]!,
            title: srcTr?.title ?? mockStore[idx]!.title,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: newStatus,
            sourceLang: srcLang,
            topicIds: full.topicIds ?? [],
            userTypeIds: full.userTypeIds ?? [],
            producedDocTypeIds: full.producedDocTypeIds ?? [],
        };

        const prevTrs = mockFull[id]?.translations ?? {};
        const updatedTrs: Record<string, ProcessTranslation> = {
            ...prevTrs,
            ...Object.fromEntries(Object.entries(full.translations ?? {}).map(([l, c]) => [
                l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
            ])),
        };
        if (newStatus === 'APPROVED') {
            for (const lang of Object.keys(updatedTrs)) {
                if (lang !== srcLang) {
                    const tr = updatedTrs[lang];
                    if (tr) updatedTrs[lang] = { ...tr, tStatus: 'STALE' };
                }
            }
        }
        mockFull[id] = { ...mockFull[id], ...full, translations: updatedTrs };
        return [204];
    });

    // PATCH /processes/:id
    mock.onPatch(/\/processes\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const patch: PatchProcessPayload = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(p => p.id === id);
        if (idx === -1) return [404, { error: { message: `Process ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, ...(patch.status && { status: patch.status }) };
        const existing = mockFull[id];
        if (existing && patch.status) mockFull[id] = { ...existing, status: patch.status };
        return [204];
    });

    // DELETE /processes/:id
    mock.onDelete(/\/processes\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        mockStore = mockStore.filter(p => p.id !== id);
        delete mockFull[id];
        delete mockGraphs[id];
        return [204];
    });

    logger.debug('[mock] process handlers registered');
}

function applyMockFilters(cfg: MockRequestConfig): Process[] {
    const topicIds = cfg.params?.['topicIds']
        ? String(cfg.params['topicIds']).split(',').map(Number)
        : undefined;
    const userTypeIds = cfg.params?.['userTypeIds']
        ? String(cfg.params['userTypeIds']).split(',').map(Number)
        : undefined;
    return mockStore.filter(p => {
        if (topicIds?.length && !topicIds.every(tid => p.topicIds.includes(tid))) return false;
        if (userTypeIds?.length && !userTypeIds.every(uid => p.userTypeIds.includes(uid))) return false;
        return true;
    });
}