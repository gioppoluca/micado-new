import {
    belongsTo,
    Entity,
    hasMany,
    model,
    property,
} from '@loopback/repository';
import { ContentItem } from './content-item.model';
import { ContentRevisionTranslation } from './content-revision-translation.model';

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
        postgresql: {
            columnName: 'id',
            dataType: 'uuid',
        },
    })
    id?: string;

    @belongsTo(() => ContentItem, {
        name: 'item',
        keyFrom: 'itemId',
        keyTo: 'id',
    }, {
        postgresql: {
            columnName: 'item_id',
            dataType: 'uuid',
        },
    })
    itemId: string;

    @property({
        type: 'number',
        required: true,
        postgresql: {
            columnName: 'revision_no',
            dataType: 'integer',
        },
    })
    revisionNo: number;

    @property({
        type: 'string',
        required: true,
        jsonSchema: {
            enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'],
        },
        postgresql: {
            columnName: 'status',
            dataType: 'varchar',
        },
    })
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({
        type: 'string',
        required: true,
        postgresql: {
            columnName: 'source_lang',
            dataType: 'varchar',
            dataLength: 16,
        },
    })
    sourceLang: string;

    @property({
        type: 'object',
        required: true,
        jsonSchema: {
            type: 'object',
            additionalProperties: true,
        },
        postgresql: {
            columnName: 'data_extra',
            dataType: 'jsonb',
        },
    })
    dataExtra: Record<string, unknown>;

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
            columnName: 'approved_at',
            dataType: 'timestamptz',
        },
    })
    approvedAt?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'approved_by',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    approvedBy?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'published_at',
            dataType: 'timestamptz',
        },
    })
    publishedAt?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'published_by',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    publishedBy?: string;

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