// src/repositories/language.repository.ts
import { DefaultCrudRepository } from '@loopback/repository';
import { Language } from '../models';
import { PostgresDataSource } from '../datasources/postgres.datasource';
import { inject } from '@loopback/core';

export class LanguageRepository extends DefaultCrudRepository<
    Language,
    typeof Language.prototype.lang
> {
    constructor(@inject('datasources.postgres') dataSource: PostgresDataSource) {
        super(Language, dataSource);
    }
}