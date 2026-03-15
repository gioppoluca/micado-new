import { Getter, inject } from '@loopback/core';
import {
    BelongsToAccessor,
    DefaultCrudRepository,
    HasManyRepositoryFactory,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    ContentItem,
    ContentRevision,
    ContentRevisionRelations,
    ContentRevisionTranslation,
} from '../models';
import { ContentItemRepository } from './content-item.repository';
import { ContentRevisionTranslationRepository } from './content-revision-translation.repository';

export class ContentRevisionRepository extends DefaultCrudRepository<
    ContentRevision,
    typeof ContentRevision.prototype.id,
    ContentRevisionRelations
> {
    public readonly item: BelongsToAccessor<
        ContentItem,
        typeof ContentRevision.prototype.id
    >;

    public readonly translations: HasManyRepositoryFactory<
        ContentRevisionTranslation,
        typeof ContentRevision.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('ContentItemRepository')
        protected contentItemRepositoryGetter: Getter<ContentItemRepository>,
        @repository.getter('ContentRevisionTranslationRepository')
        protected contentRevisionTranslationRepositoryGetter: Getter<ContentRevisionTranslationRepository>,
    ) {
        super(ContentRevision, dataSource);

        this.item = this.createBelongsToAccessorFor(
            'item',
            contentItemRepositoryGetter,
        );
        this.registerInclusionResolver('item', this.item.inclusionResolver);

        this.translations = this.createHasManyRepositoryFactoryFor(
            'translations',
            contentRevisionTranslationRepositoryGetter,
        );
        this.registerInclusionResolver(
            'translations',
            this.translations.inclusionResolver,
        );
    }
}