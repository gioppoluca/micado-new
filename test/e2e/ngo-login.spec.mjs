import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';
import {attachPageDiagnostics} from '../helpers/diagnostics.mjs';
import {loginWithKeycloak, saveKeycloakSession} from '../helpers/keycloak-login.mjs';

/**
 * NGO frontend browser login.
 *
 * Verified against the real apps/ngo_frontoffice source: its router
 * (src/router/routes.ts) and ProfilePage.vue are identical to the PA app's —
 * /profile requires auth but no specific role, and renders the same two
 * auth-store lines. See pa-login.spec.mjs for the matching test.
 *
 * This replaces an earlier version of this test that logged in through
 * Keycloak's built-in Account Console (`/realms/ngo_frontoffice/account/`)
 * instead of the real ngo_frontoffice app client, because the actual
 * frontend route wasn't available yet. That was the wrong fix even though
 * the login itself succeeded: the Account Console authenticates through its
 * own built-in `account-console` client, which does not carry the realm's
 * custom roles the way the app's own `ngo_frontoffice` client does — hence
 * the token came back with an empty roles list. Always authenticate through
 * the actual client under test, not a Keycloak-provided stand-in.
 */
test('NGO frontend: ngo-admin can log in via Keycloak and reach a protected page', async ({page}, testInfo) => {
  test.skip(!environment.ngoAdminPassword, 'NGO_ADMIN_PASSWORD is missing from the project .env.');

  const diagnostics = attachPageDiagnostics(page, 'NGO-LOGIN');
  try {
    const {claims} = await loginWithKeycloak({
      page,
      testInfo,
      label: 'NGO-LOGIN',
      startUrl: `${environment.ngoBaseUrl}/profile`,
      username: environment.ngoAdminUsername,
      password: environment.ngoAdminPassword,
    });

    expect(claims.iss, 'Token was not issued by the ngo_frontoffice realm').toContain('/realms/ngo_frontoffice');
    expect(claims.realm_access?.roles ?? [], 'ngo-admin token is missing the ngo_admin role').toContain('ngo_admin');

    // Same race as PA: assert on the rendered page (auto-retries) before
    // checking the URL, and check only the path — see pa-login.spec.mjs.
    await expect(page.getByText(/Authenticated:\s*true/)).toBeVisible();
    await expect(page.getByText(/Roles:.*ngo_admin/)).toBeVisible();

    const landedPath = new URL(page.url()).pathname;
    expect(landedPath, `Did not land on /profile after login (was: ${page.url()})`).toBe('/profile');

    await saveKeycloakSession(page, 'ngo-admin');
  } finally {
    await diagnostics.attach(testInfo);
  }
});
