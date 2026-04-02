import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/glossary-full.model.ts
 *
 * Rich DTO for the PA form: GET /glossaries/:id and PUT /glossaries/:id.
 *
 * ── Data layout in the DB ────────────────────────────────────────────────────
 *
 *  content_item [GLOSSARY]
 *    content_revision
 *      data_extra: {}          → always empty (no non-translatable metadata)
 *      content_revision_translation (per lang)
 *        title                 → term label
 *        description           → term definition (Markdown via tiptap-markdown)
 *        i18n_extra: {}        → empty (no extra translatable fields)
 *
 * ── Why description is in the standard column, not i18n_extra ───────────────
 *
 *  The `description` column of content_revision_translation is TEXT and is
 *  the standard slot for rich text content. Markdown is plain text at rest,
 *  so it fits without any special encoding. Weblate ingests it as-is via
 *  the Structured JSON format, making translation straightforward.
 *
 * ── Mention picker endpoint ──────────────────────────────────────────────────
 *
 *  GET /glossary-items (served by the same controller, @authenticate.skip())
 *  returns a lightweight { id, title, lang } list for the RichTextEditor
 *  @-mention suggestion system. Mirrors the shape already expected by
 *  src/api/micado-entities.api.ts in the frontend.
 */

/** Per-language translation entry. */
@model()
export class GlossaryTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    /** Markdown rich text. Empty string when not yet translated. */
    @property({ type: 'string' })
    description?: string;

    /**
     * Read-only translation workflow state.
     * Ignored on PUT — backend always resets to DRAFT on write.
     * Present on GET for per-tab status badges.
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<GlossaryTranslationEntry>) {
        super(data);
    }
}

@model({
    description: 'Full Glossary DTO including all per-language translations — used by PA form',
})
export class GlossaryFull extends Model {
    /** Legacy numeric id (maps to content_item.external_key). */
    @property({ type: 'number' })
    id?: number;

    /** Revision lifecycle status. */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO 639-1 code of the authoring language. */
    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * All per-language translation rows keyed by lang code.
     * On GET: every existing content_revision_translation row.
     * On PUT: present entries are upserted; absent entries are left untouched.
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
                    tStatus: { type: 'string' },
                },
            },
        },
    })
    translations?: Record<string, GlossaryTranslationEntry>;

    /**
     * All revisions of this content item, sorted ascending by revision_no.
     * Included in GET /glossaries/:id — no extra API call needed.
     * Read-only: ignored by PUT.
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

    constructor(data?: Partial<GlossaryFull>) {
        super(data);
    }
}