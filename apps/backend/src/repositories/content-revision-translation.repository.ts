import { Getter, inject } from '@loopback/core';
import {
    BelongsToAccessor,
    DefaultCrudRepository,
    repository,
} from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import {
    ContentRevision,
    ContentRevisionTranslation,
    ContentRevisionTranslationRelations,
} from '../models';
import { ContentRevisionRepository } from './content-revision.repository';

export class ContentRevisionTranslationRepository extends DefaultCrudRepository<
    ContentRevisionTranslation,
    typeof ContentRevisionTranslation.prototype.id,
    ContentRevisionTranslationRelations
> {
    public readonly revision: BelongsToAccessor<
        ContentRevision,
        typeof ContentRevisionTranslation.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('ContentRevisionRepository')
        protected contentRevisionRepositoryGetter: Getter<ContentRevisionRepository>,
    ) {
        super(ContentRevisionTranslation, dataSource);

        this.revision = this.createBelongsToAccessorFor(
            'revision',
            contentRevisionRepositoryGetter,
        );
        this.registerInclusionResolver(
            'revision',
            this.revision.inclusionResolver,
        );
    }
}