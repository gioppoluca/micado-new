import { Model, model, property } from '@loopback/repository';

/**
 * src/models/glossary-legacy.model.ts
 *
 * Flat, legacy-compatible DTO for GLOSSARY content items.
 *
 * Used by:
 *   - GET  /glossaries        (list — lightweight, sourceLang only)
 *   - POST /glossaries        (create response)
 *
 * Field mapping to legacy `glossary` / `glossary-translation` tables:
 *   title       → content_revision_translation.title
 *   description → content_revision_translation.description  (Markdown)
 *
 * No dataExtra — the glossary has no non-translatable metadata.
 * The description is rich text stored as Markdown (via tiptap-markdown),
 * compatible with Weblate's Structured JSON translation format.
 */
@model({
    description: 'Legacy-compatible Glossary DTO mapped to the generic content core',
})
export class GlossaryLegacy extends Model {
    /** Maps to content_item.external_key (legacy serial id). */
    @property({ type: 'number' })
    id?: number;

    /** Term label in the source language. Maps to content_revision_translation.title. */
    @property({ type: 'string' })
    title?: string;

    /**
     * Term definition in the source language.
     * Stored as Markdown in content_revision_translation.description.
     * Rendered via RichTextEditor / RichTextViewer on the frontend.
     */
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

    constructor(data?: Partial<GlossaryLegacy>) {
        super(data);
    }
}