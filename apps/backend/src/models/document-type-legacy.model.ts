import { Model, model, property } from '@loopback/repository';

/**
 * src/models/document-type-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for DOCUMENT_TYPE content items.
 *
 * Used by:
 *   - GET  /document-types        (list — lightweight, sourceLang title only)
 *   - POST /document-types        (create response)
 *
 * Field mapping to legacy `document_type` table:
 *   document   → title  (content_revision_translation.title)
 *   description → description (content_revision_translation.description)
 *   icon        → data_extra.icon  (base64 data URI)
 *   issuer      → data_extra.issuer
 *   model       → data_extra.model_template
 *   validable   → data_extra.validable
 *   validityDuration → data_extra.validity_duration
 */
@model({
    description: 'Legacy-compatible Document Type DTO mapped to the generic content core',
})
export class DocumentTypeLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    /**
     * Document name in the source language.
     * Maps to legacy `document` column in document_type_translation.
     * Stored in content_revision_translation.title.
     */
    @property({ type: 'string' })
    document?: string;

    /** Description of the document type. Maps to content_revision_translation.description. */
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
     * Shape: { icon, issuer, model_template, validable, validity_duration }
     * See revision_schema in content_type seed for the full JSON Schema.
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    constructor(data?: Partial<DocumentTypeLegacy>) {
        super(data);
    }
}