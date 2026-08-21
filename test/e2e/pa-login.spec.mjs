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
    const {claims} = await loginWithKeycloak({
      page,
      testInfo,
      label: 'PA-LOGIN',
      startUrl: `${environment.paBaseUrl}/profile`,
      username: environment.paAdminUsername,
      password: environment.paAdminPassword,
    });

    expect(claims.iss, 'Token was not issued by the pa_frontoffice realm').toContain('/realms/pa_frontoffice');
    expect(claims.realm_access?.roles ?? [], 'pa-admin token is missing the pa_admin role').toContain('pa_admin');

    // The redirect back from Keycloak still carries the OAuth params (state,
    // session_state, iss, code) at the instant the token exchange completes —
    // src/auth/keycloak.ts strips them asynchronously via history.replaceState
    // right after, so asserting on the full URL here is a race. Assert on the
    // rendered page first: it auto-retries, so it naturally waits out that
    // cleanup. src/pages/ProfilePage.vue renders these two lines verbatim from
    // the Pinia auth store — a stable, markup-independent success signal that
    // does not depend on any data-testid convention (none exists yet).
    await expect(page.getByText(/Authenticated:\s*true/)).toBeVisible();
    await expect(page.getByText(/Roles:.*pa_admin/)).toBeVisible();

    // Now that the page has settled, only the path is worth asserting on —
    // the query string is an implementation detail of when the cleanup ran.
    const landedPath = new URL(page.url()).pathname;
    expect(landedPath, `Did not land on /profile after login (was: ${page.url()})`).toBe('/profile');

    await saveKeycloakSession(page, 'pa-admin');
  } finally {
    await diagnostics.attach(testInfo);
  }
});
