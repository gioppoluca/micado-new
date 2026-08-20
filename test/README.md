# MICADO Playwright tests

The test runner uses the same `.env` as Docker Compose. No `.env.test` file and
no test-specific environment variables are required.

## Environment mapping

The tests reuse:

- `BASE_DOMAIN` to construct every Traefik public URL;
- `KC_BOOTSTRAP_ADMIN_USERNAME` for the Keycloak master administrator;
- `KC_BOOTSTRAP_ADMIN_PASSWORD` for the administrator password.

When `BASE_DOMAIN=localhost`, URLs use HTTP. For any other domain they use HTTPS;
self-signed certificates are accepted through `ignoreHTTPSErrors`.

## Run all public-service tests

For the current development domain `localhost`:

```powershell
docker run --rm --init --ipc=host `
  --add-host host.docker.internal:host-gateway `
  --add-host auth.localhost:host-gateway `
  --add-host api.localhost:host-gateway `
  --env-file ./.env `
  -v "${PWD}/test:/opt/micado-playwright/tests" `
  micado-playwright:1.0.0

docker run --rm --init --ipc=host --add-host auth.localhost:host-gateway --add-host api.localhost:host-gateway --add-host migrants.localhost:host-gateway --add-host host.docker.internal:host-gateway --env-file ./.env -v "${PWD}/test:/opt/micado-playwright/tests" micado-playwright:1.0.0
```

The two explicit `auth.localhost` and `api.localhost` mappings are needed by
Playwright's Node HTTP client. Chromium maps every `*.${BASE_DOMAIN}` browser
destination to `host.docker.internal` automatically.

If `BASE_DOMAIN` changes, update the two `--add-host` names accordingly; no test
configuration file needs to change.

## Coverage

- LoopBack `/ping`;
- OIDC discovery for the three Keycloak realms;
- Keycloak bootstrap-admin token and Admin API realm listing;
- Keycloak Admin Console;
- Migrants, PA and NGO;
- Gitea, Weblate, Umami and Traefik dashboard.

Every successful verification prints `[MICADO][SERVICE][SUCCESS]`.
The Keycloak test prints the complete short-lived access token as explicitly
requested; treat the console output as sensitive until the token expires.

## Results

- `test/results/html/index.html`: HTML report;
- `test/results/junit/results.xml`: JUnit report;
- `test/results/artifacts/`: traces, screenshots, videos and attachments.

The complete project `.env` is passed to this local, disposable test container.
Do not publish console output or test artifacts containing sensitive information.
