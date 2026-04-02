import { Model, model, property } from '@loopback/repository';

/**
 * src/models/revision-summary.model.ts
 *
 * Lightweight revision summary shared by all Full DTOs
 * (UserTypeFull, DocumentTypeFull, TopicFull, …).
 *
 * Included in GET /:id responses — no extra API call needed.
 * Read-only on PUT (ignored by the backend if sent back).
 *
 * UI use: version history panel below the editor tabs.
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
     * Derived from createdBy.name — the JSONB is unpacked in the facade
     * so the frontend never has to drill into a nested object.
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