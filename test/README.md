# MICADO Playwright tests

This directory contains the system-level Playwright suites for the running MICADO Docker Compose stack:

- `smoke/`: public infrastructure, frontend, backend and Keycloak availability;
- `api/backend/`: LoopBack API workflows, including complete CRUD, revision and translation scenarios;
- `e2e/`: browser workflows added by the three frontends.

LoopBack unit and in-process acceptance tests remain in `apps/backend/src/__tests__` and are executed from the backend package with `npm test`.

## Test image

The custom runner pins the Playwright package and official browser image to the same version. Rebuild it after changing `test/image/Dockerfile`:

```powershell
docker build --pull `
  --build-arg PLAYWRIGHT_VERSION=1.62.1 `
  -t micado-playwright:1.62.1 `
  ./test/image
```

Do not independently change only the base-image tag or only `@playwright/test`: their versions must match.

## Environment and URLs

The runner receives the same root `.env` used by Docker Compose. It uses:

- `BASE_DOMAIN` to build every public URL;
- `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` for the Keycloak master-realm smoke test;
- `API_BASE_URL`, when provided, instead of the default `http://api.localhost`.

With `BASE_DOMAIN=localhost`, tests use HTTP. Other domains use HTTPS and self-signed certificates are accepted. Chromium maps browser requests for `*.BASE_DOMAIN` to the Docker host; `auth.BASE_DOMAIN` and `api.BASE_DOMAIN` are also mapped explicitly for Playwright's API client.

## Recommended API-test mode

The complete CRUD suite should normally run with backend dummy authentication. This tests API persistence, authorization roles and content workflows without making hundreds of API cases depend on token expiry or the Keycloak login UI.

Enable these values in the root `.env`:

```dotenv
AUTH_DISABLE_KEYCLOAK=true
AUTH_DUMMY_ROLES=pa_admin
AUTH_DUMMY_USERNAME=playwright.admin
AUTH_DUMMY_SUB=playwright-admin
```

Then recreate the backend so it receives the changed environment:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml `
  up -d --build --force-recreate backend
```

Keycloak remains running and is still checked by the smoke suite. Dummy authentication is rejected by the backend when `NODE_ENV` or `APP_ENV` is `production`.

## Run all standard tests

Run this command from the project root:

```powershell
docker run --rm --init --ipc=host `
  --add-host host.docker.internal:host-gateway `
  --add-host auth.localhost:host-gateway `
  --add-host api.localhost:host-gateway `
  --env-file ./.env `
  -v "${PWD}/test:/opt/micado-playwright/tests" `
  micado-playwright:1.62.1
```

This executes infrastructure smoke tests and all standard backend API specifications sequentially. The single worker is intentional because the API tests mutate shared database state.

If `BASE_DOMAIN` is not `localhost`, replace the two explicit `auth.localhost` and `api.localhost` host mappings with the corresponding domain names.

## Run a subset

Specifying a filter replaces the image's default command, so include the complete Playwright command:

```powershell
# Backend API suite
docker run --rm --init --ipc=host `
  --add-host host.docker.internal:host-gateway `
  --add-host auth.localhost:host-gateway `
  --add-host api.localhost:host-gateway `
  --env-file ./.env `
  -v "${PWD}/test:/opt/micado-playwright/tests" `
  micado-playwright:1.62.1 `
  npx playwright test --config=tests/playwright.config.mjs api/backend
```

To execute one file, use the same command and replace the final `api/backend` filter with `api/backend/categories.spec.ts`. Other useful filters are:

| Filter | Coverage |
|---|---|
| `smoke` | Infrastructure, public applications and Keycloak |
| `api/backend` | All standard LoopBack API tests |
| `api/backend/categories.spec.ts` | One API specification |
| `--grep "CRUD"` | Tests whose title contains `CRUD` |

## Real-Keycloak opt-in suites

Some administration cases deliberately require real PA admin/operator tokens and are skipped during the standard dummy-auth run:

- `RUN_MIGRANT_MGMT_E2E=true`;
- `RUN_KEYCLOAK_PA_USERS_E2E=true`.

For these suites, set `AUTH_DISABLE_KEYCLOAK=false`, recreate the backend, and pass short-lived tokens through the process environment:

```text
E2E_TOKEN_ADMIN
E2E_TOKEN_OPERATOR
E2E_TOKEN_PA_ADMIN
E2E_MIGRANT_USER_ID        # optional; resolved from the users list when possible
```

The PA client uses the Authorization Code flow and has Direct Access Grants disabled. Do not enable password grants merely for the tests. Obtain tokens through the normal Keycloak login flow and never store them in `.env`, source control, console transcripts or published artifacts.

## Coverage

The current suites cover:

- LoopBack health and public endpoints;
- OIDC discovery for all three realms and the Keycloak Admin API;
- Migrants, PA, NGO, Gitea, Weblate, Umami and the Traefik dashboard;
- content CRUD, filtering, relations, revisions, translations and publishing;
- languages, processes and translation webhook workflows;
- opt-in PA and migrant administration/authorization flows.

Every successful infrastructure verification prints `[MICADO][SERVICE][SUCCESS]`.

## Results

- `test/results/html/index.html`: unified HTML report;
- `test/results/junit/results.xml`: JUnit report;
- `test/results/artifacts/`: traces, screenshots, videos and attachments.

The mounted `test/` directory must remain writable so the container can update these reports. Treat tokens, console output and test artifacts as sensitive.
