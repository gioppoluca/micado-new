import { Entity, model, property } from '@loopback/repository';

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'app_settings' },
    },
})
export class Setting extends Entity {
    @property({
        type: 'string',
        id: true,
        required: true,
        postgresql: {
            columnName: 'key',
            dataType: 'text',
            nullable: 'NO',
        },
    })
    key: string;

    @property({
        type: 'string',
        required: true,
        postgresql: {
            columnName: 'value',
            dataType: 'text',
            nullable: 'NO',
        },
    })
    value: string;

    @property({
        type: 'string',
        postgresql: {
            columnName: 'description',
            dataType: 'text',
            nullable: 'YES',
        },
    })
    description?: string;

    @property({
        type: 'date',
        postgresql: {
            columnName: 'updated_at',
            dataType: 'timestamp with time zone',
            nullable: 'YES',
        },
    })
    updatedAt?: string;

    constructor(data?: Partial<Setting>) {
        super(data);
    }
}

export type SettingWithRelations = Setting;