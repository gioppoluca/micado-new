import { Entity, model, property } from '@loopback/repository';

@model({ settings: { postgresql: { schema: 'micado', table: 'languages' } } })
export class Language extends Entity {
    @property({ type: 'string', id: true, required: true })
    lang: string;

    @property({ type: 'string', postgresql: { columnName: 'iso_code' } })
    isoCode?: string;

    @property({ type: 'string', required: true })
    name: string;

    @property({ type: 'boolean', required: true, default: false })
    active: boolean;

    @property({ type: 'boolean', required: true, default: false, postgresql: { columnName: 'is_default' } })
    isDefault: boolean;

    @property({ type: 'number', required: true, default: 100, postgresql: { columnName: 'sort_order' } })
    sortOrder: number;

    @property({ type: 'string', postgresql: { columnName: 'voice_string' } })
    voiceString?: string;

    @property({ type: 'boolean', required: true, default: false, postgresql: { columnName: 'voice_active' } })
    voiceActive: boolean;

    @property({ type: 'date', postgresql: { columnName: 'created_at' } })
    createdAt?: string;

    @property({ type: 'date', postgresql: { columnName: 'updated_at' } })
    updatedAt?: string;

    constructor(data?: Partial<Language>) {
        super(data);
    }
}