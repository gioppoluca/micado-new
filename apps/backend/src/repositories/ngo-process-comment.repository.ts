/**
 * src/repositories/ngo-process-comment.repository.ts
 *
 * Plain CRUD repository for ngo_process_comment.
 * No relations needed — queries always filter by revisionId + ngoGroupId.
 */

import { inject } from '@loopback/core';
import { DefaultCrudRepository } from '@loopback/repository';
import { PostgresDataSource } from '../datasources';
import { NgoProcessComment, NgoProcessCommentRelations } from '../models';

export class NgoProcessCommentRepository extends DefaultCrudRepository<
    NgoProcessComment,
    typeof NgoProcessComment.prototype.id,
    NgoProcessCommentRelations
> {
    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
    ) {
        super(NgoProcessComment, dataSource);
    }
}
