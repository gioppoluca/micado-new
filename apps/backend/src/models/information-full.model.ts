import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/information-full.model.ts
 *
 * Rich DTO for the PA form: GET /information/:id and PUT /information/:id.
 *
 * ── Key difference from EventFull ────────────────────────────────────────────
 *
 *  No dataExtra field — Information items have no non-translatable metadata.
 *  All content is either in translations (title, description) or in relations
 *  (category, topics, user types).
 *
 * ── DB layout ────────────────────────────────────────────────────────────────
 *
 *  content_item [INFORMATION]
 *    content_revision
 *      data_extra: {}   (always empty, stored for CRT schema conformance)
 *      content_revision_translation (per lang)
 *        title       → item title
 *        description → Markdown rich text
 *
 *  content_item_relation (relationType='category')
 *    parent_item_id → CATEGORY[information] content_item
 *
 *  content_item_relation (relationType='topic')
 *    parent_item_id → TOPIC content_item
 *
 *  content_item_relation (relationType='user_type')
 *    parent_item_id → USER_TYPE content_item
 */

@model()
export class InformationTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<InformationTranslationEntry>) {
        super(data);
    }
}

@model({ description: 'Full Information DTO with all per-language translations and relations' })
export class InformationFull extends Model {
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** Null = uncategorised. On PUT: replaces the existing category relation. */
    @property({ type: 'number' })
    categoryId?: number | null;

    /** On PUT: replaces all existing topic relations. */
    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    /** On PUT: replaces all existing user-type relations. */
    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    /**
     * All per-language translations.
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
    translations?: Record<string, InformationTranslationEntry>;

    /** Read-only revision history. Ignored on PUT. */
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

    constructor(data?: Partial<InformationFull>) {
        super(data);
    }
}