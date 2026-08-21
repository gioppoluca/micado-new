import {expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {logAccessTokenEvidence} from './token.mjs';

/**
 * Drives a real Keycloak login form (Authorization Code + PKCE, the flow
 * every MICADO client uses — direct access grants are disabled) and proves
 * it succeeded by observing the actual code→token exchange on the wire,
 * the same `page.waitForResponse` pattern already used in
 * smoke/default-language-bootstrap.spec.mjs.
 *
 * This does NOT depend on any frontend markup: it works identically for the
 * Keycloak Admin Console (master realm) and for every MICADO app, because
 * Keycloak's login form keeps the same field ids in every theme — custom or
 * default (see infrastructure/keycloak/themes/*\/login/login.ftl:
 * #username, #password, #kc-login).
 *
 * @param {object} params
 * @param {import('@playwright/test').Page} params.page
 * @param {import('@playwright/test').TestInfo} [params.testInfo]
 * @param {string} params.label     - log/attachment prefix, e.g. "PA-LOGIN"
 * @param {string} params.startUrl  - a protected URL that triggers the Keycloak redirect
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} [params.tokenUrlPattern] - substring the token endpoint URL must contain
 * @returns {Promise<{claims: object, finalUrl: string}>}
 */
export async function loginWithKeycloak({
  page,
  testInfo,
  label,
  startUrl,
  username,
  password,
  tokenUrlPattern = '/protocol/openid-connect/token',
}) {
  console.log(`[MICADO][${label}] Opening ${startUrl}`);

  // Attach the listener BEFORE navigating: the redirect to Keycloak, the
  // form submit and the code-for-token exchange can all happen before we'd
  // otherwise get a chance to start waiting for the response.
  const tokenResponsePromise = page.waitForResponse(
    response => response.url().includes(tokenUrlPattern) && response.request().method() === 'POST',
    {timeout: 20_000},
  );

  await page.goto(startUrl, {waitUntil: 'domcontentloaded'});

  console.log(`[MICADO][${label}] Waiting for the Keycloak login form`);
  const usernameField = page.locator('#username');
  await usernameField.waitFor({state: 'visible'});
  await usernameField.fill(username);
  await page.locator('#password').fill(password);

  console.log(`[MICADO][${label}] Submitting credentials for "${username}"`);
  await page.locator('#kc-login').click();

  const tokenResponse = await tokenResponsePromise;
  console.log(`[MICADO][${label}] Token endpoint responded HTTP ${tokenResponse.status()}`);
  expect(tokenResponse.ok(), `${label}: the Keycloak token endpoint did not return a 2xx response`).toBeTruthy();

  const body = await tokenResponse.json();
  expect(body.access_token, `${label}: token response had no access_token`).toBeTruthy();

  const claims = logAccessTokenEvidence(body.access_token);

  // Let the app finish handling the redirect (URL cleanup, store update, render).
  await page.waitForLoadState('networkidle');
  const finalUrl = page.url();
  console.log(`[MICADO][${label}] Final URL after login: ${finalUrl}`);

  if (testInfo) {
    await testInfo.attach(`${label.toLowerCase()}-token-claims.json`, {
      body: Buffer.from(JSON.stringify(claims, null, 2)),
      contentType: 'application/json',
    });
  }

  const roles = claims.realm_access?.roles ?? [];
  console.log(`[MICADO][${label}][SUCCESS] Authenticated as "${username}" — roles: ${roles.join(', ') || 'none'}`);

  return {claims, finalUrl};
}

/**
 * Persists the browser context's cookies — including the Keycloak SSO
 * session cookie set on the auth.* origin — so a later test file can reuse
 * this authenticated session instead of driving the login form again.
 *
 * Why this works with this codebase's Keycloak setup specifically: the apps
 * do not call kc.init({onLoad: 'check-sso'}), so a fresh page load never
 * auto-authenticates by itself. But when a later test navigates to a
 * `requiresAuth` route, the router guard still calls keycloak.login(), which
 * redirects to Keycloak. Because the SSO cookie captured here is still
 * present, Keycloak skips the login form entirely and redirects straight
 * back with a fresh code — no credentials re-entered, no login UI shown.
 * This is Playwright's standard storageState-reuse pattern
 * (https://playwright.dev/docs/auth) applied to Keycloak's own SSO session.
 *
 * Usage in a future page-functionality test:
 *   test.use({storageState: 'test/.auth/pa-admin.json'});
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - storage state file name, without extension, e.g. "pa-admin"
 * @returns {Promise<string>} the written file path
 */
export async function saveKeycloakSession(page, name) {
  const dir = '.auth';
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${name}.json`);
  await page.context().storageState({path: file});
  console.log(`[MICADO][AUTH] Saved session for reuse by future tests: ${file}`);
  return file;
}
