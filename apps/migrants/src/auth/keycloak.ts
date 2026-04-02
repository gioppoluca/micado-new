/**
 * src/auth/keycloak.ts
 *
 * Keycloak singleton — configured from runtime config (src/config/env.ts),
 * NOT from import.meta.env.VITE_* build-time variables.
 *
 * Why lazy initialisation
 * ───────────────────────
 * The `new Keycloak({...})` call must happen AFTER the envvar boot has run,
 * because only then does getRuntimeConfig() have the correct URLs.  Previously
 * the instance was created at module evaluation time using import.meta.env,
 * which was fine when values were baked in at build time but breaks with the
 * runtime-config pattern.
 *
 * Solution: export a `getKeycloak()` function that creates the instance on
 * first call (lazily) and returns it on subsequent calls.  The boot/keycloak.ts
 * file calls initKeycloak() which calls getKeycloak() internally — by that
 * point envvar has already run and getRuntimeConfig() is safe to call.
 *
 * The `keycloak` named export is a Proxy that forwards all property accesses
 * to the lazy singleton, so existing code that imports `keycloak` directly
 * continues to work without changes.
 */

import Keycloak from 'keycloak-js';
import type { KeycloakTokenParsed } from 'keycloak-js';
import { getRuntimeConfig } from 'src/config/env';
import { logger } from 'src/services/Logger';

// ─── Lazy singleton ───────────────────────────────────────────────────────────

let _instance: Keycloak | null = null;

export function getKeycloak(): Keycloak {
  if (_instance === null) {
    const { keycloakUrl, keycloakRealm, keycloakClientId } = getRuntimeConfig();

    logger.info('[keycloak] creating instance', {
      url: keycloakUrl,
      realm: keycloakRealm,
      clientId: keycloakClientId,
    });

    _instance = new Keycloak({
      url: keycloakUrl,
      realm: keycloakRealm,
      clientId: keycloakClientId,
    });

    _instance.onAuthSuccess = () => logger.info('[keycloak] auth success');
    _instance.onAuthError = (e) => logger.error('[keycloak] auth error', e);
    _instance.onAuthRefreshSuccess = () => logger.debug('[keycloak] token refreshed');
    _instance.onAuthRefreshError = () => logger.warn('[keycloak] token refresh failed');
    _instance.onAuthLogout = () => logger.info('[keycloak] logged out');

    _instance.onTokenExpired = () => {
      logger.debug('[keycloak] token expired, refreshing...');
      void (async () => {
        try {
          await _instance!.updateToken(30);
        } catch (e) {
          logger.warn('[keycloak] could not refresh token', e);
        }
      })();
    };
  }

  return _instance;
}

/**
 * Proxy export — all reads/writes are forwarded to the lazy singleton.
 * This means existing code like `keycloak.authenticated` or
 * `keycloak.login(...)` continues to work unchanged.
 */
export const keycloak: Keycloak = new Proxy({} as Keycloak, {
  get(_target, prop) {
    return Reflect.get(getKeycloak(), prop);
  },
  set(_target, prop, value) {
    return Reflect.set(getKeycloak(), prop, value);
  },
});

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initKeycloak(): Promise<boolean> {
  const kc = getKeycloak();

  try {
    const params = new URLSearchParams(window.location.search);

    if (params.has('error')) {
      logger.warn('[keycloak] error in redirect, clearing URL:', params.get('error'));
      window.history.replaceState({}, document.title, window.location.pathname);
      return false;
    }

    const authenticated = await kc.init({
      pkceMethod: 'S256',
      checkLoginIframe: false,
      responseMode: 'query',
    });

    if (authenticated) {
      const url = new URL(window.location.href);
      ['code', 'state', 'session_state', 'iss'].forEach(p => url.searchParams.delete(p));
      const clean = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
      window.history.replaceState({}, document.title, clean);
    }

    logger.info('[keycloak] initialized', { authenticated });
    return authenticated;

  } catch (e) {
    logger.error('[keycloak] init failed', e);
    throw e;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getToken(): string | undefined {
  return getKeycloak().token ?? undefined;
}

export function getRoles(): string[] {
  const kc = getKeycloak();
  const t: KeycloakTokenParsed = kc.tokenParsed ?? {};
  const realmRoles: string[] = t?.realm_access?.roles ?? [];
  const { keycloakClientId } = getRuntimeConfig();
  const clientRoles: string[] = keycloakClientId
    ? (t?.resource_access?.[keycloakClientId]?.roles ?? [])
    : [];
  return Array.from(new Set([...realmRoles, ...clientRoles]));
}