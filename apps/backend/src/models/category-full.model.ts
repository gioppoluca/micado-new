import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/category-full.model.ts
 *
 * Rich DTO for the PA form: GET /categories/:id and PUT /categories/:id.
 *
 * ── Data layout in the DB ────────────────────────────────────────────────────
 *
 *  content_item [CATEGORY]
 *    content_revision
 *      data_extra: { subtype: "event" | "information" }
 *      content_revision_translation (per lang)
 *        title       → category label
 *        description → "" (not used for categories)
 *        i18n_extra: {}
 *
 * ── Why description is empty ─────────────────────────────────────────────────
 *
 *  Categories are lookup values — only a translatable title is needed.
 *  The `description` column in content_revision_translation is stored as ""
 *  to satisfy the NOT NULL constraint, but is never displayed.
 *
 * ── Subtype immutability ─────────────────────────────────────────────────────
 *
 *  The subtype ("event" | "information") is set at creation time and is
 *  treated as immutable. PUT ignores any subtype in the body — it is read
 *  from the existing data_extra.
 */

/** Per-language translation entry for a category. */
@model()
export class CategoryTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    /**
     * Read-only translation workflow state.
     * Ignored on PUT — backend always resets to DRAFT on write.
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<CategoryTranslationEntry>) {
        super(data);
    }
}

@model({ description: 'Full Category DTO with all per-language translations' })
export class CategoryFull extends Model {
    /** Legacy numeric id (maps to content_item.external_key). */
    @property({ type: 'number' })
    id?: number;

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
     * Category domain — immutable after creation.
     * On GET: reflects data_extra.subtype.
     * On PUT: ignored (backend preserves the existing value).
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['event', 'information'] },
    })
    subtype?: 'event' | 'information';

    /**
     * Per-language translation rows keyed by lang code.
     * On GET: every existing content_revision_translation row.
     * On PUT: present entries are upserted; absent keys are left untouched.
     * Each entry only needs `title` — description is not used for categories.
     */
    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: {
                type: 'object',
                required: ['title'],
                properties: {
                    title: { type: 'string' },
                    tStatus: { type: 'string' },
                },
            },
        },
    })
    translations?: Record<string, CategoryTranslationEntry>;

    /**
     * Revision history, sorted ascending by revision_no.
     * Included in GET /:id. Read-only — ignored by PUT.
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

    constructor(data?: Partial<CategoryFull>) {
        super(data);
    }
}