/**
 * src/models/migrant-document.model.ts
 *
 * Personal document uploaded by a migrant to their Document Wallet.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  NOT part of the CRT content model — no revision/translation cycle.
 *  The document binary is stored as BYTEA in the DB.
 *  file_data is base64-encoded in the JSON API layer.
 *
 *  document_type_id is the legacy numeric externalKey of a DOCUMENT_TYPE
 *  content_item — nullable because a migrant may upload a document before
 *  the PA has published any document types.
 *
 *  shareable controls PA visibility — true = PA workers can see the document
 *  in the migrant's profile; false = private to the migrant only.
 *
 * ── Table ────────────────────────────────────────────────────────────────────
 *
 *  micado.migrant_document
 *    id               UUID PK
 *    migrant_id       UUID  FK → migrant_profile.keycloak_id ON DELETE CASCADE
 *    document_type_id INTEGER nullable  — content_item.external_key
 *    file_name        VARCHAR(500)
 *    mime_type        VARCHAR(100)
 *    file_data        BYTEA NOT NULL
 *    shareable        BOOLEAN NOT NULL DEFAULT FALSE
 *    created_at       TIMESTAMPTZ
 *    updated_at       TIMESTAMPTZ
 */

import { Entity, model, property, belongsTo } from '@loopback/repository';
import { MigrantProfile } from './migrant-profile.model';

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'migrant_document' },
    },
})
export class MigrantDocument extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid', nullable: 'NO' },
    })
    id?: string;

    /**
     * Keycloak UUID of the owning migrant.
     * Matches migrant_profile.keycloak_id.
     */
    @belongsTo(
        () => MigrantProfile,
        { name: 'migrantProfile', keyFrom: 'migrantId', keyTo: 'keycloakId' },
        { postgresql: { columnName: 'migrant_id', dataType: 'uuid', nullable: 'NO' } },
    )
    migrantId: string;

    /**
     * Optional reference to a DOCUMENT_TYPE content_item by its externalKey
     * (legacy numeric id).  Nullable — the migrant may upload without selecting
     * a type.
     */
    @property({
        type: 'number',
        postgresql: { columnName: 'document_type_id', dataType: 'integer' },
    })
    documentTypeId?: number;

    /** Original file name as provided by the browser, e.g. "identity_card.jpg". */
    @property({
        type: 'string',
        default: '',
        postgresql: { columnName: 'file_name', dataType: 'varchar', dataLength: 500 },
    })
    fileName: string;

    /** MIME type, e.g. "image/jpeg", "application/pdf". */
    @property({
        type: 'string',
        default: 'application/octet-stream',
        postgresql: { columnName: 'mime_type', dataType: 'varchar', dataLength: 100 },
    })
    mimeType: string;

    /**
     * Binary document content stored as BYTEA in PostgreSQL.
     * Mapped to Buffer by the LoopBack connector; served as base64 over HTTP.
     * The API layer converts Buffer ↔ base64 string transparently.
     */
    @property({
        type: 'buffer',
        required: true,
        postgresql: { columnName: 'file_data', dataType: 'bytea', nullable: 'NO' },
    })
    fileData: Buffer;

    /**
     * When true, PA social assistants can view this document in the migrant
     * profile.  When false (default) the document is private.
     */
    @property({
        type: 'boolean',
        required: true,
        default: false,
        postgresql: { columnName: 'shareable', dataType: 'boolean', nullable: 'NO' },
    })
    shareable: boolean;

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

    constructor(data?: Partial<MigrantDocument>) {
        super(data);
    }
}

export interface MigrantDocumentRelations {
    migrantProfile?: MigrantProfile;
}

export type MigrantDocumentWithRelations = MigrantDocument & MigrantDocumentRelations;
