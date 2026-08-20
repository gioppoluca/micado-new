# MICADO

MICADO is a containerised multilingual platform composed of three Quasar 2 / Vue 3 applications and a shared LoopBack 4 API. Docker Compose also provides identity, persistence, translations, analytics, text-to-speech and reverse-proxy services.

## Services

| Compose service | Purpose |
|---|---|
| `migrants` | Front office for migrants (`migrants` Keycloak realm). |
| `pa_frontoffice` | Back office for public-administration operators (`pa_frontoffice` realm). |
| `ngo_frontoffice` | Back office for NGO operators (`ngo_frontoffice` realm). |
| `backend` | Shared LoopBack 4 REST API, authorization, content workflows and integrations. |
| `db` | PostgreSQL 16 with PGroonga; separate schemas/users support MICADO, Keycloak, Gitea, Weblate, Umami and DBOS. |
| `keycloak` | Authentication and role-based access control for the three realms; realm definitions and custom themes are imported from `infrastructure/keycloak/`. |
| `traefik` | Single public entry point, host-based routing and TLS termination in production. |
| `gitea` | Internal Git repository used to exchange translation files. |
| `weblate` | Translation management UI connected to the Gitea repository. |
| `cache` | Persistent Redis cache used by Weblate. |
| `umami` | Privacy-focused analytics for the three frontends. |
| `piper` | Internal text-to-speech service; generated audio is shared with the backend. |
| `bootstrap-perms` | One-shot preparation of the shared bootstrap volume. |
| `gitea-init` | One-shot creation of Gitea users, repository and translation files. |
| `weblate-init` | One-shot creation/update of the Weblate project, components, languages and webhooks. |
| `umami-init` | One-shot registration of the three frontend websites in Umami. |
| `stack-ready` | Waits for the stack and prints its public URLs when every required service is ready. |

Initialisation and readiness services are orchestrated automatically and normally require no manual invocation.

## First-time setup

Create the local configuration before starting any service:

```bash
cp .env.example .env
```

Review every value in `.env`, especially passwords, application secrets, public domain, email configuration and Keycloak settings. The example values are suitable only for local development. With `BASE_DOMAIN=localhost`, development services use HTTP and `*.localhost` hostnames.

## Run the stack

Development uses the base Compose file plus the development override, with source bind mounts and live reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Production adds HTTPS, Let's Encrypt and production images:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

To rebuild only one application, replace `backend` below with the required service:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up backend --build
```

Stop the development stack without deleting persistent data:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

Use `down -v` only when a complete reset of all databases, configuration and generated data is intended.

### Useful development URLs

| URL | Destination |
|---|---|
| <http://migrants.localhost> | Migrants application |
| <http://pa.localhost> | PA application |
| <http://ngo.localhost> | NGO application |
| <http://api.localhost> | Backend API (`/explorer` for the OpenAPI Explorer) |
| <http://auth.localhost> | Keycloak |
| <http://git.localhost> | Gitea |
| <http://weblate.localhost> | Weblate |
| <http://analytics.localhost> | Umami |
| <http://traefik.localhost/#> | Traefik dashboard (development only) |

PostgreSQL is additionally exposed on `localhost:5432` by the development override. Piper, Redis and the initialisation services are internal-only.

## Focused development

For backend work without real authentication, enable the documented dummy-auth variables in `.env`, then start the required subset:

```dotenv
AUTH_DISABLE_KEYCLOAK=true
AUTH_DUMMY_ROLES=pa_admin
AUTH_DUMMY_USERNAME=dev.user
```

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up traefik db backend --build
```

Remove `AUTH_DISABLE_KEYCLOAK` or set it to `false` before validating login and role-based access. Compose may still start transitive dependencies required by `backend`; this is expected.

## Persistence and initialisation

Database bootstrap scripts in `infrastructure/postgres/init/` run only when the PostgreSQL volume is first created:

- `010-app-schema.sql` creates the application schema;
- `020-app-seed.sql` creates initial application data;
- `030-app-test-seed.sql` contains optional test data.

Future migrations belong in `infrastructure/postgres/migrations/`; they are not currently applied automatically. Named volumes retain PostgreSQL, Keycloak, Gitea, Weblate, Piper, Redis and bootstrap data between restarts.

The translation bootstrap creates the Gitea repository and Weblate project/components before the backend starts. Weblate then reads and writes translation files through Gitea, while backend workflows handle application-side import/export and retries.

## Tests

The Playwright suite verifies the public applications, API, authentication and infrastructure endpoints. It reuses the project `.env` and supports local or self-signed HTTPS environments.

See **[test/README.md](test/README.md)** for the current commands, coverage and generated reports.

## Logging

Set `LOG_LEVEL` and `FRONTEND_LOG_LEVEL` in `.env` to `debug`, `info`, `warn` or `error`. For container output use:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f [service]
```
