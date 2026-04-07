import { Model, model, property } from '@loopback/repository';

/**
 * src/models/event-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for EVENT content items.
 *
 * Used by:
 *   - GET  /events        (list — sourceLang only, with resolved relations)
 *   - POST /events        (create response)
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *
 *   title           → content_revision_translation.title
 *   description     → content_revision_translation.description  (Markdown)
 *   startDate       → content_revision.data_extra.startDate     (ISO string)
 *   endDate         → content_revision.data_extra.endDate       (ISO string)
 *   location        → content_revision.data_extra.location      (string)
 *   cost            → content_revision.data_extra.cost          (string | null)
 *   isFree          → content_revision.data_extra.isFree        (boolean)
 *   categoryId      → content_item_relation.parentItemId (relationType='category')
 *   topicIds        → content_item_relation.parentItemIds (relationType='topic')
 *   userTypeIds     → content_item_relation.parentItemIds (relationType='user_type')
 *
 * ── Resolved fields in list response ─────────────────────────────────────────
 *
 *   categoryTitle   → resolved from CATEGORY content item (convenience field)
 *   topicTitles     → resolved titles for each linked topic
 *   userTypeTitles  → resolved titles for each linked user type
 */
@model({ description: 'Flat Event DTO returned by list and create' })
export class EventLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    /** Event title in the source language. */
    @property({ type: 'string' })
    title?: string;

    /** Event description in the source language (Markdown). */
    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** ISO 8601 start datetime string. */
    @property({ type: 'string' })
    startDate?: string;

    /** ISO 8601 end datetime string. */
    @property({ type: 'string' })
    endDate?: string;

    /** Optional free-text location (address or venue name). */
    @property({ type: 'string' })
    location?: string;

    /** Cost string (e.g. "€ 10"). null when isFree=true. */
    @property({ type: 'string' })
    cost?: string | null;

    /** True when the event is free of charge. */
    @property({ type: 'boolean' })
    isFree?: boolean;

    /** ID of the linked CATEGORY content item (event subtype). Null = uncategorised. */
    @property({ type: 'number' })
    categoryId?: number | null;

    /**
     * Resolved category title for display in list rows.
     * Only populated by GET /events (list) — not stored in DB.
     */
    @property({ type: 'string' })
    categoryTitle?: string;

    /** IDs of linked TOPIC content items. */
    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    /** IDs of linked USER_TYPE content items. */
    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    constructor(data?: Partial<EventLegacy>) {
        super(data);
    }
}