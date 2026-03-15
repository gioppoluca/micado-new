import { inject, Getter } from '@loopback/core';
import {
    DefaultCrudRepository,
    HasManyRepositoryFactory,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    ContentItem,
    ContentItemRelations,
    ContentType,
    ContentTypeRelations,
} from '../models';
import { ContentItemRepository } from './content-item.repository';

export class ContentTypeRepository extends DefaultCrudRepository<
    ContentType,
    typeof ContentType.prototype.code,
    ContentTypeRelations
> {
    public readonly items: HasManyRepositoryFactory<
        ContentItem,
        typeof ContentType.prototype.code
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('ContentItemRepository')
        protected contentItemRepositoryGetter: Getter<ContentItemRepository>,
    ) {
        super(ContentType, dataSource);

        this.items = this.createHasManyRepositoryFactoryFor(
            'items',
            contentItemRepositoryGetter,
        );
        this.registerInclusionResolver('items', this.items.inclusionResolver);
    }
}