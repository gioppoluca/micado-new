// src/repositories/feature-flag.repository.ts
import { DefaultCrudRepository, HasManyRepositoryFactory, repository } from '@loopback/repository';
import { FeatureFlag, FeatureFlagRelations, FeatureFlagI18n } from '../models';
import { PostgresDataSource } from '../datasources/postgres.datasource';
import { inject, Getter } from '@loopback/core';
import { FeatureFlagI18nRepository } from './feature-flag-i18n.repository';

export class FeatureFlagRepository extends DefaultCrudRepository<
    FeatureFlag,
    typeof FeatureFlag.prototype.id,
    FeatureFlagRelations
> {
    public readonly labels: HasManyRepositoryFactory<
        FeatureFlagI18n,
        typeof FeatureFlag.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('FeatureFlagI18nRepository')
        i18nRepoGetter: Getter<FeatureFlagI18nRepository>,
    ) {
        super(FeatureFlag, dataSource);
        this.labels = this.createHasManyRepositoryFactoryFor('labels', i18nRepoGetter);
        this.registerInclusionResolver('labels', this.labels.inclusionResolver);
    }
}