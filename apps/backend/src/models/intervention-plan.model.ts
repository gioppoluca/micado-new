/**
 * src/models/intervention-plan.model.ts
 *
 * Header row for an Individual Integration Plan.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  These are operational records — NOT part of the CRT content model.
 *  No revision/translation cycle applies.
 *  Plans are created by PA operators at the desk in the contact language
 *  (Italian, English, …) — there is no time for translation at the desk.
 *
 * ── Table ────────────────────────────────────────────────────────────────────
 *
 *  micado.intervention_plan
 *    id            UUID PK
 *    migrant_id    UUID  FK → migrant_profile.keycloak_id  ON DELETE CASCADE
 *    title         VARCHAR(200)
 *    case_manager  VARCHAR(100)
 *    start_date    DATE
 *    end_date      DATE
 *    completed     BOOLEAN NOT NULL DEFAULT FALSE
 *    notes         TEXT
 *    created_by    JSONB  — ActorStamp
 *    created_at    TIMESTAMPTZ
 *    updated_at    TIMESTAMPTZ
 */

import { belongsTo, Entity, hasMany, model, property } from '@loopback/repository';
import type { ActorStamp } from '../auth/actor-stamp';
import { MigrantProfile } from './migrant-profile.model';
import { InterventionPlanItem } from './intervention-plan-item.model';

/** Shared ActorStamp JSON schema — reused across models in this file. */
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
        postgresql: { schema: 'micado', table: 'intervention_plan' },
    },
})
export class InterventionPlan extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid', nullable: 'NO' },
    })
    id?: string;

    @belongsTo(
        () => MigrantProfile,
        { name: 'migrantProfile', keyFrom: 'migrantId', keyTo: 'keycloakId' },
        {
            required: true,
            postgresql: { columnName: 'migrant_id', dataType: 'uuid', nullable: 'NO' },
        },
    )
    migrantId: string;

    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'title', dataType: 'varchar', dataLength: 200, nullable: 'YES' },
    })
    title?: string;

    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'case_manager', dataType: 'varchar', dataLength: 100, nullable: 'YES' },
    })
    caseManager?: string;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'start_date', dataType: 'date', nullable: 'YES' },
    })
    startDate?: string;

    @property({
        type: 'date',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'end_date', dataType: 'date', nullable: 'YES' },
    })
    endDate?: string;

    @property({
        type: 'boolean',
        required: true,
        default: false,
        postgresql: { columnName: 'completed', dataType: 'boolean', nullable: 'NO' },
    })
    completed: boolean;

    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'notes', dataType: 'text', nullable: 'YES' },
    })
    notes?: string;

    /**
     * ActorStamp of the PA operator who created the plan.
     * Shape: { sub, username, name, realm }.
     * Built via buildActorStamp() from src/auth/actor-stamp.ts.
     */
    @property({
        type: 'object',
        jsonSchema: { ...actorStampSchema, nullable: true },
        postgresql: { columnName: 'created_by', dataType: 'jsonb', nullable: 'YES' },
    })
    createdBy?: ActorStamp;

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

    @hasMany(() => InterventionPlanItem, { keyTo: 'planId' })
    items?: InterventionPlanItem[];

    constructor(data?: Partial<InterventionPlan>) {
        super(data);
    }
}

export interface InterventionPlanRelations {
    migrantProfile?: MigrantProfile;
    items?: InterventionPlanItem[];
}

export type InterventionPlanWithRelations = InterventionPlan & InterventionPlanRelations;