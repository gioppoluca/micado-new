import { Entity, hasMany, model, property } from '@loopback/repository';
import { ContentItem } from './content-item.model';

@model({
    settings: {
        postgresql: { table: 'content_type' },
    },
})
export class ContentType extends Entity {
    @property({
        type: 'string',
        id: true,
        required: true,
        postgresql: {
            columnName: 'code',
            dataType: 'varchar',
            dataLength: 64,
        },
    })
    code: string;

    @property({
        type: 'string',
        required: true,
        postgresql: {
            columnName: 'name',
            dataType: 'varchar',
            dataLength: 128,
        },
    })
    name: string;

    @property({
        type: 'object',
        required: true,
        jsonSchema: {
            type: 'object',
            additionalProperties: true,
        },
        postgresql: {
            columnName: 'revision_schema',
            dataType: 'jsonb',
        },
    })
    revisionSchema: Record<string, unknown>;

    @property({
        type: 'object',
        required: true,
        jsonSchema: {
            type: 'object',
            additionalProperties: true,
        },
        postgresql: {
            columnName: 'translation_schema',
            dataType: 'jsonb',
        },
    })
    translationSchema: Record<string, unknown>;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'weblate_namespace',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    weblateNamespace?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'created_at',
            dataType: 'timestamptz',
        },
    })
    createdAt?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'updated_at',
            dataType: 'timestamptz',
        },
    })
    updatedAt?: string;

    @hasMany(() => ContentItem, { keyTo: 'typeCode' })
    items?: ContentItem[];

    constructor(data?: Partial<ContentType>) {
        super(data);
    }
}

export interface ContentTypeRelations {
    items?: ContentItem[];
}

export type ContentTypeWithRelations = ContentType & ContentTypeRelations;