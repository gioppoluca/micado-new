import { Getter, inject } from '@loopback/core';
import {
    BelongsToAccessor,
    DefaultCrudRepository,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    InterventionPlanItem,
    InterventionPlanItemRelations,
    InterventionPlan,
} from '../models';
import { InterventionPlanRepository } from './intervention-plan.repository';

export class InterventionPlanItemRepository extends DefaultCrudRepository<
    InterventionPlanItem,
    typeof InterventionPlanItem.prototype.id,
    InterventionPlanItemRelations
> {
    public readonly plan: BelongsToAccessor<
        InterventionPlan,
        typeof InterventionPlanItem.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('InterventionPlanRepository')
        protected interventionPlanRepositoryGetter: Getter<InterventionPlanRepository>,
    ) {
        super(InterventionPlanItem, dataSource);

        this.plan = this.createBelongsToAccessorFor(
            'plan',
            interventionPlanRepositoryGetter,
        );
        this.registerInclusionResolver('plan', this.plan.inclusionResolver);
    }
}