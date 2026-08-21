import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';
import {attachPageDiagnostics} from '../helpers/diagnostics.mjs';
import {loginWithKeycloak} from '../helpers/keycloak-login.mjs';

/**
 * Browser login for the Keycloak Admin Console itself (master realm).
 *
 * Complements the existing API-only check in smoke/keycloak.spec.mjs (which
 * obtains a token via a direct password grant against admin-cli) by driving
 * the actual login form the way a human administrator would.
 */
test('Keycloak Admin Console: bootstrap admin can log in via the browser', async ({page}, testInfo) => {
  test.skip(
    !environment.keycloakAdminUsername || !environment.keycloakAdminPassword,
    'KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD are missing from the project .env.',
  );

  const diagnostics = attachPageDiagnostics(page, 'KEYCLOAK-LOGIN');
  try {
    const {claims, finalUrl} = await loginWithKeycloak({
      page,
      testInfo,
      label: 'KEYCLOAK-LOGIN',
      startUrl: `${environment.keycloakBaseUrl}/admin/master/console/`,
      username: environment.keycloakAdminUsername,
      password: environment.keycloakAdminPassword,
    });

    expect(claims.iss, 'Token was not issued by the master realm').toContain('/realms/master');
    expect(finalUrl, 'Did not land back on the Admin Console after login').toContain('/admin/master/console/');

    await expect(page.locator('body')).toBeVisible();
    const title = (await page.title()).trim();
    console.log(`[MICADO][KEYCLOAK-LOGIN] Console page title: ${title || '(empty)'}`);
    expect(title.toLowerCase(), 'Admin Console title does not mention Keycloak').toContain('keycloak');
  } finally {
    await diagnostics.attach(testInfo);
  }
});
