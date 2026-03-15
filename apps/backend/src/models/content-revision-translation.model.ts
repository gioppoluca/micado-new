import { belongsTo, Entity, model, property } from '@loopback/repository';
import { ContentRevision } from './content-revision.model';

@model({
    settings: {
        postgresql: { table: 'content_revision_translation' },
    },
})
export class ContentRevisionTranslation extends Entity {
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

    @belongsTo(() => ContentRevision, {
        name: 'revision',
        keyFrom: 'revisionId',
        keyTo: 'id',
    }, {
        postgresql: {
            columnName: 'revision_id',
            dataType: 'uuid',
        },
    })
    revisionId: string;

    @property({
        type: 'string',
        required: true,
        postgresql: {
            columnName: 'lang',
            dataType: 'varchar',
            dataLength: 16,
        },
    })
    lang: string;

    @property({
        type: 'string',
        required: true,
        postgresql: {
            columnName: 'title',
            dataType: 'text',
        },
    })
    title: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'description',
            dataType: 'text',
        },
    })
    description?: string;

    @property({
        type: 'object',
        required: true,
        jsonSchema: {
            type: 'object',
            additionalProperties: true,
        },
        postgresql: {
            columnName: 'i18n_extra',
            dataType: 'jsonb',
        },
    })
    i18nExtra: Record<string, unknown>;

    @property({
        type: 'string',
        required: true,
        jsonSchema: {
            enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'],
        },
        postgresql: {
            columnName: 't_status',
            dataType: 'varchar',
        },
    })
    tStatus: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    @property({
        type: 'string',
        postgresql: {
            columnName: 'source_hash',
            dataType: 'varchar',
            dataLength: 128,
        },
    })
    sourceHash?: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'weblate_key',
            dataType: 'varchar',
            dataLength: 255,
        },
    })
    weblateKey?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'last_import_at',
            dataType: 'timestamptz',
        },
    })
    lastImportAt?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'last_export_at',
            dataType: 'timestamptz',
        },
    })
    lastExportAt?: string;

    constructor(data?: Partial<ContentRevisionTranslation>) {
        super(data);
    }
}

export interface ContentRevisionTranslationRelations {
    revision?: ContentRevision;
}

export type ContentRevisionTranslationWithRelations =
    ContentRevisionTranslation & ContentRevisionTranslationRelations;