import { Model, model, property } from '@loopback/repository';
import { RevisionSummary } from './revision-summary.model';
export { RevisionSummary } from './revision-summary.model';

/**
 * src/models/step-link-full.model.ts
 *
 * Models for STEP_LINK content items — directed edges between steps.
 *
 * ── Both DTOs defined here ───────────────────────────────────────────────────
 *
 *   StepLinkLegacy  — flat DTO (edge data for VueFlow)
 *   StepLinkFull    — rich DTO with all translations
 *
 * Like StepFull, these are INTERNAL to the /processes/:id/graph endpoint.
 *
 * ── DB layout (STEP_LINK content item) ──────────────────────────────────────
 *
 *  content_item [STEP_LINK]
 *    content_revision
 *      data_extra: {
 *        processId: number,       ← externalKey of parent PROCESS
 *        sourceStepId: number,    ← externalKey of source STEP (VueFlow source)
 *        targetStepId: number,    ← externalKey of target STEP (VueFlow target)
 *      }
 *      content_revision_translation (per lang)
 *        title       → edge label (displayed on the VueFlow edge)
 *        description → "" (not used)
 *
 * ── VueFlow mapping ───────────────────────────────────────────────────────────
 *
 *   StepLink → VueFlow Edge:
 *     id:     String(stepLink.id)
 *     source: String(stepLink.sourceStepId)
 *     target: String(stepLink.targetStepId)
 *     label:  stepLink.label           (from sourceLang translation)
 *     type:  'step-link'
 *     data:  { translations, status }
 *
 * ── ID strategy ───────────────────────────────────────────────────────────────
 *
 *   VueFlow uses string IDs for both nodes and edges.
 *   New edges created in the frontend get a temporary UUID string ID,
 *   which is replaced by the DB-assigned externalKey after the first
 *   PUT /processes/:id/graph call. The frontend receives the persisted
 *   graph back (with stable numeric IDs) after save.
 */

// ── Plain interface for data_extra ────────────────────────────────────────────

/** Plain interface for STEP_LINK data_extra — safe as Record<string,unknown>. */
export interface StepLinkDataExtra {
    processId: number;
    sourceStepId: number;
    targetStepId: number;
}

// ── StepLinkLegacy ────────────────────────────────────────────────────────────

@model({ description: 'Flat StepLink DTO — internal use by graph endpoint' })
export class StepLinkLegacy extends Model {
    @property({ type: 'number' })
    id?: number;

    /** Edge label in the source language. */
    @property({ type: 'string' })
    label?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    @property({ type: 'number' })
    processId?: number;

    /** externalKey of the source STEP — VueFlow edge source. */
    @property({ type: 'number' })
    sourceStepId?: number;

    /** externalKey of the target STEP — VueFlow edge target. */
    @property({ type: 'number' })
    targetStepId?: number;

    constructor(data?: Partial<StepLinkLegacy>) {
        super(data);
    }
}

// ── StepLinkTranslationEntry ──────────────────────────────────────────────────

@model()
export class StepLinkTranslationEntry extends Model {
    /** Edge label in this language. */
    @property({ type: 'string', required: true })
    title: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<StepLinkTranslationEntry>) {
        super(data);
    }
}

// ── StepLinkFull ──────────────────────────────────────────────────────────────

@model({ description: 'Full StepLink DTO with all per-language translations' })
export class StepLinkFull extends Model {
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    @property({ type: 'number' })
    processId?: number;

    @property({ type: 'number' })
    sourceStepId?: number;

    @property({ type: 'number' })
    targetStepId?: number;

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
    translations?: Record<string, StepLinkTranslationEntry>;

    @property({ type: 'array', itemType: RevisionSummary })
    revisions?: RevisionSummary[];

    constructor(data?: Partial<StepLinkFull>) {
        super(data);
    }
}