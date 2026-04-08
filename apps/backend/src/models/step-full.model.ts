import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/step-full.model.ts
 *
 * ── Both DTOs defined here ───────────────────────────────────────────────────
 *
 *   StepLegacy  — flat DTO returned by list/create (sourceLang only)
 *   StepFull    — rich DTO for form (all translations + full data_extra)
 *
 * These models are INTERNAL to /processes/:id/graph — they are not exposed
 * as top-level REST resources. The graph endpoint returns VueFlow-compatible
 * objects; these models are used only for the DB ↔ facade mapping layer.
 *
 * ── DB layout (STEP content item) ───────────────────────────────────────────
 *
 *  content_item [STEP]
 *    content_revision
 *      data_extra: {
 *        processId: number,             ← externalKey of parent PROCESS
 *        posX: number,                  ← VueFlow node x (saved on "Save Graph")
 *        posY: number,                  ← VueFlow node y
 *        location: string,
 *        cost: string,
 *        isFree: boolean,
 *        url: string,                   ← external link (legacy "link" field)
 *        iconUrl: string,               ← selected step icon URL
 *        requiredDocuments: Array<{     ← embedded: no join needed
 *          documentTypeId: number,
 *          cost: string,
 *          isOut: boolean,
 *        }>,
 *      }
 *      content_revision_translation (per lang)
 *        title       → step name
 *        description → step description (Markdown, @mentions supported)
 *
 * ── Why requiredDocuments is embedded ────────────────────────────────────────
 *
 *  Each required document has a step-specific cost (distinct from the
 *  document type's own cost). content_item_relation.relationExtra could
 *  hold this, but embedding is simpler and avoids N+1 queries on graph load.
 *
 * ── Position strategy ────────────────────────────────────────────────────────
 *
 *  posX/posY are saved when the user clicks "Save Graph", preserving the
 *  layout the PA operator has arranged. On first creation, they default to
 *  an auto-layout value assigned by the frontend (VueFlow auto-layout or
 *  a simple grid assignment).
 */

// ── Plain interface for data_extra (not a @model class) ───────────────────────

export interface RequiredDocument {
    documentTypeId: number;
    cost: string;
    isOut: boolean;
}

/** Plain interface for STEP data_extra — safe to use as Record<string,unknown>. */
export interface StepDataExtra {
    processId: number;
    posX: number;
    posY: number;
    location: string;
    cost: string;
    isFree: boolean;
    url: string;
    iconUrl: string;
    requiredDocuments: RequiredDocument[];
}

// ── StepLegacy (flat DTO for list) ────────────────────────────────────────────

@model({ description: 'Flat Step DTO — internal use by graph endpoint' })
export class StepLegacy extends Model {
    @property({ type: 'number' })
    id?: number;

    @property({ type: 'string' })
    title?: string;

    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** processId from data_extra — the parent process. */
    @property({ type: 'number' })
    processId?: number;

    @property({ type: 'number' })
    posX?: number;

    @property({ type: 'number' })
    posY?: number;

    @property({ type: 'string' })
    location?: string;

    @property({ type: 'string' })
    cost?: string;

    @property({ type: 'boolean' })
    isFree?: boolean;

    @property({ type: 'string' })
    url?: string;

    @property({ type: 'string' })
    iconUrl?: string;

    @property({
        type: 'array',
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    documentTypeId: { type: 'number' },
                    cost: { type: 'string' },
                    isOut: { type: 'boolean' },
                },
            },
        },
    })
    requiredDocuments?: RequiredDocument[];

    constructor(data?: Partial<StepLegacy>) {
        super(data);
    }
}

// ── StepTranslationEntry ──────────────────────────────────────────────────────

@model()
export class StepTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<StepTranslationEntry>) {
        super(data);
    }
}

// ── StepFull (rich DTO for form) ──────────────────────────────────────────────

@model({ description: 'Full Step DTO with all per-language translations' })
export class StepFull extends Model {
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /** Stored in data_extra — parent process ID. */
    @property({ type: 'number' })
    processId?: number;

    @property({ type: 'number' })
    posX?: number;

    @property({ type: 'number' })
    posY?: number;

    @property({ type: 'string' })
    location?: string;

    @property({ type: 'string' })
    cost?: string;

    @property({ type: 'boolean' })
    isFree?: boolean;

    @property({ type: 'string' })
    url?: string;

    @property({ type: 'string' })
    iconUrl?: string;

    @property({
        type: 'array',
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    documentTypeId: { type: 'number' },
                    cost: { type: 'string' },
                    isOut: { type: 'boolean' },
                },
            },
        },
    })
    requiredDocuments?: RequiredDocument[];

    /**
     * All per-language translations.
     * On PUT (via graph save): all translations upserted atomically.
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
    translations?: Record<string, StepTranslationEntry>;

    /** Read-only. Not included in graph save payload. */
    @property({
        type: 'array',
        itemType: RevisionSummary,
    })
    revisions?: RevisionSummary[];

    constructor(data?: Partial<StepFull>) {
        super(data);
    }
}