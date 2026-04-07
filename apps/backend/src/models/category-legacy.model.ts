import { Model, model, property } from '@loopback/repository';

/**
 * src/models/category-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for CATEGORY content items.
 *
 * Used by:
 *   - GET  /categories        (list)
 *   - POST /categories        (create response)
 *
 * A single CATEGORY content type serves both event and information categories,
 * differentiated by the `subtype` field stored in content_revision.data_extra.
 *
 * ── Subtype values ────────────────────────────────────────────────────────────
 *   "event"       → used to classify Events & Courses
 *   "information" → used to classify Useful Information items
 *
 * ── Field mapping ─────────────────────────────────────────────────────────────
 *   title    → content_revision_translation.title
 *   subtype  → content_revision.data_extra.subtype
 *
 * No `description` field — categories have only a title.
 * No `dataExtra` exposed on the flat DTO — subtype is surfaced directly.
 */
@model({ description: 'Flat Category DTO (event or information subtype)' })
export class CategoryLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    /** Category label in the source language. */
    @property({ type: 'string' })
    title?: string;

    /** Revision lifecycle status. */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO 639-1 authoring language code. */
    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * Category domain.
     *   "event"       → Event & Courses categories
     *   "information" → Useful Information categories
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['event', 'information'] },
    })
    subtype?: 'event' | 'information';

    constructor(data?: Partial<CategoryLegacy>) {
        super(data);
    }
}