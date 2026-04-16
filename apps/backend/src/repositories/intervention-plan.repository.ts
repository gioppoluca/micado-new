import { Getter, inject } from '@loopback/core';
import {
    BelongsToAccessor,
    DefaultCrudRepository,
    HasManyRepositoryFactory,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    InterventionPlan,
    InterventionPlanRelations,
    InterventionPlanItem,
    MigrantProfile,
} from '../models';
import { InterventionPlanItemRepository } from './intervention-plan-item.repository';
import type { MigrantProfileRepository } from './migrant-profile.repository';

export class InterventionPlanRepository extends DefaultCrudRepository<
    InterventionPlan,
    typeof InterventionPlan.prototype.id,
    InterventionPlanRelations
> {
    public readonly migrantProfile: BelongsToAccessor<
        MigrantProfile,
        typeof InterventionPlan.prototype.id
    >;

    public readonly items: HasManyRepositoryFactory<
        InterventionPlanItem,
        typeof InterventionPlan.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('MigrantProfileRepository')
        protected migrantProfileRepositoryGetter: Getter<MigrantProfileRepository>,
        @repository.getter('InterventionPlanItemRepository')
        protected interventionPlanItemRepositoryGetter: Getter<InterventionPlanItemRepository>,
    ) {
        super(InterventionPlan, dataSource);

        this.migrantProfile = this.createBelongsToAccessorFor(
            'migrantProfile',
            migrantProfileRepositoryGetter,
        );
        this.registerInclusionResolver(
            'migrantProfile',
            this.migrantProfile.inclusionResolver,
        );

        this.items = this.createHasManyRepositoryFactoryFor(
            'items',
            interventionPlanItemRepositoryGetter,
        );
        this.registerInclusionResolver(
            'items',
            this.items.inclusionResolver,
        );
    }
}