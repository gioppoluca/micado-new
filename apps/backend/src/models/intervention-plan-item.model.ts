/**
 * src/models/intervention-plan-item.model.ts
 *
 * A single action / task within an Individual Integration Plan.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  intervention_type_id is an optional FK to content_item (type = INTERVENTION_TYPE).
 *  - Present  → item is catalogue-driven; the translated title comes from CRT.
 *  - Absent   → item is ad-hoc; the PA wrote a custom title/description.
 *
 *  The NGO validation workflow is captured by three fields:
 *   1. validation_requested_at  — PA marks item ready for NGO sign-off.
 *   2. validated_by             — ActorStamp of the NGO user who approved.
 *   3. validated_at             — Timestamp of approval.
 *
 * ── Table ────────────────────────────────────────────────────────────────────
 *
 *  micado.intervention_plan_item
 *    id                      UUID PK
 *    plan_id                 UUID  FK → intervention_plan.id  ON DELETE CASCADE
 *    intervention_type_id    UUID? FK → content_item.id       ON DELETE SET NULL
 *    title                   VARCHAR(200)
 *    description             TEXT
 *    assigned_date           DATE
 *    due_date                DATE
 *    completed               BOOLEAN NOT NULL DEFAULT FALSE
 *    completed_date          DATE
 *    validation_requested_at TIMESTAMPTZ
 *    validated_by            JSONB  — ActorStamp
 *    validated_at            TIMESTAMPTZ
 *    sort_order              INTEGER NOT NULL DEFAULT 0
 *    created_at              TIMESTAMPTZ
 *    updated_at              TIMESTAMPTZ
 */

import { belongsTo, Entity, model, property } from '@loopback/repository';
import type { ActorStamp } from '../auth/actor-stamp';
import { InterventionPlan } from './intervention-plan.model';

const actorStampSchema = {
    type: 'object' as const,
    properties: {
        sub: { type: 'string' as const },
        username: { type: 'string' as const },
        name: { type: 'string' as const },
        realm: { type: 'string' as const },
    },
    additionalProperties: false,
};

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'intervention_plan_item' },
    },
})
export class InterventionPlanItem extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid', nullable: 'NO' },
    })
    id?: string;

    @belongsTo(
        () => InterventionPlan,
        { name: 'plan', keyFrom: 'planId', keyTo: 'id' },
        {
            required: true,
            postgresql: { columnName: 'plan_id', dataType: 'uuid', nullable: 'NO' },
        },
    )
    planId: string;

    /**
     * Optional FK to content_item (type = INTERVENTION_TYPE).
     * When set, the display title should come from the CRT translation for
     * the user's preferred language. When null, use the local `title` field.
     */
    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: {
            columnName: 'intervention_type_id',
            dataType: 'uuid',
            nullable: 'YES',
        },
    })
    interventionTypeId?: string;

    /** Free-text title — mandatory for ad-hoc items, optional for catalogue items. */
    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'title', dataType: 'varchar', dataLength: 200, nullable: 'YES' },
    })
    title?: string;

    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'description', dataType: 'text', nullable: 'YES' },
    })
    description?: string;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'assigned_date', dataType: 'date', nullable: 'YES' },
    })
    assignedDate?: string;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'due_date', dataType: 'date', nullable: 'YES' },
    })
    dueDate?: string;

    @property({
        type: 'boolean',
        required: true,
        default: false,
        postgresql: { columnName: 'completed', dataType: 'boolean', nullable: 'NO' },
    })
    completed: boolean;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'completed_date', dataType: 'date', nullable: 'YES' },
    })
    completedDate?: string;

    /**
     * Set by the PA when the item is ready for NGO validation.
     * Null = not yet submitted. Idempotent — only set if currently null.
     */
    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: {
            columnName: 'validation_requested_at',
            dataType: 'timestamptz',
            nullable: 'YES',
        },
    })
    validationRequestedAt?: string;

    /** ActorStamp of the NGO user who validated the item. */
    @property({
        type: 'object',
        jsonSchema: { ...actorStampSchema, nullable: true },
        postgresql: { columnName: 'validated_by', dataType: 'jsonb', nullable: 'YES' },
    })
    validatedBy?: ActorStamp;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'validated_at', dataType: 'timestamptz', nullable: 'YES' },
    })
    validatedAt?: string;

    @property({
        type: 'number',
        required: true,
        default: 0,
        postgresql: { columnName: 'sort_order', dataType: 'integer', nullable: 'NO' },
    })
    sortOrder: number;

    @property({
        type: 'date',
        postgresql: { columnName: 'created_at', dataType: 'timestamptz', nullable: 'NO' },
    })
    createdAt?: string;

    @property({
        type: 'date',
        postgresql: { columnName: 'updated_at', dataType: 'timestamptz', nullable: 'NO' },
    })
    updatedAt?: string;

    constructor(data?: Partial<InterventionPlanItem>) {
        super(data);
    }
}

export interface InterventionPlanItemRelations {
    plan?: InterventionPlan;
}

export type InterventionPlanItemWithRelations =
    InterventionPlanItem & InterventionPlanItemRelations;