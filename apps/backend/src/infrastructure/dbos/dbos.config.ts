import { BindingKey } from '@loopback/core';

const host = process.env.DB_HOST ?? 'db';
const port = Number(process.env.DB_PORT ?? 5432);
const user = process.env.DB_USER ?? 'dbos';
const password = process.env.MICADO_APP_PASSWORD ?? '';
const database = process.env.POSTGRES_DB ?? 'micado';

const systemDatabaseUrl =
    process.env.DBOS_SYSTEM_DATABASE_URL ??
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;

export type DbosConfig = {
    /** Logical name of the DBOS application (used in DBOS metadata). */
    appName: string;

    /** Postgres connection string used by DBOS system tables/runtime. */
    systemDatabaseUrl: string;

    /**
     * Schema where DBOS will create its system tables.
     * Recommended: keep it separate from domain schema (e.g. "dbos").
     */
    systemSchema: string;
    sys_db_name: string;
    /**
     * Optional executor identifier (useful when running multiple replicas).
     * Leave undefined for single-replica/local runs.
     */
    executorId?: string;

    /** DBOS log level (e.g. "debug" | "info" | "warn" | "error"). */
    logLevel?: string;
};

/** Resolved default configuration (can be overridden by binding). */
export const DEFAULT_DBOS_CONFIG: DbosConfig = {
    appName: process.env.DBOS_APP_NAME ?? 'micado-backend',
    systemDatabaseUrl,
    sys_db_name: 'micado',
    systemSchema: process.env.DBOS_SYSTEM_SCHEMA_NAME ?? 'dbos',
    executorId: process.env.DBOS_EXECUTOR_ID,
    logLevel: process.env.DBOS_LOG_LEVEL ?? 'info',
};

export const DBOS_CONFIG = BindingKey.create<DbosConfig>('config.dbos');