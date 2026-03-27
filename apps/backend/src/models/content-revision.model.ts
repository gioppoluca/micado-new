import {
    belongsTo,
    Entity,
    hasMany,
    model,
    property,
} from '@loopback/repository';
import { ContentItem } from './content-item.model';
import { ContentRevisionTranslation } from './content-revision-translation.model';
import type { ActorStamp } from '../auth/actor-stamp';

/** Reusable jsonb property descriptor for actor stamp columns. */
const actorStampProperty = {
    type: 'object' as const,
    jsonSchema: {
        type: 'object' as const,
        properties: {
            sub: { type: 'string' as const },
            username: { type: 'string' as const },
            name: { type: 'string' as const },
            realm: { type: 'string' as const },
        },
        additionalProperties: false,
    },
};

@model({
    settings: {
        postgresql: { table: 'content_revision' },
    },
})
export class ContentRevision extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid' },
    })
    id?: string;

    @belongsTo(() => ContentItem, {
        name: 'item',
        keyFrom: 'itemId',
        keyTo: 'id',
    }, {
        postgresql: { columnName: 'item_id', dataType: 'uuid' },
    })
    itemId: string;

    @property({
        type: 'number',
        required: true,
        postgresql: { columnName: 'revision_no', dataType: 'integer' },
    })
    revisionNo: number;

    @property({
        type: 'string',
        required: true,
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
        postgresql: { columnName: 'status', dataType: 'varchar' },
    })
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'source_lang', dataType: 'varchar', dataLength: 16 },
    })
    sourceLang: string;

    @property({
        type: 'object',
        required: true,
        jsonSchema: { type: 'object', additionalProperties: true },
        postgresql: { columnName: 'data_extra', dataType: 'jsonb' },
    })
    dataExtra: Record<string, unknown>;

    @property({
        type: 'date',
        postgresql: { columnName: 'created_at', dataType: 'timestamptz' },
    })
    createdAt?: string;

    /**
     * Actor who created this revision.
     * Shape: { sub, username, name, realm } — stored as JSONB.
     * Build with buildActorStamp() from src/auth/actor-stamp.ts.
     */
    @property({
        ...actorStampProperty,
        postgresql: { columnName: 'created_by', dataType: 'jsonb' },
    })
    createdBy?: ActorStamp;

    @property({
        type: 'date',
        postgresql: { columnName: 'approved_at', dataType: 'timestamptz' },
    })
    approvedAt?: string;

    /**
     * Actor who approved this revision (set when status → APPROVED).
     */
    @property({
        ...actorStampProperty,
        postgresql: { columnName: 'approved_by', dataType: 'jsonb' },
    })
    approvedBy?: ActorStamp;

    @property({
        type: 'date',
        postgresql: { columnName: 'published_at', dataType: 'timestamptz' },
    })
    publishedAt?: string;

    /**
     * Actor who published this revision (set when status → PUBLISHED).
     */
    @property({
        ...actorStampProperty,
        postgresql: { columnName: 'published_by', dataType: 'jsonb' },
    })
    publishedBy?: ActorStamp;

    @hasMany(() => ContentRevisionTranslation, { keyTo: 'revisionId' })
    translations?: ContentRevisionTranslation[];

    constructor(data?: Partial<ContentRevision>) {
        super(data);
    }
}

export interface ContentRevisionRelations {
    item?: ContentItem;
    translations?: ContentRevisionTranslation[];
}

export type ContentRevisionWithRelations = ContentRevision & ContentRevisionRelations;