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
    ContentItemRelations,
    ContentRevision,
    ContentType,
    ContentItemRelation,
} from '../models';
import { ContentRevisionRepository } from './content-revision.repository';
import { ContentTypeRepository } from './content-type.repository';
import { ContentItemRelationRepository } from './content-item-relation.repository';

export class ContentItemRepository extends DefaultCrudRepository<
    ContentItem,
    typeof ContentItem.prototype.id,
    ContentItemRelations
> {
    public readonly contentType: BelongsToAccessor<
        ContentType,
        typeof ContentItem.prototype.id
    >;

    public readonly revisions: HasManyRepositoryFactory<
        ContentRevision,
        typeof ContentItem.prototype.id
    >;

    public readonly childRelations: HasManyRepositoryFactory<
        ContentItemRelation,
        typeof ContentItem.prototype.id
    >;

    public readonly parentRelations: HasManyRepositoryFactory<
        ContentItemRelation,
        typeof ContentItem.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('ContentTypeRepository')
        protected contentTypeRepositoryGetter: Getter<ContentTypeRepository>,
        @repository.getter('ContentRevisionRepository')
        protected contentRevisionRepositoryGetter: Getter<ContentRevisionRepository>,
        @repository.getter('ContentItemRelationRepository')
        protected contentItemRelationRepositoryGetter: Getter<ContentItemRelationRepository>,
    ) {
        super(ContentItem, dataSource);

        this.contentType = this.createBelongsToAccessorFor(
            'contentType',
            contentTypeRepositoryGetter,
        );
        this.registerInclusionResolver(
            'contentType',
            this.contentType.inclusionResolver,
        );

        this.revisions = this.createHasManyRepositoryFactoryFor(
            'revisions',
            contentRevisionRepositoryGetter,
        );
        this.registerInclusionResolver(
            'revisions',
            this.revisions.inclusionResolver,
        );

        this.childRelations = this.createHasManyRepositoryFactoryFor(
            'childRelations',
            contentItemRelationRepositoryGetter,
        );
        this.registerInclusionResolver(
            'childRelations',
            this.childRelations.inclusionResolver,
        );

        this.parentRelations = this.createHasManyRepositoryFactoryFor(
            'parentRelations',
            contentItemRelationRepositoryGetter,
        );
        this.registerInclusionResolver(
            'parentRelations',
            this.parentRelations.inclusionResolver,
        );
    }
}