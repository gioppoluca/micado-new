import { Getter, inject } from '@loopback/core';
import {
    DefaultCrudRepository,
    HasManyRepositoryFactory,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    MigrantProfile,
    MigrantProfileRelations,
    InterventionPlan,
} from '../models';
import type { InterventionPlanRepository } from './intervention-plan.repository';

export class MigrantProfileRepository extends DefaultCrudRepository<
    MigrantProfile,
    typeof MigrantProfile.prototype.keycloakId,
    MigrantProfileRelations
> {
    public readonly interventionPlans: HasManyRepositoryFactory<
        InterventionPlan,
        typeof MigrantProfile.prototype.keycloakId
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('InterventionPlanRepository')
        protected interventionPlanRepositoryGetter: Getter<InterventionPlanRepository>,
    ) {
        super(MigrantProfile, dataSource);

        this.interventionPlans = this.createHasManyRepositoryFactoryFor(
            'interventionPlans',
            interventionPlanRepositoryGetter,
        );
        this.registerInclusionResolver(
            'interventionPlans',
            this.interventionPlans.inclusionResolver,
        );
    }
}