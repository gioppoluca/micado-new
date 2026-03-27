/**
 * playwright.config.ts  —  backend API test suite
 *
 * These are pure HTTP API tests (no browser).  Playwright's APIRequestContext
 * is used to send JSON requests directly to the running backend.
 *
 * ── How to run ───────────────────────────────────────────────────────────────
 *
 *   # With a real backend (Docker Compose stack up):
 *   API_BASE_URL=http://api.localhost \
 *   E2E_TOKEN_ADMIN=<pa-admin-jwt> \
 *   npx playwright test
 *
 *   # Filter to a single file:
 *   npx playwright test tests/api/user-types.spec.ts
 *
 * ── Token acquisition ────────────────────────────────────────────────────────
 *
 *   Obtain a short-lived token from Keycloak for the pa-admin user:
 *
 *   export E2E_TOKEN_ADMIN=$(curl -s \
 *     -d "grant_type=password" \
 *     -d "client_id=micado-backend" \
 *     -d "username=pa-admin" \
 *     -d "password=<password>" \
 *     http://auth.localhost/realms/pa_frontoffice/protocol/openid-connect/token \
 *     | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
 *
 * ── CI usage ─────────────────────────────────────────────────────────────────
 *
 *   Set these secrets in your CI environment:
 *     API_BASE_URL      — e.g. http://api.localhost (Traefik host inside CI network)
 *     E2E_TOKEN_ADMIN   — pre-obtained PA admin JWT (rotate on each run via script above)
 *
 *   Recommended: add a CI setup step that calls the token endpoint and exports
 *   E2E_TOKEN_ADMIN before running `npx playwright test`.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
    // Only API tests — no browser launch needed.
    testDir: './tests',

    // Glob pattern: all spec files under tests/api/
    testMatch: '**/*.spec.ts',

    // No parallelism by default: API tests mutate shared DB state.
    // Increase workers when tests are isolated (each test cleans up after itself).
    workers: 1,

    // Each individual test has 30 s — enough for network + DB round-trips.
    timeout: 30_000,

    // Retry once on flaky network conditions in CI; 0 locally for fast feedback.
    retries: process.env.CI ? 1 : 0,

    // Emit a single HTML report after the run.
    reporter: [
        ['list'],                              // live output during the run
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],

    use: {
        // Base URL for all api.* calls.  Overridden by the API_BASE_URL env var.
        baseURL: process.env.API_BASE_URL ?? 'http://api.localhost',

        // Fail fast on unexpected status codes rather than silently continuing.
        ignoreHTTPSErrors: false,

        // Extra headers applied to every APIRequestContext created via `request`.
        // The token is set per-test (each spec reads E2E_TOKEN_ADMIN directly)
        // because some tests may need different roles in the future.
        extraHTTPHeaders: {
            'Content-Type': 'application/json',
        },
    },
});