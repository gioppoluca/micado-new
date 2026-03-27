/**
 * src/index.ts
 *
 * Application entry point.
 *
 * Body-size limit
 * ---------------
 * Icons are stored as base64 data-URLs inside the `dataExtra.icon` JSON field.
 * A 200 KB source image becomes ~267 KB as base64; a 500 KB source becomes ~667 KB.
 * The default Express body-parser limit is 100 KB which causes HTTP 413
 * "PayloadTooLargeError: request entity too large" for any non-trivial image.
 *
 * We raise it to 2 MB — enough for any icon (which should always be small), but
 * still a firm guard against accidental multi-MB payloads.  The frontend
 * validates file size before encoding (see onIconSelected in UserTypesPage.vue),
 * so in practice this limit is only the last-resort safety net.
 *
 * The limit is configurable via the BODY_SIZE_LIMIT env var so it can be
 * tightened in production without a code change.
 *
 * LB4 API reference:
 *   ApplicationConfig.rest.expressSettings['trust proxy'] — standard Express key
 *   ApplicationConfig.rest.requestBodyParser — passed to body-parser under the hood
 *   See: @loopback/rest / packages/rest/src/rest.application.ts
 */

import { ApplicationConfig, MicadoBackend } from './application';

export * from './application';

export async function main(options: ApplicationConfig = {}): Promise<MicadoBackend> {
  const app = new MicadoBackend(options);
  await app.boot();
  await app.start();

  const url = app.restServer.url;
  console.log(`Server is running at ${url}`);
  console.log(`Try ${url}/ping`);

  return app;
}

if (require.main === module) {
  // ── Body size limit ──────────────────────────────────────────────────────
  // Read from env so Ops can adjust without a rebuild.
  // Default: 2 MB — comfortably handles base64-encoded icons up to ~1.5 MB.
  // Keep this well below Traefik's own limit (configured via
  // traefik.http.middlewares.*.buffering.maxRequestBodyBytes).
  const bodySizeLimit = process.env.BODY_SIZE_LIMIT ?? '2mb';

  const config: ApplicationConfig = {
    rest: {
      port: +(process.env.PORT ?? 3000),
      host: process.env.HOST || '0.0.0.0',
      gracePeriodForClose: 5000, // 5 seconds

      openApiSpec: {
        // useful when used with OpenAPI-to-GraphQL to locate your application
        setServersFromRequest: true,
      },

      // ── Raise the body-parser limit for JSON payloads ──────────────────
      // This is the standard LoopBack 4 way to configure body-parser limits.
      // Both 'json' and 'text' parsers must be updated; 'urlencoded' is kept
      // at its 100 KB default since forms are not used for icon uploads.
      requestBodyParser: {
        json: {
          limit: bodySizeLimit,
        },
        text: {
          limit: bodySizeLimit,
        },
      },
    },
  };

  main(config).catch((err: unknown) => {
    console.error('Cannot start the application.', err);
    process.exit(1);
  });
}