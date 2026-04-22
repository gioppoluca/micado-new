/**
 * src/models/ngo-process-comment.model.ts
 *
 * Operational record — NOT part of the CRT content model.
 * No revision/translation cycle applies.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  Each row is a free-text comment written by an NGO group on a specific
 *  PUBLISHED revision of a process.  Linking to the revision (not the item)
 *  is intentional: when process v2 is published, v1 comments silently stop
 *  appearing because they no longer match the current published_revision_id.
 *  No explicit expiry or deletion logic is needed.
 *
 *  Group scoping: ngoGroupId (Keycloak group UUID) restricts visibility so
 *  each NGO only sees comments written by its own group.
 *
 * ── Table ────────────────────────────────────────────────────────────────────
 *
 *  micado.ngo_process_comment
 *    id            UUID PK
 *    revision_id   UUID FK → content_revision.id  ON DELETE CASCADE
 *    ngo_group_id  VARCHAR(100)
 *    body          TEXT
 *    published     BOOLEAN NOT NULL DEFAULT FALSE
 *    created_by    JSONB  — ActorStamp
 *    created_at    TIMESTAMPTZ
 *    updated_at    TIMESTAMPTZ
 */

import { Entity, model, property } from '@loopback/repository';
import type { ActorStamp } from '../auth/actor-stamp';

const actorStampSchema = {
    type: 'object' as const,
    properties: {
        sub:      { type: 'string' as const },
        username: { type: 'string' as const },
        name:     { type: 'string' as const },
        realm:    { type: 'string' as const },
    },
    additionalProperties: false,
};

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'ngo_process_comment' },
    },
})
export class NgoProcessComment extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid', nullable: 'NO' },
    })
    id?: string;

    /**
     * FK to the content_revision that was PUBLISHED at the time of writing.
     * When a newer revision is published the comment is implicitly historical
     * (the page will no longer show it) — no explicit expiry needed.
     */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'revision_id', dataType: 'uuid', nullable: 'NO' },
    })
    revisionId: string;

    /**
     * Keycloak group UUID for the NGO organisation that wrote this comment.
     * Resolved at write-time from the JWT groups claim or ngoGroupId attribute.
     * Used to restrict reads: an ngo_admin only sees comments from their group.
     */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'ngo_group_id', dataType: 'varchar', dataLength: 100, nullable: 'NO' },
    })
    ngoGroupId: string;

    /** The comment text. Freeform, not translated. */
    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'body', dataType: 'text', nullable: 'NO' },
    })
    body: string;

    /**
     * Simple publish flag.
     * FALSE (default) — saved, visible only in the NGO backoffice.
     * TRUE  — visible to migrants on the process detail page.
     */
    @property({
        type: 'boolean',
        required: true,
        default: false,
        postgresql: { columnName: 'published', dataType: 'boolean', nullable: 'NO' },
    })
    published: boolean;

    /** Actor who created this comment — stored as embedded JSONB. */
    @property({
        type: 'object',
        jsonSchema: actorStampSchema,
        postgresql: { columnName: 'created_by', dataType: 'jsonb' },
    })
    createdBy?: ActorStamp;

    @property({
        type: 'date',
        postgresql: { columnName: 'created_at', dataType: 'timestamptz' },
    })
    createdAt?: string;

    @property({
        type: 'date',
        postgresql: { columnName: 'updated_at', dataType: 'timestamptz' },
    })
    updatedAt?: string;

    constructor(data?: Partial<NgoProcessComment>) {
        super(data);
    }
}

export interface NgoProcessCommentRelations { }
export type NgoProcessCommentWithRelations = NgoProcessComment & NgoProcessCommentRelations;
