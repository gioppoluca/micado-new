import { belongsTo, Entity, model, property } from '@loopback/repository';
import { ContentItem } from './content-item.model';
import type { ActorStamp } from '../auth/actor-stamp';

@model({
    settings: {
        postgresql: { table: 'content_item_relation' },
    },
})
export class ContentItemRelation extends Entity {
    @property({
        type: 'string',
        id: true,
        generated: false,
        postgresql: { columnName: 'id', dataType: 'uuid' },
    })
    id?: string;

    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'relation_type', dataType: 'varchar', dataLength: 64 },
    })
    relationType: string;

    @belongsTo(
        () => ContentItem,
        { name: 'parentItem', keyFrom: 'parentItemId', keyTo: 'id' },
        { postgresql: { columnName: 'parent_item_id', dataType: 'uuid' } },
    )
    parentItemId: string;

    @belongsTo(
        () => ContentItem,
        { name: 'childItem', keyFrom: 'childItemId', keyTo: 'id' },
        { postgresql: { columnName: 'child_item_id', dataType: 'uuid' } },
    )
    childItemId: string;

    @property({
        type: 'number',
        required: true,
        default: 0,
        postgresql: { columnName: 'sort_order', dataType: 'integer' },
    })
    sortOrder: number;

    @property({
        type: 'object',
        required: true,
        jsonSchema: { type: 'object', additionalProperties: true },
        postgresql: { columnName: 'relation_extra', dataType: 'jsonb' },
    })
    relationExtra: Record<string, unknown>;

    @property({
        type: 'date',
        postgresql: { columnName: 'created_at', dataType: 'timestamptz' },
    })
    createdAt?: string;

    /**
     * Actor who created this relation.
     * Shape: { sub, username, name, realm } — stored as JSONB.
     * Build with buildActorStamp() from src/auth/actor-stamp.ts.
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
        postgresql: { columnName: 'created_by', dataType: 'jsonb' },
    })
    createdBy?: ActorStamp;

    constructor(data?: Partial<ContentItemRelation>) {
        super(data);
    }
}

export interface ContentItemRelationRelations {
    parentItem?: ContentItem;
    childItem?: ContentItem;
}

export type ContentItemRelationWithRelations =
    ContentItemRelation & ContentItemRelationRelations;