/**
 * src/repositories/migrant-document.repository.ts
 */

import { Getter, inject } from '@loopback/core';
import { BelongsToAccessor, DefaultCrudRepository, repository } from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import { MigrantDocument, MigrantDocumentRelations, MigrantProfile } from '../models';
import type { MigrantProfileRepository } from './migrant-profile.repository';

export class MigrantDocumentRepository extends DefaultCrudRepository<
    MigrantDocument,
    typeof MigrantDocument.prototype.id,
    MigrantDocumentRelations
> {
    public readonly migrantProfile: BelongsToAccessor<
        MigrantProfile,
        typeof MigrantDocument.prototype.id
    >;

    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
        @repository.getter('MigrantProfileRepository')
        protected migrantProfileRepositoryGetter: Getter<MigrantProfileRepository>,
    ) {
        super(MigrantDocument, dataSource);

        this.migrantProfile = this.createBelongsToAccessorFor(
            'migrantProfile',
            migrantProfileRepositoryGetter,
        );
        this.registerInclusionResolver(
            'migrantProfile',
            this.migrantProfile.inclusionResolver,
        );
    }
}
