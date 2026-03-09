import Keycloak from 'keycloak-js';
import type { KeycloakTokenParsed } from 'keycloak-js';
import { logger } from '../services/Logger';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});

export async function initKeycloak(): Promise<boolean> {
  logger.info('[keycloak] initializing', {
    url: import.meta.env.VITE_KEYCLOAK_URL,
    realm: import.meta.env.VITE_KEYCLOAK_REALM,
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  });

  try {
    const params = new URLSearchParams(window.location.search);

    // If Keycloak returned an error on the redirect, clear the URL and
    // return unauthenticated — do NOT re-init, that causes the loop.
    if (params.has('error')) {
      logger.warn('[keycloak] error in redirect, clearing URL:', params.get('error'));
      window.history.replaceState({}, document.title, window.location.pathname);
      return false;
    }

    const authenticated = await keycloak.init({
      // Do NOT use onLoad: 'check-sso' — on cross-origin setups without
      // iframe support it falls back to a full redirect on every page load,
      // creating an infinite loop with error=login_required.
      //
      // Instead: init with no onLoad (returns false if no session),
      // and let the router guard / login button trigger login explicitly.
      pkceMethod: 'S256',
      checkLoginIframe: false,
      responseMode: 'query',
    });

    // Clean callback params from URL after successful exchange
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

keycloak.onAuthSuccess = () => logger.info('[keycloak] auth success');
keycloak.onAuthError = (e) => logger.error('[keycloak] auth error', e);
keycloak.onAuthRefreshSuccess = () => logger.debug('[keycloak] token refreshed');
keycloak.onAuthRefreshError = () => logger.warn('[keycloak] token refresh failed');
keycloak.onAuthLogout = () => logger.info('[keycloak] logged out');

keycloak.onTokenExpired = () => {
  logger.debug('[keycloak] token expired, refreshing...');
  void (async () => {
    try {
      await keycloak.updateToken(30);
    } catch (e) {
      logger.warn('[keycloak] could not refresh token', e);
    }
  })();
};

export function getToken(): string | undefined {
  return keycloak.token ?? undefined;
}

export function getRoles(): string[] {
  const t: KeycloakTokenParsed = keycloak.tokenParsed ?? {};
  const realmRoles: string[] = t?.realm_access?.roles ?? [];
  const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
  const clientRoles: string[] = clientId ? (t?.resource_access?.[clientId]?.roles ?? []) : [];
  return Array.from(new Set([...realmRoles, ...clientRoles]));
}
