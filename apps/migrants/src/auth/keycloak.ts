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
    // Use 'check-sso' with responseMode 'query' so keycloak-js detects
    // the ?code=...&state=... params after redirect and exchanges them.
    // No silentCheckSsoRedirectUri or checkLoginIframe — both use cross-origin
    // iframes that browsers block when app and auth are on different subdomains.
    const authenticated = await keycloak.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      responseMode: 'query',
    });

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