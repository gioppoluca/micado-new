import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';
import {attachPageDiagnostics} from '../helpers/diagnostics.mjs';
import {loginWithKeycloak, saveKeycloakSession} from '../helpers/keycloak-login.mjs';

/**
 * PA frontend browser login.
 *
 * /profile requires auth (src/router/routes.ts) but no specific role, so the
 * router guard (src/boot/router-guard.ts) redirects any unauthenticated
 * visitor straight to the pa_frontoffice Keycloak login — no button click
 * needed to trigger it.
 *
 * The session saved at the end is meant to be reused by future
 * page-functionality tests via:
 *   test.use({storageState: 'test/.auth/pa-admin.json'});
 * See helpers/keycloak-login.mjs for why that works with this app's
 * Keycloak setup (no onLoad: 'check-sso', SSO cookie reuse instead).
 */
test('PA frontend: pa-admin can log in via Keycloak and reach a protected page', async ({page}, testInfo) => {
  test.skip(!environment.paAdminPassword, 'PA_ADMIN_PASSWORD is missing from the project .env.');

  const diagnostics = attachPageDiagnostics(page, 'PA-LOGIN');
  try {
    const {claims, finalUrl} = await loginWithKeycloak({
      page,
      testInfo,
      label: 'PA-LOGIN',
      startUrl: `${environment.paBaseUrl}/profile`,
      username: environment.paAdminUsername,
      password: environment.paAdminPassword,
    });

    expect(claims.iss, 'Token was not issued by the pa_frontoffice realm').toContain('/realms/pa_frontoffice');
    expect(claims.realm_access?.roles ?? [], 'pa-admin token is missing the pa_admin role').toContain('pa_admin');
    expect(finalUrl, 'Did not land back on /profile after login').toBe(`${environment.paBaseUrl}/profile`);

    // src/pages/ProfilePage.vue renders these two lines verbatim from the
    // Pinia auth store — a stable, markup-independent success signal that
    // does not depend on any data-testid convention (none exists yet).
    await expect(page.getByText(/Authenticated:\s*true/)).toBeVisible();
    await expect(page.getByText(/Roles:.*pa_admin/)).toBeVisible();

    await saveKeycloakSession(page, 'pa-admin');
  } finally {
    await diagnostics.attach(testInfo);
  }
});
