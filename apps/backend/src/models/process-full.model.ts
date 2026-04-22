import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/process-full.model.ts
 *
 * Rich DTO for the PA process form.
 * Used by: GET /processes/:id (form open), PUT /processes/:id (form save).
 *
 * The graph (steps + step-links) is managed separately via
 * GET/PUT /processes/:id/graph and is NOT included here.
 *
 * ── DB layout ────────────────────────────────────────────────────────────────
 *
 *  content_item [PROCESS]
 *    content_revision
 *      data_extra: {}   (empty — all structure is in relations)
 *      content_revision_translation (per lang)
 *        title       → process name
 *        description → process description (Markdown)
 *
 *  content_item_relation (relationType='topic')
 *    parent_item_id → TOPIC content_item
 *    child_item_id  → this PROCESS content_item
 *
 *  content_item_relation (relationType='user_type')
 *    parent_item_id → USER_TYPE content_item
 *    child_item_id  → this PROCESS content_item
 *
 *  content_item_relation (relationType='document_type')
 *    parent_item_id → DOCUMENT_TYPE content_item
 *    child_item_id  → this PROCESS content_item
 *    (documents produced by completing this process)
 */

/** Per-language translation for a process. */
@model()
export class ProcessTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    /** Process description — Markdown, supports @mentions. */
    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<ProcessTranslationEntry>) {
        super(data);
    }
}

@model({ description: 'Full Process DTO with all per-language translations and relations' })
export class ProcessFull extends Model {
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** Topic IDs — On PUT: replaces all existing topic relations. */
    @property({ type: 'array', itemType: 'number' })
    topicIds?: number[];

    /** User type IDs — On PUT: replaces all existing user_type relations. */
    @property({ type: 'array', itemType: 'number' })
    userTypeIds?: number[];

    /** Document type IDs produced by this process — On PUT: replaces existing. */
    @property({ type: 'array', itemType: 'number' })
    producedDocTypeIds?: number[];

    /**
     * Per-language translations (title + description).
     * On GET: every existing content_revision_translation row.
     * On PUT: present entries upserted; absent keys untouched.
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
    translations?: Record<string, ProcessTranslationEntry>;

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

    /**
     * NGO comments for this process, grouped by organisation.
     * Populated by GET /processes/:id — PA roles only.
     * Each entry is one group's comment for the current published revision.
     * Empty array when there are no comments.
     */
    @property({
        type: 'array',
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'ngoGroupId', 'body', 'published'],
                properties: {
                    id:           { type: 'string' },
                    ngoGroupId:   { type: 'string' },
                    ngoGroupName: { type: 'string' },
                    body:         { type: 'string' },
                    published:    { type: 'boolean' },
                    createdAt:    { type: 'string' },
                    createdBy: {
                        type: 'object',
                        properties: {
                            name:     { type: 'string' },
                            username: { type: 'string' },
                        },
                    },
                },
            },
        },
    })
    ngoComments?: NgoCommentOnProcess[];

    constructor(data?: Partial<ProcessFull>) {
        super(data);
    }
}

/** One NGO comment as embedded in the process detail DTO. */
export interface NgoCommentOnProcess {
    id: string;
    ngoGroupId: string;
    /** Display name resolved from Keycloak — may be undefined for legacy rows. */
    ngoGroupName?: string;
    body: string;
    published: boolean;
    createdBy?: { name?: string; username?: string };
    createdAt?: string;
}