import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';
import {logAccessTokenEvidence} from '../helpers/token.mjs';

const realms = ['migrants', 'pa_frontoffice', 'ngo_frontoffice'];

test.describe('Keycloak smoke tests', () => {
  for (const realm of realms) {
    test(`realm discovery: ${realm}`, async ({request}) => {
      const url = `${environment.keycloakBaseUrl}/realms/${realm}/.well-known/openid-configuration`;
      console.log(`[MICADO][KEYCLOAK] GET ${url}`);

      const response = await request.get(url);
      console.log(`[MICADO][KEYCLOAK] ${realm}: HTTP ${response.status()}`);
      expect(response.ok()).toBeTruthy();

      const discovery = await response.json();
      expect(discovery.issuer).toContain(`/realms/${realm}`);
      expect(discovery.authorization_endpoint).toBeTruthy();
      expect(discovery.token_endpoint).toBeTruthy();
      expect(discovery.jwks_uri).toBeTruthy();
      console.log(`[MICADO][KEYCLOAK][SUCCESS] Realm ${realm} is enabled and publishes valid OIDC metadata`);
    });
  }

  test('bootstrap admin can obtain a token and list MICADO realms', async ({request}) => {
    const username = environment.keycloakAdminUsername;
    const password = environment.keycloakAdminPassword;
    test.skip(
      !username || !password,
      'KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD are missing from the project .env.',
    );

    console.log('[MICADO][KEYCLOAK] Requesting master realm admin token');
    const tokenResponse = await request.post(
      `${environment.keycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
      {
        form: {
          grant_type: 'password',
          client_id: 'admin-cli',
          username,
          password,
        },
      },
    );
    expect(tokenResponse.ok()).toBeTruthy();
    const {access_token: accessToken} = await tokenResponse.json();
    expect(accessToken).toBeTruthy();

    const claims = logAccessTokenEvidence(accessToken);
    expect(claims.iss).toContain('/realms/master');
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    console.log('[MICADO][KEYCLOAK][SUCCESS] A valid, non-expired master admin token was obtained');

    const realmsResponse = await request.get(`${environment.keycloakBaseUrl}/admin/realms`, {
      headers: {Authorization: `Bearer ${accessToken}`},
    });
    console.log(`[MICADO][KEYCLOAK] Admin realm list: HTTP ${realmsResponse.status()}`);
    expect(realmsResponse.ok()).toBeTruthy();

    const realmNames = (await realmsResponse.json()).map(realm => realm.realm);
    for (const realm of realms) expect(realmNames).toContain(realm);
    console.log(`[MICADO][KEYCLOAK][SUCCESS] Admin API returned all MICADO realms: ${realms.join(', ')}`);
  });
});
