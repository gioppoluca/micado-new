import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';
import {attachPageDiagnostics} from '../helpers/diagnostics.mjs';
import {loginWithKeycloak} from '../helpers/keycloak-login.mjs';

/**
 * NGO frontend browser login.
 *
 * TEMPORARY SCOPE: apps/ngo_frontoffice was not available when this suite
 * was written, so — unlike pa-login.spec.mjs — this test does not know a
 * protected route in the NGO app itself to start from, and guessing one
 * (e.g. assuming it also has a public '/') risks a broken, hanging test.
 *
 * Instead it starts from Keycloak's own built-in Account Console for the
 * ngo_frontoffice realm (`/realms/ngo_frontoffice/account/`), which every
 * realm ships with by default and which always requires login. This proves
 * the real login form and ngo_admin role work end to end without depending
 * on any NGO frontend code.
 *
 * Once apps/ngo_frontoffice is available, mirror pa-login.spec.mjs instead:
 *   1. point startUrl at a real requiresAuth route in that app;
 *   2. add the equivalent rendered-page assertion, if one exists;
 *   3. add saveKeycloakSession(page, 'ngo-admin') for future page tests.
 */
test('NGO realm: ngo-admin can log in via Keycloak (Account Console)', async ({page}, testInfo) => {
  test.skip(!environment.ngoAdminPassword, 'NGO_ADMIN_PASSWORD is missing from the project .env.');

  const diagnostics = attachPageDiagnostics(page, 'NGO-LOGIN');
  try {
    const {claims} = await loginWithKeycloak({
      page,
      testInfo,
      label: 'NGO-LOGIN',
      startUrl: `${environment.keycloakBaseUrl}/realms/ngo_frontoffice/account/`,
      username: environment.ngoAdminUsername,
      password: environment.ngoAdminPassword,
    });

    expect(claims.iss, 'Token was not issued by the ngo_frontoffice realm').toContain('/realms/ngo_frontoffice');
    expect(claims.realm_access?.roles ?? [], 'ngo-admin token is missing the ngo_admin role').toContain('ngo_admin');
  } finally {
    await diagnostics.attach(testInfo);
  }
});
