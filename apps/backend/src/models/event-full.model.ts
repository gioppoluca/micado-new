import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/event-full.model.ts
 *
 * Rich DTO for the PA form: GET /events/:id and PUT /events/:id.
 *
 * ── Data layout in the DB ────────────────────────────────────────────────────
 *
 *  content_item [EVENT]
 *    content_revision
 *      data_extra: {
 *        startDate: string,     ISO 8601
 *        endDate:   string,     ISO 8601
 *        location:  string,
 *        cost:      string | null,
 *        isFree:    boolean,
 *      }
 *      content_revision_translation (per lang)
 *        title       → event title
 *        description → event description (Markdown via tiptap-markdown)
 *        i18n_extra: {}
 *
 *  content_item_relation (relationType='category')
 *    parent_item_id → CATEGORY[event] content_item
 *    child_item_id  → this EVENT content_item
 *
 *  content_item_relation (relationType='topic', one per topic)
 *    parent_item_id → TOPIC content_item
 *    child_item_id  → this EVENT content_item
 *
 *  content_item_relation (relationType='user_type', one per user type)
 *    parent_item_id → USER_TYPE content_item
 *    child_item_id  → this EVENT content_item
 *
 * ── Relations strategy ───────────────────────────────────────────────────────
 *
 *  All relations use content_item_relation (not join tables). The facade
 *  performs a delete-all + re-insert on PUT to keep relation management simple.
 *  This is acceptable because events have at most one category, ~3 topics and
 *  ~3 user types — never large sets.
 */

/** Per-language translation entry. */
@model()
export class EventTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    /** Markdown rich text. Empty string when not yet translated. */
    @property({ type: 'string' })
    description?: string;

    /** Read-only. Ignored on PUT. */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<EventTranslationEntry>) {
        super(data);
    }
}

/** Non-translatable event metadata stored in data_extra. */
@model()
export class EventDataExtra extends Model {
    @property({ type: 'string' })
    startDate?: string;

    @property({ type: 'string' })
    endDate?: string;

    @property({ type: 'string' })
    location?: string;

    @property({ type: 'string' })
    cost?: string | null;

    @property({ type: 'boolean' })
    isFree?: boolean;

    constructor(data?: Partial<EventDataExtra>) {
        super(data);
    }
}

@model({ description: 'Full Event DTO with all per-language translations and relations' })
export class EventFull extends Model {
    /** Legacy numeric id (maps to content_item.external_key). */
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** Non-translatable metadata. On PUT: merged with existing data_extra. */
    @property({ type: 'object' })
    dataExtra?: EventDataExtra;

    /**
     * ID of the linked CATEGORY (event subtype). Null = uncategorised.
     * On PUT: replaces the existing category relation.
     */
    @property({ type: 'number' })
    categoryId?: number | null;

    /**
     * IDs of linked TOPICs.
     * On PUT: replaces all existing topic relations.
     */
    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    /**
     * IDs of linked USER_TYPEs.
     * On PUT: replaces all existing user-type relations.
     */
    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    /**
     * All per-language translation rows.
     * On GET: every existing content_revision_translation row.
     * On PUT: present entries are upserted; absent keys are left untouched.
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
    translations?: Record<string, EventTranslationEntry>;

    /**
     * Revision history sorted ascending by revision_no.
     * Read-only — ignored on PUT.
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

    constructor(data?: Partial<EventFull>) {
        super(data);
    }
}