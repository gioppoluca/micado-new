import KcAdminClient from '@keycloak/keycloak-admin-client';
import { injectable, BindingScope, inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';

/**
 * Thin Keycloak Admin client wrapper.
 *
 * Authentication always targets the `master` realm using the bootstrap admin
 * account and the `admin-cli` client (which only exists in `master`).
 * After authentication the client is reconfigured to operate against the
 * requested target realm, so all subsequent API calls (users, roles, …) hit
 * the correct realm without re-authenticating.
 *
 * ENV vars consumed:
 *   KEYCLOAK_INTERNAL_BASE          – internal Docker URL, e.g. http://keycloak:8080
 *   KEYCLOAK_ADMIN_BASE_URL         – alias for the above (takes precedence)
 *   KEYCLOAK_ADMIN_REALM            – override for the auth realm (default: master)
 *   KEYCLOAK_ADMIN_CLIENT_ID        – override for the admin client (default: admin-cli)
 *   KEYCLOAK_ADMIN_USERNAME         – admin username (preferred)
 *   KC_BOOTSTRAP_ADMIN_USERNAME     – fallback admin username
 *   KEYCLOAK_ADMIN_PASSWORD         – admin password (preferred)
 *   KC_BOOTSTRAP_ADMIN_PASSWORD     – fallback admin password
 */
@injectable({ scope: BindingScope.SINGLETON })
export class KeycloakAdminService {
  constructor(
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) { }

  /**
   * Returns an authenticated KcAdminClient scoped to `targetRealm`.
   *
   * Auth is always performed against the `master` realm (where admin-cli lives).
   * The client is then redirected to `targetRealm` via setConfig() so that
   * subsequent resource calls (users.find, roles.find, …) operate in the
   * correct realm.
   *
   * @param targetRealm  The realm to manage (e.g. 'pa_frontoffice').
   *                     Defaults to the auth realm (master) when omitted.
   */
  async getClient(targetRealm?: string): Promise<KcAdminClient> {
    const baseUrl =
      process.env.KEYCLOAK_ADMIN_BASE_URL ??
      process.env.KEYCLOAK_INTERNAL_BASE ??
      'http://keycloak:8080';

    // The realm used to *authenticate* — always master, because admin-cli
    // only exists there. This is independent of the realm being managed.
    const authRealm =
      process.env.KEYCLOAK_ADMIN_REALM ??
      'master';

    const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'admin-cli';

    const username =
      process.env.KEYCLOAK_ADMIN_USERNAME ??
      process.env.KC_BOOTSTRAP_ADMIN_USERNAME;
    const password =
      process.env.KEYCLOAK_ADMIN_PASSWORD ??
      process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;

    if (!username || !password) {
      throw new Error(
        'Missing Keycloak admin credentials. ' +
        'Set KEYCLOAK_ADMIN_USERNAME / KEYCLOAK_ADMIN_PASSWORD ' +
        'or KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD.',
      );
    }

    // ── 1. Build the client pointed at the AUTH realm (master) ──────────────
    // IMPORTANT: the constructor realmName must be the realm where the
    // admin-cli client lives (master), NOT the target realm.
    // Using targetRealm here causes invalid_grant because admin-cli does
    // not exist in application realms (pa_frontoffice, migrants, …).
    const kcAdminClient = new KcAdminClient({
      baseUrl,
      realmName: authRealm, // always master
    });

    // ── 2. Authenticate against master/admin-cli ─────────────────────────────
    await kcAdminClient.auth({
      grantType: 'password',
      clientId,
      username,
      password,
    });

    // ── 3. Redirect to the target realm for all subsequent resource calls ────
    // setConfig() changes the realm used by .users, .roles, etc. without
    // re-authenticating. The token obtained in step 2 is still valid because
    // a master-realm admin token is accepted cross-realm by the Admin REST API.
    const operatingRealm = targetRealm ?? authRealm;
    if (operatingRealm !== authRealm) {
      kcAdminClient.setConfig({ realmName: operatingRealm });
    }

    this.logger.debug('[KeycloakAdminService.getClient] authenticated admin client', {
      baseUrl,
      authRealm,
      operatingRealm,
      clientId,
      username,
    });

    return kcAdminClient;
  }
}