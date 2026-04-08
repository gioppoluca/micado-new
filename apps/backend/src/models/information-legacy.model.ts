import { Model, model, property } from '@loopback/repository';

/**
 * src/models/information-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for INFORMATION content items
 * (Useful Information Centre).
 *
 * ── Differences vs EventLegacy ────────────────────────────────────────────────
 *
 *  Information items have NO non-translatable metadata (no dates, no location,
 *  no cost). The only data_extra is an empty object stored for CRT conformance.
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *
 *   title           → content_revision_translation.title
 *   description     → content_revision_translation.description  (Markdown)
 *   categoryId      → content_item_relation (relationType='category')
 *   topicIds        → content_item_relation (relationType='topic')
 *   userTypeIds     → content_item_relation (relationType='user_type')
 */
@model({ description: 'Flat Information DTO returned by list and create' })
export class InformationLegacy extends Model {
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

    /** ID of the linked CATEGORY (information subtype). Null = uncategorised. */
    @property({ type: 'number' })
    categoryId?: number | null;

    /** Resolved category title for list display. */
    @property({ type: 'string' })
    categoryTitle?: string;

    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    constructor(data?: Partial<InformationLegacy>) {
        super(data);
    }
}