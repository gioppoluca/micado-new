/**
 * src/models/migrant-profile.model.ts
 *
 * Anchor row for a migrant user in the micado schema.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  The migrant's identity (name, email, enabled) lives entirely in Keycloak.
 *  This row exists only to:
 *   1. Provide a stable UUID primary key for relational FKs (plans, documents).
 *   2. Store PA-internal operational data that has no place in Keycloak
 *      (e.g. internal notes, tenant assignment).
 *
 *  The row is created lazily on the first PA action (upsert in the service).
 *  It MUST NOT duplicate PII already managed by Keycloak.
 *
 * ── Table ────────────────────────────────────────────────────────────────────
 *
 *  micado.migrant_profile
 *    keycloak_id  UUID  PK  — Keycloak user UUID (migrants realm)
 *    realm        VARCHAR
 *    notes        TEXT       — PA internal notes, never shown to migrant
 *    created_at   TIMESTAMPTZ
 *    updated_at   TIMESTAMPTZ
 */

import { Entity, hasMany, model, property } from '@loopback/repository';
import  { InterventionPlan } from './intervention-plan.model';

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'migrant_profile' },
    },
})
export class MigrantProfile extends Entity {
    /** Primary key — equals the Keycloak user UUID in the migrants realm. */
    @property({
        type: 'string',
        id: true,
        generated: false,
        required: true,
        postgresql: { columnName: 'keycloak_id', dataType: 'uuid', nullable: 'NO' },
    })
    keycloakId: string;

    @property({
        type: 'string',
        required: true,
        default: 'migrants',
        postgresql: {
            columnName: 'realm',
            dataType: 'varchar',
            dataLength: 100,
            nullable: 'NO',
        },
    })
    realm: string;

    /** PA-internal notes — never exposed to the migrant. */
    @property({
        type: 'string',
        jsonSchema: { nullable: true },
        postgresql: { columnName: 'notes', dataType: 'text', nullable: 'YES' },
    })
    notes?: string;

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

    @hasMany(() => InterventionPlan, { keyTo: 'migrantId' })
    interventionPlans?: InterventionPlan[];

    constructor(data?: Partial<MigrantProfile>) {
        super(data);
    }
}

export interface MigrantProfileRelations {
    interventionPlans?: InterventionPlan[];
}

export type MigrantProfileWithRelations = MigrantProfile & MigrantProfileRelations;