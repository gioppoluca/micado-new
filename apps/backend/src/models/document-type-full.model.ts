/**
 * src/models/document-type-full.model.ts
 *
 * Rich DTO returned by GET /document-types/:id (PA form context).
 *
 * ── Why two models ───────────────────────────────────────────────────────────
 *
 * DocumentTypeLegacy is the flat, legacy-compatible shape used by:
 *   - GET  /document-types        (list — lightweight, sourceLang only)
 *   - POST /document-types        (create response)
 *
 * DocumentTypeFull is the rich shape used by:
 *   - GET  /document-types/:id    (form open — all translations for tab editors)
 *   - PUT  /document-types/:id    (form save — all translations in one shot)
 *
 * ── translations shape ───────────────────────────────────────────────────────
 *
 * translations: {
 *   "it": { title: "Permesso di soggiorno", description: "...", tStatus: "DRAFT"  },
 *   "en": { title: "Residence permit",      description: "...", tStatus: "STALE"  },
 *   "ar": { title: "",                      description: "",    tStatus: "STALE"  }
 * }
 *
 * Keys present  = languages with a row in content_revision_translation.
 * Keys absent   = never translated yet; PA form shows an empty editor tab.
 * tStatus       = read-only on PUT input; meaningful on GET for per-tab badges.
 *
 * ── dataExtra shape (revision_schema) ────────────────────────────────────────
 *
 * dataExtra: {
 *   icon:             "data:image/png;base64,...",  // base64 data URI
 *   issuer:           "MOIT",                       // varchar(20)
 *   model_template:   "...",                        // legacy `model` column
 *   validable:        true,                         // required boolean
 *   validity_duration: 365                          // days, nullable
 * }
 */

import { Model, model, property } from '@loopback/repository';

/**
 * Lightweight revision summary — included in DocumentTypeFull.revisions[].
 * Read-only on PUT (ignored by the backend if sent back).
 */
@model()
export class RevisionSummary extends Model {
    /** Monotonic revision number (1, 2, 3, …). */
    @property({ type: 'number' })
    revisionNo: number;

    /** Workflow state of this revision. */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO timestamp when this revision was created. */
    @property({ type: 'string' })
    createdAt?: string;

    /**
     * Display name of the actor who created this revision.
     * Derived from createdBy.name in the facade — the frontend never needs
     * to drill into the nested JSONB object.
     */
    @property({ type: 'string' })
    createdByName?: string;

    /** ISO timestamp when this revision was published (undefined if not yet published). */
    @property({ type: 'string' })
    publishedAt?: string;

    constructor(data?: Partial<RevisionSummary>) {
        super(data);
    }
}

/** Single per-language entry within the translations map. */
@model()
export class DocumentTypeTranslationEntry extends Model {
    /**
     * Document name in this language.
     * Maps to legacy `document` column → content_revision_translation.title.
     */
    @property({ type: 'string', required: true })
    title: string;

    /** Description of the document type in this language. */
    @property({ type: 'string' })
    description?: string;

    /**
     * Read-only translation workflow state for this language row.
     * Ignored on PUT input; populated on GET output.
     * DRAFT     → being edited by PA
     * STALE     → source changed after this translation was saved
     * APPROVED  → validated by translator, ready for publication
     * PUBLISHED → live on migrant frontend
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<DocumentTypeTranslationEntry>) {
        super(data);
    }
}

@model({
    description: 'Full Document Type DTO including all per-language translations — used by PA form',
})
export class DocumentTypeFull extends Model {
    /** Legacy numeric id (maps to content_item.external_key). */
    @property({ type: 'number' })
    id?: number;

    /**
     * Workflow state of the current content revision.
     *
     * DRAFT     : non-translatable fields and source text editable.
     * APPROVED  : source text frozen ("Send to translation" ON).
     *             Non-source translations are marked STALE automatically.
     * PUBLISHED : live on the migrant frontend.
     * ARCHIVED  : retired, superseded by a newer published revision.
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO 639-1 code of the authoring/source language (e.g. 'it'). */
    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * Non-translatable metadata stored in content_revision.data_extra.
     *
     * Expected shape (matches DOCUMENT_TYPE revision_schema):
     * {
     *   icon:             string  — base64 data URI (data:image/png;base64,...)
     *   issuer:           string  — issuing authority code, max 20 chars
     *   model_template:   string  — document template reference (legacy `model`)
     *   validable:        boolean — required; whether digital validation is supported
     *   validity_duration: number — validity in days; null = does not expire
     * }
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    /**
     * All per-language translation rows for the current preferred revision.
     * Keyed by lang code (e.g. "it", "en", "ar").
     *
     * On GET: populated with every existing content_revision_translation row.
     * On PUT: the full map is upserted; languages absent from the payload are
     *         left untouched (concurrent translator work is preserved).
     */
    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: {
                type: 'object',
                required: ['title'],
                properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    tStatus: {
                        type: 'string',
                        enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'],
                    },
                },
            },
        },
    })
    translations?: Record<string, DocumentTypeTranslationEntry>;

    /**
     * All revisions of this content item, sorted ascending by revision_no.
     * Read-only: ignored by PUT.
     * UI use: version history panel below the editor tabs.
     */
    @property({
        type: 'array',
        itemType: RevisionSummary,
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    revisionNo: { type: 'number' },
                    status: { type: 'string' },
                    createdAt: { type: 'string' },
                    createdByName: { type: 'string' },
                    publishedAt: { type: 'string' },
                },
            },
        },
    })
    revisions?: RevisionSummary[];

    constructor(data?: Partial<DocumentTypeFull>) {
        super(data);
    }
}