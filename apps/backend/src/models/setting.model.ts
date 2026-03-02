import { Entity, model, property } from '@loopback/repository';

@model({
    settings: {
        postgresql: { schema: 'micado', table: 'app_settings' },
    },
})
export class Setting extends Entity {
    @property({
        type: 'string',
        id: true,
        required: true,
        postgresql: { columnName: 'key', dataType: 'text' },
    })
    key: string;

    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'value', dataType: 'text' },
    })
    value: string;

    constructor(data?: Partial<Setting>) {
        super(data);
    }
}

export type SettingWithRelations = Setting;