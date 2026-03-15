// src/models/feature-flag-i18n.model.ts
import { Entity, model, property } from '@loopback/repository';

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'features_flags_i18n' },
    },
})
export class FeatureFlagI18n extends Entity {
    @property({
        type: 'number',
        required: true,
        id: 1,
        postgresql: { columnName: 'flag_id', dataType: 'integer', nullable: 'NO' },
    })
    flagId: number;

    @property({
        type: 'string',
        required: true,
        id: 2,
        postgresql: { columnName: 'lang', dataType: 'character varying', dataLength: 10, nullable: 'NO' },
    })
    lang: string;

    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'label', dataType: 'text', nullable: 'NO' },
    })
    label: string;

    constructor(data?: Partial<FeatureFlagI18n>) {
        super(data);
    }
}

export interface FeatureFlagI18nRelations { }
export type FeatureFlagI18nWithRelations = FeatureFlagI18n & FeatureFlagI18nRelations;