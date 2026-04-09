/**
 * src/config/env.ts
 *
 * Runtime environment configuration.
 *
 * WHY this file exists
 * ────────────────────
 * Vite bakes import.meta.env.VITE_* values into the JS bundle at build time.
 * A built image would then carry hardcoded URLs for one specific environment,
 * making it impossible to use the same Docker image for staging and production.
 *
 * Instead, we fetch a small JSON file from our own origin at runtime (before
 * any other boot runs), so the same image can be configured differently by
 * injecting a different config.json at container startup.
 *
 * Security note on Keycloak values
 * ─────────────────────────────────
 * keycloakUrl, realm, and clientId are all safe to expose in a public JSON
 * file.  For a browser SPA, Keycloak uses the Public Client flow — there is
 * intentionally no client secret.  The browser cannot keep secrets.  Security
 * is provided by:
 *   • PKCE (already implemented in src/auth/keycloak.ts)
 *   • Valid Redirect URIs locked to your domain in the Keycloak admin console
 *   • Short-lived, signed JWT tokens
 *
 * Usage (anywhere in the app after boot):
 *   import { getRuntimeConfig } from 'src/config/env';
 *   const { apiUrl, keycloakUrl } = getRuntimeConfig();
 */

// ─── Shape of /config.json ────────────────────────────────────────────────────

export interface RuntimeConfig {
  /** Base URL of the Micado backend API, e.g. "https://api.micado.example.com" */
  apiUrl: string;

  /** Base URL of the Keycloak server, e.g. "https://auth.micado.example.com" */
  keycloakUrl: string;

  /** Keycloak realm used by this PA application, e.g. "micado" */
  keycloakRealm: string;

  /** Keycloak public client ID for this application, e.g. "micado-pa" */
  keycloakClientId: string;

  /** Public-facing URL of this PA app (used as Keycloak redirect base) */
  paUrl?: string;

  /** Public-facing domain of the migrant app (for cross-app links) */
  migrantDomain?: string;

  /** Optional: title character limit for content editors */
  titleLimit?: number;

  /** Base URL of Umami, e.g. "https://analytics.micado.example.com" */
  umamiUrl?: string;

  /** Umami website id for the PA frontend */
  umamiWebsiteId?: string;

  /** Optional: only track on these domains */
  umamiDomains?: string;
}

// ─── Defaults (used in dev when config.json is not present) ───────────────────
// These match a typical local Docker Compose setup.  They are overridden in
// production by the real config.json served by nginx.

const DEV_DEFAULTS: RuntimeConfig = {
  apiUrl: 'http://api.localhost',
  keycloakUrl: 'http://auth.localhost',
  keycloakRealm: 'pa_frontoffice',
  keycloakClientId: 'pa_frontoffice',
  paUrl: 'http://pa.localhost',
  migrantDomain: 'localhost',
  titleLimit: 30,
  umamiUrl: 'http://umami.localhost',
  umamiWebsiteId: '22222222-2222-4222-8222-222222222222',
  umamiDomains: 'pa.localhost',
};

// ─── Singleton ────────────────────────────────────────────────────────────────
// Set once by the envvar boot, read everywhere else.

let _config: RuntimeConfig | null = null;

/**
 * Called exactly once by src/boot/envvar.ts.
 * Throws if called more than once (programming error guard).
 */
export function setRuntimeConfig(config: RuntimeConfig): void {
  if (_config !== null) {
    // Allow re-setting in tests; warn in production.
    console.warn('[env] setRuntimeConfig called more than once — ignoring');
    return;
  }
  _config = config;
}

/**
 * Returns the runtime config.  Throws if called before the envvar boot has run
 * (i.e. before the app is fully initialised).
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (_config === null) {
    throw new Error(
      '[env] getRuntimeConfig() called before envvar boot completed. ' +
      'Make sure "envvar" is the first entry in quasar.config.ts boot[].',
    );
  }
  return _config;
}

/**
 * Returns the config or dev defaults if the boot has not run yet.
 * Use this only in module-level code that executes before boot (e.g. src/api/client.ts
 * creates the axios instance at module evaluation time).
 */
export function getRuntimeConfigOrDefaults(): RuntimeConfig {
  return _config ?? DEV_DEFAULTS;
}