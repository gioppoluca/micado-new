# Complete business logic tests

These tests perform real operations against the development installation and
leave their data in place for inspection. They are skipped during the ordinary
suite unless explicitly enabled.

Build the test image once. This version adds the Node PostgreSQL client used by
step 3:

```bash
docker build -t micado-playwright:1.62.1 ./test/image
```

Run the first increment (PA login + draft creation + direct DB verification):

```bash
docker run --rm --init --ipc=host \
  --add-host=host.docker.internal:host-gateway \
  --add-host=pa.localhost:host-gateway \
  --add-host=auth.localhost:host-gateway \
  --add-host=api.localhost:host-gateway \
  --env-file .env \
  -e RUN_COMPLETE_BUSINESS_LOGIC=true \
  -v "${PWD}/test:/opt/micado-playwright/tests" \
  micado-playwright:1.62.1 \
  npx playwright test --config=tests/playwright.config.mjs \
    business/complete-information-lifecycle.spec.ts
```

The run always retains its Playwright trace and video. It also attaches
screenshots for each important UI transition, browser diagnostics and
`business-context.json`, which contains the unique marker and created item ID.
The console prints every flow transition and every successful assertion using
the prefixes `[MICADO][CBL][FLOW]` and `[MICADO][CBL][CHECK][PASS]`.

The database is reached through `host.docker.internal:5432`, which is the
host-published development port. The runner does not join the Compose network.
Override it only when necessary with `PLAYWRIGHT_DB_HOST` and
`PLAYWRIGHT_DB_PORT`.

All generated evidence is written below the host-mounted `test/results`
directory. The Playwright configuration resolves these paths from its own file
location rather than from the container working directory.
