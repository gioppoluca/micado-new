// src/repositories/feature-flag-i18n.repository.ts
import { DefaultCrudRepository } from '@loopback/repository';
import { FeatureFlagI18n, FeatureFlagI18nRelations } from '../models';
import { PostgresDataSource } from '../datasources/postgres.datasource';
import { inject } from '@loopback/core';

export class FeatureFlagI18nRepository extends DefaultCrudRepository<
    FeatureFlagI18n,
    typeof FeatureFlagI18n.prototype.flagId,
    FeatureFlagI18nRelations
> {
    constructor(@inject('datasources.postgres') dataSource: PostgresDataSource) {
        super(FeatureFlagI18n, dataSource);
    }
}