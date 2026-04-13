import KcAdminClient from '@keycloak/keycloak-admin-client';
import {injectable, BindingScope, inject} from '@loopback/core';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';

/**
 * Thin Keycloak Admin client wrapper.
 *
 * Uses the global bootstrap admin account from the master realm so the backend
 * can administer the PA realm through the Keycloak Admin REST API.
 *
 * In this Compose setup the relevant defaults are:
 * - base URL: http://keycloak:8080
 * - admin realm: master
 * - admin username/password: KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD
 * - admin client id: admin-cli
 */
@injectable({scope: BindingScope.SINGLETON})
export class KeycloakAdminService {
  constructor(
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) {}

  async getClient(targetRealm?: string): Promise<KcAdminClient> {
    const baseUrl =
      process.env.KEYCLOAK_ADMIN_BASE_URL ??
      process.env.KEYCLOAK_INTERNAL_BASE ??
      'http://keycloak:8080';

    const adminRealm =
      process.env.KEYCLOAK_ADMIN_REALM ??
      process.env.KEYCLOAK_MASTER_REALM ??
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
        'Missing Keycloak admin credentials. Set KEYCLOAK_ADMIN_USERNAME / KEYCLOAK_ADMIN_PASSWORD or reuse KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD.',
      );
    }

    const kcAdminClient = new KcAdminClient({
      baseUrl,
      realmName: targetRealm ?? adminRealm,
    });

    await kcAdminClient.auth({
      grantType: 'password',
      clientId,
      username,
      password,
    });

    if (targetRealm) {
      kcAdminClient.setConfig({realmName: targetRealm});
    }

    this.logger.debug('[KeycloakAdminService] authenticated admin client', {
      baseUrl,
      adminRealm,
      targetRealm: targetRealm ?? adminRealm,
      clientId,
      username,
    });

    return kcAdminClient;
  }
}
