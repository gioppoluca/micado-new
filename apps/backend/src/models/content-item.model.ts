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

    @property({
        type: 'string',
        postgresql: {
            columnName: 'created_by',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    createdBy?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'updated_at',
            dataType: 'timestamptz',
        },
    })
    updatedAt?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'updated_by',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    updatedBy?: string;

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