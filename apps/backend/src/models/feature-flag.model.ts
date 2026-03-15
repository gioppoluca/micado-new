// src/models/feature-flag.model.ts
import { Entity, model, property, hasMany } from '@loopback/repository';
import { FeatureFlagI18n } from './feature-flag-i18n.model';

@model({
    settings: {
        idInjection: false,
        postgresql: { schema: 'micado', table: 'features_flags' },
    },
})
export class FeatureFlag extends Entity {
    @property({
        type: 'number',
        id: true,
        generated: true,
        postgresql: { columnName: 'id', dataType: 'integer', nullable: 'NO' },
    })
    id: number;

    @property({
        type: 'string',
        required: true,
        postgresql: { columnName: 'flag_key', dataType: 'text', nullable: 'NO' },
    })
    flagKey: string;

    @property({
        type: 'boolean',
        required: true,
        default: false,
        postgresql: { columnName: 'enabled', dataType: 'boolean', nullable: 'NO' },
    })
    enabled: boolean;

    @property({
        type: 'date',
        postgresql: { columnName: 'created_at', dataType: 'timestamp with time zone', nullable: 'NO' },
    })
    createdAt?: string;

    @property({
        type: 'date',
        postgresql: { columnName: 'updated_at', dataType: 'timestamp with time zone', nullable: 'NO' },
    })
    updatedAt?: string;

    @hasMany(() => FeatureFlagI18n, { keyTo: 'flagId' })
    labels: FeatureFlagI18n[];

    constructor(data?: Partial<FeatureFlag>) {
        super(data);
    }
}

export interface FeatureFlagRelations { }
export type FeatureFlagWithRelations = FeatureFlag & FeatureFlagRelations;