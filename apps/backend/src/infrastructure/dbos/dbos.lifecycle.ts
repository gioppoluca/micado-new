import { LifeCycleObserver, inject, lifeCycleObserver } from '@loopback/core';
import { DBOS } from '@dbos-inc/dbos-sdk';
//import { Client } from 'pg';
import { DBOS_CONFIG, DbosConfig } from './dbos.config';
import { registerDbosWorkflows } from './registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace the password in a postgres URL with ***. */
function maskUrl(raw: string): string {
    try {
        const u = new URL(raw);
        if (u.password) u.password = '***';
        return u.toString();
    } catch {
        return '(unparseable URL)';
    }
}

/** Parse a postgres URL into the fields we care about for diagnostics. */
function parseUrl(raw: string): Record<string, string> {
    try {
        const u = new URL(raw);
        return {
            protocol: u.protocol,
            user:     u.username || '(empty)',
            host:     u.hostname,
            port:     u.port || '5432',
            database: u.pathname.replace(/^\//, '') || '(empty)',
            options:  u.searchParams.get('options') ?? '(none)',
        };
    } catch {
        return { error: 'could not parse URL' };
    }
}

/**
 * Try to open a pg connection to the given URL.
 * Returns a human-readable result string — never throws.
 */
/*
async function probeConnection(url: string): Promise<string> {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{ current_user: string; version: string }>(
            `SELECT current_user, version()`,
        );
        const { current_user, version } = res.rows[0];
        await client.end().catch(() => {});
        return `OK — connected as "${current_user}", server: ${version.split(',')[0]}`;
    } catch (err: unknown) {
        try { await client.end(); } catch {  }
        const e = err as NodeJS.ErrnoException & { code?: string };
        return `FAILED — ${e.message ?? String(e)} (pg code: ${e.code ?? 'n/a'})`;
    }
}
*/
// ---------------------------------------------------------------------------
// Observer
// ---------------------------------------------------------------------------

@lifeCycleObserver('dbos')
export class DbosLifeCycleObserver implements LifeCycleObserver {
    private launched = false;

    constructor(@inject(DBOS_CONFIG) private cfg: DbosConfig) {}

    async start(): Promise<void> {
        if (this.launched) return;

        // ── 1. Dump resolved config ──────────────────────────────────────────
        console.log('[DBOS] ── pre-launch diagnostics ───────────────────────');
        console.log('[DBOS] appName            :', this.cfg.appName);
        console.log('[DBOS] systemSchema       :', this.cfg.systemSchema);
        console.log('[DBOS] logLevel           :', this.cfg.logLevel ?? 'info');
        console.log('[DBOS] executorId         :', this.cfg.executorId ?? '(none)');
        console.log('[DBOS] systemDatabaseUrl  :', (this.cfg.systemDatabaseUrl));
        console.log('[DBOS] URL breakdown      :', parseUrl(this.cfg.systemDatabaseUrl));

        // ── 2. Env vars that feed the URL ────────────────────────────────────
        console.log('[DBOS] env DBOS_SYSTEM_DATABASE_URL set:', !!process.env.DBOS_SYSTEM_DATABASE_URL);
        console.log('[DBOS] env DBOS_DB_USER             :', process.env.DBOS_DB_USER   ?? '(unset)');
        console.log('[DBOS] env DBOS_DB_SCHEMA           :', process.env.DBOS_DB_SCHEMA ?? '(unset)');
        console.log('[DBOS] env POSTGRES_DB              :', process.env.POSTGRES_DB    ?? '(unset)');
        console.log('[DBOS] env MICADO_APP_PASSWORD set  :', !!process.env.MICADO_APP_PASSWORD);

        // ── 3. Direct connectivity probes (before DBOS touches anything) ─────
        console.log('[DBOS] probing systemDatabaseUrl ...');
//        const probeResult = await probeConnection(this.cfg.systemDatabaseUrl);
//        console.log('[DBOS] probe result:', probeResult);

        // Also probe the "postgres" DB — that's the admin fallback DBOS tries internally
        try {
            const u = new URL(this.cfg.systemDatabaseUrl);
            u.pathname = '/micado';
            u.search = '';  // strip options so it's a clean auth test
            const adminUrl = u.toString();
            console.log('[DBOS] probing admin fallback url:', maskUrl(adminUrl));
//            const adminProbe = await probeConnection(adminUrl);
//            console.log('[DBOS] admin fallback probe:', adminProbe);
        } catch {
            console.log('[DBOS] admin fallback probe: (could not construct URL)');
        }

        console.log('[DBOS] ────────────────────────────────────────────────────');

        // ── 4. Normal launch ─────────────────────────────────────────────────
        try {
            registerDbosWorkflows();

            DBOS.setConfig({
                name:                     this.cfg.appName,
                systemDatabaseUrl:        this.cfg.systemDatabaseUrl,
                systemDatabaseSchemaName: this.cfg.systemSchema,
                executorID:               this.cfg.executorId,
                logLevel:                 this.cfg.logLevel ?? 'info',
            });

            await DBOS.launch();
            this.launched = true;
            console.log('[DBOS] launched successfully');
        } catch (err: unknown) {
            const e = err as Error & { dbosErrorCode?: number; error?: unknown };
            console.error('[DBOS] launch FAILED ─────────────────────────────────');
            console.error('[DBOS] message        :', e.message);
            console.error('[DBOS] dbosErrorCode  :', e.dbosErrorCode ?? 'n/a');
            if (e.error && typeof e.error === 'object') {
                const inner = e.error as Error & { code?: string };
                console.error('[DBOS] inner message  :', inner.message);
                console.error('[DBOS] inner pg code  :', inner.code ?? 'n/a');
            }
            console.error('[DBOS] full error     :', err);
            console.error('[DBOS] ───────────────────────────────────────────────');
            throw err;
        }
    }

    async stop(): Promise<void> {
        if (!this.launched) return;
        await DBOS.shutdown();
        this.launched = false;
    }
}