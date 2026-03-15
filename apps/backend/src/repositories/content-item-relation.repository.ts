import { Getter, inject } from '@loopback/core';
import {
    BelongsToAccessor,
    DefaultCrudRepository,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    ContentItem,
    ContentItemRelation,
    ContentItemRelationRelations,
} from '../models';
import { ContentItemRepository } from './content-item.repository';

export class ContentItemRelationRepository extends DefaultCrudRepository<
    ContentItemRelation,
    typeof ContentItemRelation.prototype.id,
    ContentItemRelationRelations
> {
    public readonly parentItem: BelongsToAccessor<
        ContentItem,
        typeof ContentItemRelation.prototype.id
    >;

    public readonly childItem: BelongsToAccessor<
        ContentItem,
        typeof ContentItemRelation.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('ContentItemRepository')
        protected contentItemRepositoryGetter: Getter<ContentItemRepository>,
    ) {
        super(ContentItemRelation, dataSource);

        this.parentItem = this.createBelongsToAccessorFor(
            'parentItem',
            contentItemRepositoryGetter,
        );
        this.registerInclusionResolver(
            'parentItem',
            this.parentItem.inclusionResolver,
        );

        this.childItem = this.createBelongsToAccessorFor(
            'childItem',
            contentItemRepositoryGetter,
        );
        this.registerInclusionResolver(
            'childItem',
            this.childItem.inclusionResolver,
        );
    }
}