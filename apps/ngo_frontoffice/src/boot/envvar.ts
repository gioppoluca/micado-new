/**
 * src/boot/envvar.ts
 *
 * MUST be the first entry in quasar.config.ts boot[].
 *
 * Fetches /config.json from our own origin at runtime and stores the result
 * in the RuntimeConfig singleton (src/config/env.ts).  Every subsequent boot
 * — axios, loadData, keycloak — reads its URLs from that singleton.
 *
 * How config.json gets onto the server
 * ──────────────────────────────────────
 * Development : public/config.json is committed with local defaults.
 *               It is served by `quasar dev` as a static file.
 *
 * Production  : docker-entrypoint.sh generates config.json from container
 *               environment variables and writes it to the nginx html root
 *               before nginx starts.
 *
 * Failure strategy
 * ─────────────────
 * Development : falls back to DEV_DEFAULTS from env.ts, logs a warning.
 * Production  : rethrows — a missing config.json is a deployment error.
 */

import { defineBoot } from '#q-app/wrappers';
import { setRuntimeConfig, getRuntimeConfigOrDefaults } from 'src/config/env';
import type { RuntimeConfig } from 'src/config/env';
import { logger } from 'src/services/Logger';

// import.meta.env.PROD is a boolean injected by Vite — no cast needed.
const IS_PROD = import.meta.env.PROD;

// ─── Type guard ───────────────────────────────────────────────────────────────
// Validates that an unknown JSON value has all required RuntimeConfig fields
// and narrows the type so no cast is needed at the call site.

function isValidConfig(value: unknown): value is RuntimeConfig {
    if (typeof value !== 'object' || value === null) return false;
    const required: (keyof RuntimeConfig)[] = [
        'apiUrl',
        'keycloakUrl',
        'keycloakRealm',
        'keycloakClientId',
    ];
    return required.every(
        k => typeof (value as Record<string, unknown>)[k] === 'string' &&
            (value as Record<string, unknown>)[k] !== '',
    );
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export default defineBoot(async () => {
    logger.info('[boot:envvar] loading runtime config', { prod: IS_PROD });

    try {
        const response = await fetch('/config.json');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching /config.json`);
        }

        const raw: unknown = await response.json();

        if (!isValidConfig(raw)) {
            const present = typeof raw === 'object' && raw !== null
                ? Object.keys(raw)
                : [];
            const required = ['apiUrl', 'keycloakUrl', 'keycloakRealm', 'keycloakClientId'];
            const missing = required.filter(k => !present.includes(k));
            throw new Error(
                `config.json is invalid. Missing or empty fields: ${missing.join(', ')}`,
            );
        }

        setRuntimeConfig(raw);
        logger.info('[boot:envvar] runtime config loaded', {
            apiUrl: raw.apiUrl,
            keycloakUrl: raw.keycloakUrl,
            keycloakRealm: raw.keycloakRealm,
            keycloakClientId: raw.keycloakClientId,
        });

    } catch (err) {
        if (IS_PROD) {
            logger.error('[boot:envvar] FATAL: could not load /config.json in production', err);
            throw err;
        } else {
            logger.warn(
                '[boot:envvar] could not load /config.json — using DEV_DEFAULTS. ' +
                'Create public/config.json to override.',
                err,
            );
            setRuntimeConfig(getRuntimeConfigOrDefaults());
        }
    }
});