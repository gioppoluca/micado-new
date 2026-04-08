import { Model, model, property } from '@loopback/repository';

/**
 * src/models/process-graph.model.ts
 *
 * VueFlow-compatible graph DTO for GET/PUT /processes/:id/graph.
 *
 * ── Wire format ───────────────────────────────────────────────────────────────
 *
 *   GET /processes/:id/graph → ProcessGraph
 *   PUT /processes/:id/graph ← ProcessGraph  (atomic replace of all steps + links)
 *
 * ── VueFlow compatibility ─────────────────────────────────────────────────────
 *
 *   VueFlow consumes { nodes: Node[], edges: Edge[] }.
 *   This DTO mirrors that shape exactly, enriched with the domain data
 *   needed for the step form panel (right side of the graph editor).
 *
 * ── Node (GraphNode) ─────────────────────────────────────────────────────────
 *
 *   id          → String(step.externalKey)    — VueFlow requires string ID
 *   type        → 'step'                      — matches custom VueFlow node type
 *   position.x  → step.data_extra.posX
 *   position.y  → step.data_extra.posY
 *   data        → full step content (title, description, location, cost, etc.)
 *                 + all translations for the step form
 *
 * ── Edge (GraphEdge) ─────────────────────────────────────────────────────────
 *
 *   id          → String(stepLink.externalKey)  or UUID for new edges
 *   source      → String(stepLink.data_extra.sourceStepId)
 *   target      → String(stepLink.data_extra.targetStepId)
 *   label       → stepLink title in sourceLang (shown on canvas)
 *   type        → 'step-link'
 *   data        → all translations for the edge form
 *
 * ── Save (PUT) behaviour ─────────────────────────────────────────────────────
 *
 *   The frontend sends the complete graph after editing.
 *   The facade performs an atomic replace:
 *     1. Delete all STEP and STEP_LINK content items for this processId
 *     2. Re-insert all nodes as STEP content items
 *     3. Re-insert all edges as STEP_LINK content items
 *   Returns 204. The frontend then re-fetches GET /processes/:id/graph
 *   to get stable numeric IDs for any newly created nodes/edges.
 *
 * ── ID lifecycle ──────────────────────────────────────────────────────────────
 *
 *   New nodes/edges created in VueFlow get a client-side UUID string ID.
 *   After save, the DB assigns a numeric externalKey.
 *   On re-fetch the frontend gets stable string-numeric IDs ("1", "2", ...).
 *   VueFlow's source/target references are updated by the re-fetch.
 */

// ── Node data ─────────────────────────────────────────────────────────────────

/** Step translation embedded in node data. */
export interface GraphNodeTranslation {
    title: string;
    description?: string;
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';
}

/** Required document embedded in node data_extra. */
export interface GraphRequiredDocument {
    documentTypeId: number;
    cost: string;
    isOut: boolean;
}

/**
 * The `data` payload inside each VueFlow node.
 * This is what the step form panel reads and writes.
 */
export interface GraphNodeData {
    /** sourceLang title — shown as node label on canvas. */
    title: string;
    /** sourceLang description — Markdown. */
    description?: string;
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
    sourceLang: string;
    location?: string;
    cost?: string;
    isFree?: boolean;
    /** External URL (legacy "link" field). */
    url?: string;
    /** Step icon URL. */
    iconUrl?: string;
    requiredDocuments: GraphRequiredDocument[];
    /** All per-language translations for the step form. */
    translations: Record<string, GraphNodeTranslation>;
}

/** VueFlow-compatible node position. */
export interface GraphNodePosition {
    x: number;
    y: number;
}

// ── Edge data ─────────────────────────────────────────────────────────────────

/** Step-link translation embedded in edge data. */
export interface GraphEdgeTranslation {
    title: string;
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';
}

/** The `data` payload inside each VueFlow edge. */
export interface GraphEdgeData {
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';
    sourceLang: string;
    /** All per-language translations for the edge form. */
    translations: Record<string, GraphEdgeTranslation>;
}

// ── LoopBack model wrappers ───────────────────────────────────────────────────
// These wrap the plain interfaces in LoopBack @model classes so they can be
// used in OpenAPI schema generation and request/response body validation.

@model()
export class GraphNode extends Model {
    /** String ID — numeric for persisted nodes, UUID for new unsaved nodes. */
    @property({ type: 'string', required: true })
    id: string;

    /** Always 'step' — matches the custom VueFlow node type. */
    @property({ type: 'string' })
    type?: string;

    @property({
        type: 'object',
        jsonSchema: {
            type: 'object',
            required: ['x', 'y'],
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
            },
        },
    })
    position: GraphNodePosition;

    /** Full step content. See GraphNodeData interface. */
    @property({
        type: 'object',
        jsonSchema: { type: 'object', additionalProperties: true },
    })
    data: GraphNodeData;

    constructor(data?: Partial<GraphNode>) {
        super(data);
    }
}

@model()
export class GraphEdge extends Model {
    /** String ID — numeric for persisted edges, UUID for new unsaved edges. */
    @property({ type: 'string', required: true })
    id: string;

    /** externalKey string of the source STEP. */
    @property({ type: 'string', required: true })
    source: string;

    /** externalKey string of the target STEP. */
    @property({ type: 'string', required: true })
    target: string;

    /** Always 'step-link' — matches the custom VueFlow edge type. */
    @property({ type: 'string' })
    type?: string;

    /** Edge label shown on the canvas — sourceLang title. */
    @property({ type: 'string' })
    label?: string;

    /** Full edge content including all translations. */
    @property({
        type: 'object',
        jsonSchema: { type: 'object', additionalProperties: true },
    })
    data?: GraphEdgeData;

    constructor(data?: Partial<GraphEdge>) {
        super(data);
    }
}

@model({ description: 'Complete VueFlow-compatible graph for a process' })
export class ProcessGraph extends Model {
    /** All step nodes in the graph. */
    @property({
        type: 'array',
        itemType: GraphNode,
        jsonSchema: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
        },
    })
    nodes: GraphNode[];

    /** All step-link edges in the graph. */
    @property({
        type: 'array',
        itemType: GraphEdge,
        jsonSchema: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
        },
    })
    edges: GraphEdge[];

    constructor(data?: Partial<ProcessGraph>) {
        super(data);
    }
}