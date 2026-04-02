import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/topic-full.model.ts
 *
 * Rich DTO for the PA form: GET /topics/:id and PUT /topics/:id.
 *
 * ── Data layout in the DB ────────────────────────────────────────────────────
 *
 *  content_item [TOPIC]
 *    content_revision
 *      data_extra          → { icon: string }
 *      content_revision_translation (per lang)
 *        title             → topic name
 *        description       → topic description
 *        i18n_extra: {}    → (no extra translatable fields for TOPIC)
 *
 *  content_item_relation  relation_type='parent'
 *    parent_item_id        → parent TOPIC content_item UUID
 *    child_item_id         → this TOPIC content_item UUID
 *    sort_order            → 0 (ordering within siblings not used for topics)
 *    relation_extra: {}
 *
 * ── Parent selection constraint ───────────────────────────────────────────────
 *
 *  The `topic.max_depth` setting (stored in app_settings, 0-based integer)
 *  controls which nodes are selectable as a parent in the tree picker.
 *  A topic at depth = max_depth cannot be selected as a parent
 *  (it would make a child at depth max_depth+1, which exceeds the limit).
 *  Nodes beyond the limit are shown in the tree but rendered as disabled.
 */

// ─── Per-language translation entry ───────────────────────────────────────────

@model()
export class TopicTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    description?: string;

    /**
     * Read-only translation workflow state for this language.
     * Ignored on PUT — backend always resets to DRAFT on write.
     * Present on GET for per-tab status badges.
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<TopicTranslationEntry>) {
        super(data);
    }
}

// ─── Full DTO ──────────────────────────────────────────────────────────────────

@model({
    description: 'Full Topic DTO including all per-language translations — used by PA form',
})
export class TopicFull extends Model {
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
     * Non-translatable metadata.
     * Shape: { icon: string }
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    /**
     * Numeric external_key of the parent topic, or null for root topics.
     * On PUT: if provided, creates/updates the content_item_relation.
     * If null or absent, the parent relation is removed (topic becomes root).
     */
    @property({ type: 'number' })
    parentId?: number | null;

    /**
     * 0-based depth in the hierarchy. Read-only on PUT.
     * Derived at read time by walking the parent chain.
     */
    @property({ type: 'number' })
    depth?: number;

    /**
     * All per-language translation rows for the current preferred revision.
     * Keyed by lang code (e.g. "it", "en", "ar").
     *
     * On GET: populated with every existing content_revision_translation row.
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
    translations?: Record<string, TopicTranslationEntry>;

    /**
     * All revisions of this content item, sorted ascending by revision_no.
     * Included in GET /topics/:id — no extra API call needed.
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

    constructor(data?: Partial<TopicFull>) {
        super(data);
    }
}