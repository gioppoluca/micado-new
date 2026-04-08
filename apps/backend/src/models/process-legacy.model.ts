import { Model, model, property } from '@loopback/repository';

/**
 * src/models/process-legacy.model.ts
 *
 * Flat DTO for PROCESS content items (Step-by-Step Guides).
 *
 * Used by:
 *   - GET  /processes       (list with resolved relations)
 *   - POST /processes       (create response)
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *
 *   title                 → content_revision_translation.title
 *   description           → content_revision_translation.description (Markdown)
 *   topicIds[]            → content_item_relation (relationType='topic')
 *   userTypeIds[]         → content_item_relation (relationType='user_type')
 *   producedDocTypeIds[]  → content_item_relation (relationType='document_type')
 *
 * ── No dataExtra ─────────────────────────────────────────────────────────────
 *
 *   Process has no non-translatable metadata — all structural information
 *   is held in relations and the CRT translation rows.
 *   data_extra is stored as {} for CRT schema conformance.
 *
 * ── Graph ─────────────────────────────────────────────────────────────────────
 *
 *   The graph (nodes=steps, edges=step-links) is NOT embedded in this DTO.
 *   It is fetched separately via GET /processes/:id/graph which returns
 *   VueFlow-compatible Node[] and Edge[] objects.
 *
 * ── Resolved fields ──────────────────────────────────────────────────────────
 *
 *   topicIds              — IDs of linked TOPIC content items
 *   userTypeIds           — IDs of linked USER_TYPE content items
 *   producedDocTypeIds    — IDs of linked DOCUMENT_TYPE content items
 *                           (documents produced at the end of the process)
 *   stepCount             — total steps in the graph (convenience field)
 */
@model({ description: 'Flat Process DTO returned by list and create' })
export class ProcessLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    @property({ type: 'string' })
    title?: string;

    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    /** IDs of document types produced at the end of this process. */
    @property({ type: 'array', itemType: 'number' })
    producedDocTypeIds?: number[];

    /** Number of steps in the graph. Convenience field for list display. */
    @property({ type: 'number' })
    stepCount?: number;

    constructor(data?: Partial<ProcessLegacy>) {
        super(data);
    }
}