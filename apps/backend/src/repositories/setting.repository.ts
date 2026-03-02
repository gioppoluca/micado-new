import { inject } from '@loopback/core';
import { DefaultCrudRepository } from '@loopback/repository';
import { PostgresDataSource } from '../datasources/postgres.datasource';
import { Setting, SettingWithRelations } from '../models/setting.model';

export class SettingRepository extends DefaultCrudRepository<
    Setting,
    typeof Setting.prototype.key,
    SettingWithRelations
> {
    constructor(
        @inject('datasources.postgres') dataSource: PostgresDataSource,
    ) {
        super(Setting, dataSource);
    }
}