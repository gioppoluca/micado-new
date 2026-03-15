# MICADO

Three Vue SPAs (migrants, PA, NGO) backed by a LoopBack 4 API, Keycloak for auth, PGroonga/Postgres, Traefik as the reverse proxy, and Weblate + Gitea for translation management.

## Stack

| Service | Role |
|---|---|
| `backend` | LoopBack 4 REST API, port 3000 |
| `pa_frontoffice` | Vue 3 / Quasar SPA for PA operators |
| `migrants` | Vue 3 / Quasar SPA for migrants |
| `ngo_frontoffice` | Vue 3 / Quasar SPA for NGO operators |
| `db` | PGroonga (Postgres + full-text search extension) |
| `keycloak` | Auth server, realm import on startup |
| `cache` | Redis, used by Weblate |
| `traefik` | Reverse proxy / routing for all services |
| `gitea` | Internal Git server for translation files |
| `weblate` | Translation management UI |

## First-time setup

```bash
cp .env.example .env
# edit .env and fill in passwords / domains
```

Dev compose uses `BASE_DOMAIN=localhost` so all services are reachable at `*.localhost`.

## Dev hostnames

| URL | Service |
|---|---|
| http://api.localhost | Backend API + `/explorer` (LoopBack UI) |
| http://auth.localhost | Keycloak admin console |
| http://pa.localhost | PA frontoffice |
| http://migrants.localhost | Migrants app |
| http://ngo.localhost | NGO app |
| http://git.localhost | Gitea |
| http://weblate.localhost | Weblate |
| http://traefik.localhost:8088 | Traefik dashboard (dev only) |

---

## How to develop

All dev commands combine the base compose file with the dev override, which swaps production builds for bind-mounted live-reload containers:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up [services] [flags]
```

### Scenario 1 — Backend only, no real auth

The fastest setup for working on backend APIs. The backend runs with a dummy user profile — no Keycloak token needed.

In `.env`, uncomment:
```
AUTH_DISABLE_KEYCLOAK=true
AUTH_DUMMY_ROLES=pa_admin
AUTH_DUMMY_USERNAME=dev.user
```

Then start:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up traefik db backend --build
```

> Keycloak will also start because it is listed in the backend's `depends_on`. It runs in the background and is completely ignored while `AUTH_DISABLE_KEYCLOAK=true`. You can test every API endpoint via the LoopBack explorer at http://api.localhost/explorer without needing a token.

To fake a different role, change `AUTH_DUMMY_ROLES` to `pa_operator` and restart the backend container.

### Scenario 2 — PA frontoffice + backend + real auth

For testing the full auth flow: login, token, role-based access.

Make sure `AUTH_DISABLE_KEYCLOAK` is **not set** (or set to `false`) in `.env`.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up traefik db keycloak backend pa_frontoffice --build
```

Open http://pa.localhost. Keycloak realms are imported automatically on first boot — the PA realm is `pa_frontoffice`, roles are `pa_admin` and `pa_operator`.

> First boot of Keycloak takes ~60-90 seconds. Subsequent starts are faster because data is persisted in the `keycloak_data` volume.

### Scenario 3 — Full stack

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This starts everything including Gitea, Weblate, and their init containers. Weblate and Gitea init are designed to be resilient: if Gitea or Weblate is temporarily unreachable the workflow will retry. You do not need them running to develop backend or frontend features.

### Rebuilding a single service

Hot reload handles most changes. When you change a `Dockerfile` or `package.json`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up backend --build
```

### Stopping without losing volumes

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
# volumes are kept — db data, keycloak config, etc. survive

# to also wipe volumes (full reset):
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

---

## Database

The DB init scripts in `infrastructure/postgres/init/` run once on first boot:
- `010-app-schema.sql` — creates schemas and tables
- `020-app-seed.sql` — seeds languages, default settings, feature flags

SQL migrations go in `infrastructure/postgres/migrations/` following the naming convention `0001__description.sql`. They are not applied automatically — run them manually or wire them into a migration step.

Postgres is exposed on `localhost:5432` in dev (see the `db` service in `docker-compose.dev.yml`).

## Translation workflow (Weblate + Gitea)

The backend pushes translation entries to a Gitea repo; Weblate picks them up from there. The workflow is designed to tolerate Gitea or Weblate being down: operations are queued via DBOS and retried automatically. Gitea and Weblate do not need to be running during normal backend or frontend development.

## Logging

Set `LOG_LEVEL` in `.env` for backend log verbosity (`debug` | `info` | `warn` | `error`).

Frontend log level is controlled by `FRONTEND_LOG_LEVEL` (same values).
