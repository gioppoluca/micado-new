import {
    belongsTo,
    Entity,
    hasMany,
    model,
    property,
} from '@loopback/repository';
import { ContentType } from './content-type.model';
import { ContentRevision } from './content-revision.model';
import { ContentItemRelation } from './content-item-relation.model';
import type { ActorStamp } from '../auth/actor-stamp';

@model({
    settings: {
        postgresql: { table: 'content_item' },
    },
})
export class ContentItem extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: {
            columnName: 'id',
            dataType: 'uuid',
        },
    })
    id?: string;

    @belongsTo(
        () => ContentType,
        {
            name: 'contentType',
            keyFrom: 'typeCode',
            keyTo: 'code',
        },
        {
            postgresql: {
                columnName: 'type_code',
                dataType: 'varchar',
                dataLength: 64,
            },
        },
    )
    typeCode: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'slug',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    slug?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'external_key',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    externalKey?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'published_revision_id',
            dataType: 'uuid',
        },
    })
    publishedRevisionId?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'created_at',
            dataType: 'timestamptz',
        },
    })
    createdAt?: string;

    /**
     * Structured actor stamp stored as JSONB.
     * Shape: { sub, username, name, realm }
     * Use buildActorStamp() from src/auth/actor-stamp.ts to create values.
     * Use parseActorStamp() to read them back typed.
     */
    @property({
        type: 'object',
        jsonSchema: {
            type: 'object',
            properties: {
                sub: { type: 'string' },
                username: { type: 'string' },
                name: { type: 'string' },
                realm: { type: 'string' },
            },
            additionalProperties: false,
        },
        postgresql: {
            columnName: 'created_by',
            dataType: 'jsonb',
        },
    })
    createdBy?: ActorStamp;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'updated_at',
            dataType: 'timestamptz',
        },
    })
    updatedAt?: string;

    @property({
        type: 'object',
        jsonSchema: {
            type: 'object',
            properties: {
                sub: { type: 'string' },
                username: { type: 'string' },
                name: { type: 'string' },
                realm: { type: 'string' },
            },
            additionalProperties: false,
        },
        postgresql: {
            columnName: 'updated_by',
            dataType: 'jsonb',
        },
    })
    updatedBy?: ActorStamp;

    @hasMany(() => ContentRevision, { keyTo: 'itemId' })
    revisions?: ContentRevision[];

    @hasMany(() => ContentItemRelation, { keyTo: 'parentItemId' })
    childRelations?: ContentItemRelation[];

    @hasMany(() => ContentItemRelation, { keyTo: 'childItemId' })
    parentRelations?: ContentItemRelation[];

    constructor(data?: Partial<ContentItem>) {
        super(data);
    }
}

export interface ContentItemRelations {
    contentType?: ContentType;
    revisions?: ContentRevision[];
    childRelations?: ContentItemRelation[];
    parentRelations?: ContentItemRelation[];
}

export type ContentItemWithRelations = ContentItem & ContentItemRelations;