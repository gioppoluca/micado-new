import { Model, model, property } from '@loopback/repository';

/**
 * src/models/topic-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for TOPIC content items.
 *
 * Used by:
 *   - GET  /topics        (list — lightweight, sourceLang title only)
 *   - POST /topics        (create response)
 *
 * Field mapping to legacy `topic` / `topic_translation` tables:
 *   topic       → content_revision_translation.title
 *   description → content_revision_translation.description
 *   icon        → content_revision.data_extra.icon   (base64 data URI)
 *   parentId    → content_item_relation (relationType='parent')
 *                 stored as the external_key (numeric) of the parent topic
 *                 so legacy consumers receive the same integer id they always had.
 *   depth       → derived at read time from the relation chain; not stored.
 */
@model({
    description: 'Legacy-compatible Topic DTO mapped to the generic content core',
})
export class TopicLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    /**
     * Topic name in the source language.
     * Maps to legacy `topic` column in topic_translation.
     * Stored in content_revision_translation.title.
     */
    @property({ type: 'string' })
    topic?: string;

    /** Description of the topic. Maps to content_revision_translation.description. */
    @property({ type: 'string' })
    description?: string;

    /** Revision lifecycle status. */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO 639-1 code of the authoring language (e.g. 'it'). */
    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * Non-translatable metadata stored in content_revision.data_extra.
     * Shape: { icon: string }
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    /**
     * Numeric external_key of the parent topic, or null for root topics.
     * Derived from content_item_relation (relationType='parent').
     */
    @property({ type: 'number' })
    parentId?: number | null;

    /**
     * 0-based depth in the hierarchy (0 = root).
     * Derived at read time by walking the parent chain.
     * Read-only — never persisted directly.
     */
    @property({ type: 'number' })
    depth?: number;

    constructor(data?: Partial<TopicLegacy>) {
        super(data);
    }
}