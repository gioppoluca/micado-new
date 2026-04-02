/**
 * src/api/topic.api.ts
 *
 * HTTP calls for the /topics resource.
 *
 * ── Two distinct DTO shapes ──────────────────────────────────────────────────
 *
 *   Topic (flat / legacy)
 *     id, topic, description, status, sourceLang, dataExtra, parentId, depth
 *     Used by: GET /topics list, POST /topics create response.
 *     Contains only the sourceLang translation.
 *     Binding: q-list rows (icon, label, parent badge, status).
 *
 *   TopicFull (rich)
 *     status, sourceLang, dataExtra, parentId, depth
 *     + translations: Record<lang, { title, description, tStatus? }>
 *     + revisions: RevisionSummary[]
 *     Used by: GET /topics/:id (form open), PUT /topics/:id (form save).
 *
 * ── parentId / depth semantics ───────────────────────────────────────────────
 *
 *   parentId  numeric external_key of the parent topic, or null for root.
 *   depth     0-based level in the hierarchy (0 = root, 1 = first child, …).
 *   Both fields are present on ALL responses (list and full).
 *
 * ── Endpoint map ────────────────────────────────────────────────────────────
 *
 *   GET    /topics                  list → Topic[]
 *   GET    /topics/count            count
 *   POST   /topics                  create → Topic
 *   GET    /topics/to-production    publish → 204
 *   GET    /topics/:id              form open → TopicFull
 *   PUT    /topics/:id              form save → 204
 *   PATCH  /topics/:id              partial → 204 (status, icon, parentId)
 *   DELETE /topics/:id              delete → 204 (409 if has children)
 *   GET    /topics-migrant          migrant frontend (published, lang-resolved)
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TopicStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
export type TranslationStatus = 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

export interface TopicDataExtra {
    icon?: string;
}

/**
 * Flat, legacy-compatible DTO.
 * Returned by list (GET /topics) and create (POST /topics).
 * Contains only the sourceLang translation.
 */
export interface Topic {
    id: number;
    /** Topic name in the source language. */
    topic: string;
    description: string;
    status: TopicStatus;
    sourceLang: string;
    dataExtra?: TopicDataExtra;
    /** Numeric external_key of the parent topic, or null for root topics. */
    parentId: number | null;
    /** 0-based depth in the hierarchy (0 = root). Read-only. */
    depth: number;
}

/** Per-language translation entry. */
export interface TopicTranslation {
    title: string;
    description: string;
    /** Read-only. Present in GET responses, ignored in PUT bodies. */
    tStatus?: TranslationStatus;
}

/** Lightweight revision summary included in TopicFull.revisions[]. */
export interface RevisionSummary {
    revisionNo: number;
    status: TopicStatus;
    createdAt?: string;
    createdByName?: string;
    publishedAt?: string;
}

/**
 * Rich DTO with all translations embedded.
 * Returned by GET /topics/:id.
 * Sent to   PUT /topics/:id.
 */
export interface TopicFull {
    id?: number;
    status?: TopicStatus;
    sourceLang?: string;
    dataExtra?: TopicDataExtra;
    /** Numeric external_key of the parent, or null for root. */
    parentId?: number | null;
    /** 0-based depth. Read-only on PUT. */
    depth?: number;
    /**
     * All per-language rows keyed by lang code.
     * On PUT: present entries are upserted; absent entries are left untouched.
     */
    translations?: Record<string, TopicTranslation>;
    /** All revisions. Read-only on PUT. */
    revisions?: RevisionSummary[];
}

export type CreateTopicPayload = Omit<Topic, 'id' | 'depth'> & {
    translations?: Record<string, { title: string; description?: string }>;
};

export type PatchTopicPayload = Partial<Omit<Topic, 'id' | 'depth'>>;

// ─── Tree node type (for vue3-treeselect) ─────────────────────────────────────

/**
 * Node shape required by vue3-treeselect.
 * Built client-side from the flat Topic[] list by topicApi.toTreeNodes().
 */
export interface TopicTreeNode {
    id: number;
    label: string;
    /** 0-based depth — used by TopicTreeSelect to disable nodes beyond max_depth. */
    depth: number;
    children?: TopicTreeNode[];
    /** Populated by TopicTreeSelect to disable nodes beyond max_depth. */
    isDisabled?: boolean;
    /** Index signature required for assignability to TreeselectNode under exactOptionalPropertyTypes. */
    [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a flat Topic[] list into a nested tree for vue3-treeselect.
 *
 * Algorithm:
 *  1. Build a map id → node.
 *  2. Walk once: attach each node to its parent's children array.
 *  3. Return only the root nodes (depth === 0, or parentId === null).
 *
 * Nodes at depth > maxSelectableDepth have isDisabled=true so the picker
 * shows them but prevents selecting them as a parent.
 * maxSelectableDepth is 0-based: 0 = only roots selectable, 1 = roots + children, …
 *
 * The excludeId param removes a specific topic from the tree (used when
 * editing a topic — it must not appear as its own parent option).
 */
export function toTreeNodes(
    topics: Topic[],
    maxSelectableDepth: number,
    excludeId?: number,
): TopicTreeNode[] {
    // Build node map, skipping the excluded id
    const nodeMap = new Map<number, TopicTreeNode>();
    for (const t of topics) {
        if (t.id === excludeId) continue;
        nodeMap.set(t.id, {
            id: t.id,
            label: t.topic || `Topic ${t.id}`,
            depth: t.depth,
            children: [],
            isDisabled: t.depth >= maxSelectableDepth,
        });
    }

    const roots: TopicTreeNode[] = [];
    for (const t of topics) {
        if (t.id === excludeId) continue;
        const node = nodeMap.get(t.id)!;
        if (t.parentId === null || !nodeMap.has(t.parentId)) {
            roots.push(node);
        } else {
            const parent = nodeMap.get(t.parentId)!;
            parent.children = parent.children ?? [];
            parent.children.push(node);
        }
    }

    // Remove empty children arrays (vue3-treeselect treats [] as leaf differently)
    function prune(nodes: TopicTreeNode[]): void {
        for (const n of nodes) {
            if (n.children && n.children.length === 0) {
                delete n.children;
            } else if (n.children) {
                prune(n.children);
            }
        }
    }
    prune(roots);

    return roots;
}

export function topicStatusKey(t: Pick<Topic, 'status'>): string {
    switch (t.status) {
        case 'DRAFT': return 'translation_states.editing';
        case 'APPROVED': return 'translation_states.translatable';
        case 'PUBLISHED': return 'translation_states.translated';
        case 'ARCHIVED': return 'translation_states.archived';
        default: return 'translation_states.editing';
    }
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const topicApi = {

    async list(): Promise<Topic[]> {
        logger.info('[topic.api] list');
        return apiGet<Topic[]>('/topics');
    },

    async getOne(id: number): Promise<TopicFull> {
        logger.info('[topic.api] getOne', { id });
        return apiGet<TopicFull>(`/topics/${id}`);
    },

    async create(payload: CreateTopicPayload): Promise<Topic> {
        logger.info('[topic.api] create', { topic: payload.topic, parentId: payload.parentId });
        return apiPost<Topic>('/topics', payload);
    },

    async save(id: number, payload: TopicFull): Promise<void> {
        logger.info('[topic.api] save', { id, langCount: Object.keys(payload.translations ?? {}).length });
        return apiPut<void>(`/topics/${id}`, payload);
    },

    async patch(id: number, payload: PatchTopicPayload): Promise<void> {
        logger.info('[topic.api] patch', { id, fields: Object.keys(payload) });
        return apiPatch<void>(`/topics/${id}`, payload);
    },

    async remove(id: number): Promise<void> {
        logger.warn('[topic.api] remove', { id });
        return apiDelete(`/topics/${id}`);
    },

    async publish(id: number): Promise<void> {
        logger.info('[topic.api] publish', { id });
        await apiGet<unknown>('/topics/to-production', { params: { id } });
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────

let _nextId = 100;

// In-memory store: flat list with parentId / depth
let mockStore: Topic[] = [
    { id: 1, topic: 'Alloggio', description: 'Tutto ciò che riguarda abitazioni', status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0 },
    { id: 2, topic: 'Residenza', description: 'Residenza anagrafica e domicilio', status: 'APPROVED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: 1, depth: 1 },
    { id: 3, topic: 'Affitto', description: 'Contratti di locazione', status: 'DRAFT', sourceLang: 'it', dataExtra: { icon: '' }, parentId: 1, depth: 1 },
    { id: 4, topic: 'Salute', description: 'Servizi sanitari e assistenza', status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0 },
    { id: 5, topic: 'Salute mentale', description: 'Supporto psicologico', status: 'DRAFT', sourceLang: 'it', dataExtra: { icon: '' }, parentId: 4, depth: 1 },
    { id: 6, topic: 'Pronto soccorso', description: 'Accesso al pronto soccorso', status: 'DRAFT', sourceLang: 'it', dataExtra: { icon: '' }, parentId: 4, depth: 1 },
    { id: 7, topic: 'Lavoro', description: 'Opportunità e diritti lavorativi', status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0 },
];

const mockFull: Partial<Record<number, TopicFull>> = {
    1: {
        id: 1, status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0,
        translations: {
            it: { title: 'Alloggio', description: 'Tutto ciò che riguarda abitazioni', tStatus: 'PUBLISHED' },
            en: { title: 'Housing', description: 'Everything about housing', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    2: {
        id: 2, status: 'APPROVED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: 1, depth: 1,
        translations: {
            it: { title: 'Residenza', description: 'Residenza anagrafica e domicilio', tStatus: 'DRAFT' },
            en: { title: 'Residence', description: '', tStatus: 'STALE' },
        },
        revisions: [{ revisionNo: 1, status: 'APPROVED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    4: {
        id: 4, status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0,
        translations: {
            it: { title: 'Salute', description: 'Servizi sanitari e assistenza', tStatus: 'PUBLISHED' },
            en: { title: 'Health', description: 'Healthcare services', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
    7: {
        id: 7, status: 'PUBLISHED', sourceLang: 'it', dataExtra: { icon: '' }, parentId: null, depth: 0,
        translations: {
            it: { title: 'Lavoro', description: 'Opportunità e diritti lavorativi', tStatus: 'PUBLISHED' },
            en: { title: 'Work', description: 'Work opportunities and rights', tStatus: 'PUBLISHED' },
        },
        revisions: [{ revisionNo: 1, status: 'PUBLISHED', createdAt: '2024-01-01T00:00:00Z', createdByName: 'Admin' }],
    },
};

/** Recomputes depth for a topic in the mock store by walking the parent chain. */
function computeMockDepth(id: number, visited = new Set<number>()): number {
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const t = mockStore.find(x => x.id === id);
    if (!t || t.parentId === null) return 0;
    return 1 + computeMockDepth(t.parentId, visited);
}

export function registerTopicMocks(mock: MockRegistry): void {

    // GET /topics — flat list
    mock.onGet('/topics').reply((): MockReplyTuple => {
        logger.debug('[mock] GET /topics', { count: mockStore.length });
        return [200, [...mockStore]];
    });

    // GET /topics/to-production — before /:id to avoid collision
    mock.onGet('/topics/to-production').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number(cfg.params?.['id']);
        const idx = mockStore.findIndex(t => t.id === id);
        if (idx === -1) return [404, { error: { message: `Topic ${id} not found` } }];
        mockStore[idx] = { ...mockStore[idx]!, status: 'PUBLISHED' };
        if (mockFull[id]) mockFull[id].status = 'PUBLISHED';
        return [200, {}];
    });

    // GET /topics/:id — rich (TopicFull)
    mock.onGet(/\/topics\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const found = mockFull[id];
        if (!found) {
            // Build a minimal full from the flat store
            const flat = mockStore.find(t => t.id === id);
            if (!flat) return [404, { error: { message: `Topic ${id} not found` } }];
            const minimal: TopicFull = {
                id: flat.id, status: flat.status, sourceLang: flat.sourceLang,
                ...(flat.dataExtra !== undefined && { dataExtra: flat.dataExtra }),
                parentId: flat.parentId, depth: flat.depth,
                translations: { [flat.sourceLang]: { title: flat.topic, description: flat.description, tStatus: 'DRAFT' } },
                revisions: [{ revisionNo: 1, status: flat.status, createdAt: '2024-01-01T00:00:00Z', createdByName: 'System' }],
            };
            return [200, minimal];
        }
        return [200, { ...found, translations: { ...found.translations } }];
    });

    // POST /topics — create
    mock.onPost('/topics').reply((cfg: MockRequestConfig): MockReplyTuple => {
        const body = (cfg as unknown as { data?: string }).data;
        const input: Partial<CreateTopicPayload> = body ? JSON.parse(body) : {};
        const parentId = input.parentId ?? null;
        const depth = parentId !== null ? computeMockDepth(parentId) + 1 : 0;
        const newItem: Topic = {
            id: _nextId++,
            topic: input.topic ?? 'Nuovo topic',
            description: input.description ?? '',
            status: 'DRAFT',
            sourceLang: input.sourceLang ?? 'it',
            dataExtra: input.dataExtra ?? { icon: '' },
            parentId,
            depth,
        };
        mockStore.push(newItem);
        mockFull[newItem.id] = {
            id: newItem.id, status: newItem.status, sourceLang: newItem.sourceLang,
            ...(newItem.dataExtra !== undefined && { dataExtra: newItem.dataExtra }),
            parentId: newItem.parentId, depth: newItem.depth,
            translations: input.translations
                ? Object.fromEntries(Object.entries(input.translations).map(([l, c]) => [
                    l, { title: c.title, description: c.description ?? '', tStatus: 'DRAFT' as const },
                ]))
                : { [newItem.sourceLang]: { title: newItem.topic, description: newItem.description, tStatus: 'DRAFT' } },
            revisions: [{ revisionNo: 1, status: 'DRAFT', createdAt: new Date().toISOString(), createdByName: 'System' }],
        };
        logger.debug('[mock] POST /topics created', { id: newItem.id, parentId, depth });
        return [200, { ...newItem }];
    });

    // PUT /topics/:id — full replace
    mock.onPut(/\/topics\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const body = (cfg as unknown as { data?: string }).data;
        const full: TopicFull = body ? JSON.parse(body) : {};
        const idx = mockStore.findIndex(t => t.id === id);
        if (idx === -1) return [404, { error: { message: `Topic ${id} not found` } }];

        const srcLang = full.sourceLang ?? mockStore[idx]!.sourceLang;
        const srcTr = full.translations?.[srcLang];
        const newParentId = full.parentId !== undefined ? full.parentId : mockStore[idx]!.parentId;
        const newDepth = newParentId !== null ? computeMockDepth(newParentId) + 1 : 0;

        mockStore[idx] = {
            ...mockStore[idx]!,
            topic: srcTr?.title ?? mockStore[idx]!.topic,
            description: srcTr?.description ?? mockStore[idx]!.description,
            status: full.status ?? mockStore[idx]!.status,
            sourceLang: srcLang,
            parentId: newParentId,
            depth: newDepth,
            ...(full.dataExtra !== undefined ? { dataExtra: full.dataExtra } : {}),
        };

        // Mark non-source translations STALE on APPROVED
        const updatedTrs: Record<string, TopicTranslation> = {
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

        mockFull[id] = { ...mockFull[id], ...full, parentId: newParentId, depth: newDepth, translations: updatedTrs };
        logger.debug('[mock] PUT /topics/:id', { id, parentId: newParentId, depth: newDepth });
        return [204];
    });

    // PATCH /topics/:id — partial
    mock.onPatch(/\/topics\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        const idx = mockStore.findIndex(t => t.id === id);
        if (idx === -1) return [404, { error: { message: `Topic ${id} not found` } }];
        const body = (cfg as unknown as { data?: string }).data;
        const p: Partial<Topic> = body ? JSON.parse(body) : {};

        const base: Topic = mockStore[idx] as Topic;
        const newParentId = p.parentId !== undefined ? p.parentId : base.parentId;
        const newDepth = newParentId !== null ? computeMockDepth(newParentId) + 1 : 0;
        mockStore[idx] = { ...base, ...p, parentId: newParentId, depth: newDepth };
        if (mockFull[id]) {
            mockFull[id] = { ...mockFull[id], ...p, parentId: newParentId, depth: newDepth };
        }
        logger.debug('[mock] PATCH /topics/:id', { id, fields: Object.keys(p) });
        return [204];
    });

    // DELETE /topics/:id
    mock.onDelete(/\/topics\/\d+/).reply((cfg: MockRequestConfig): MockReplyTuple => {
        const id = Number((cfg.url ?? '').split('/').pop());
        // Guard: reject if topic has children
        const hasChildren = mockStore.some(t => t.parentId === id);
        if (hasChildren) {
            return [409, { error: { message: `Cannot delete Topic ${id}: it has child topics` } }];
        }
        mockStore = mockStore.filter(t => t.id !== id);
        delete mockFull[id];
        logger.debug('[mock] DELETE /topics/:id', { id });
        return [204];
    });

    logger.debug('[mock] topic handlers registered');
}