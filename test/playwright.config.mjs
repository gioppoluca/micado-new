import {defineConfig} from '@playwright/test';

// Paths are resolved from /opt/micado-playwright/tests, where test/ is mounted.
const resultsDirectory = './results';
const baseDomain = process.env.BASE_DOMAIN?.trim() || 'localhost';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'smoke/**/*.spec.mjs',
    'api/**/*.spec.{mjs,ts}',
    'e2e/**/*.spec.{mjs,ts}',
  ],
  outputDir: `${resultsDirectory}/artifacts`,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {timeout: 10_000},
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['line'],
    ['html', {outputFolder: `${resultsDirectory}/html`, open: 'never'}],
    ['junit', {outputFile: `${resultsDirectory}/junit/results.xml`}],
  ],
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      // Chromium resolves *.localhost to its own loopback. Always route the
      // compose public domain to the Docker host where Traefik is exposed.
      args: [`--host-resolver-rules=MAP *.${baseDomain} host.docker.internal`],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
});
