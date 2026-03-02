import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core';
import { juggler } from '@loopback/repository';

const config = {
    name: 'postgres',
    connector: 'postgresql',
    //url: process.env.DATABASE_URL,
    host: process.env.DB_HOST ?? 'db',
    port: +(process.env.DB_PORT ?? 5432),
    user: 'micado',
    password: process.env.MICADO_APP_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'micado',
    schema: 'micado',
};

// TEMP DEBUG — remove after fixing
console.log('[DB CONFIG]', {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    schema: config.schema,
    password: config.password ? `set (${config.password.length} chars)` : 'MISSING',
    url: process.env.DATABASE_URL ? 'DATABASE_URL is set' : 'DATABASE_URL not set',
});

@lifeCycleObserver('datasource')
export class PostgresDataSource
    extends juggler.DataSource
    implements LifeCycleObserver {
    static dataSourceName = 'postgres';
    static readonly defaultConfig = config;

    constructor(
        @inject('datasources.config.postgres', { optional: true })
        dsConfig: object = config,
    ) {
        super(dsConfig);
    }
}