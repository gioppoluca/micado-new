# MICADO

MICADO is a containerized multilingual platform composed of three Quasar 2 /
Vue 3 applications and a shared LoopBack 4 API. Docker Compose also provides
identity, persistence, translations, analytics, text-to-speech and reverse
proxy services.

Everything required to run the platform is started with Docker Compose. You do
not need to install Node.js, PostgreSQL, Keycloak, Weblate or the frontend tools
on the host.

### Services

| Compose service | Purpose |
|---|---|
| `migrants` | Migrants front office using the `migrants` Keycloak realm. |
| `pa_frontoffice` | Public-administration back office using the `pa_frontoffice` realm. |
| `ngo_frontoffice` | NGO back office using the `ngo_frontoffice` realm. |
| `backend` | Shared LoopBack 4 REST API, authorization, content workflows and integrations. |
| `db` | PostgreSQL 16 with PGroonga and separate service schemas and roles. |
| `keycloak` | Authentication and role-based access control for the three realms. |
| `traefik` | Public entry point, host-based routing and production TLS termination. |
| `gitea` | Internal Git repository used to exchange translation files. |
| `weblate` | Translation management UI connected to Gitea. |
| `cache` | Persistent Redis cache used by Weblate. |
| `umami` | Privacy-focused analytics for the three frontends. |
| `piper` | Text-to-speech service sharing generated audio with the backend. |
| `bootstrap-perms` | One-shot preparation of the shared bootstrap volume. |
| `gitea-init` | One-shot creation of Gitea users, repository and translation files. |
| `weblate-init` | One-shot creation/update of Weblate projects, components, languages and webhooks. |
| `umami-init` | One-shot registration of the three frontend websites in Umami. |
| `stack-ready` | Waits for required services and prints the public URLs. |

Initialization and readiness services are orchestrated automatically. Do not
start or rerun them manually during an ordinary installation.

> [!IMPORTANT]
> Do not run `docker compose up` with only `docker-compose.yml`. Always combine
> it with either `docker-compose.dev.yml` or `docker-compose.prod.yml`, as shown
> below.

## 1. Choose the correct installation mode

| Mode | Intended use | Compose files | Public protocol |
|---|---|---|---|
| Development | Local development and testing | `docker-compose.yml` + `docker-compose.dev.yml` | HTTP |
| Production | Public deployment with a real domain | `docker-compose.yml` + `docker-compose.prod.yml` | HTTPS with Let's Encrypt |

If you are installing MICADO on a workstation, including Windows with WSL2,
use the development instructions first.

## 2. Prerequisites

### Linux

Install:

- Git;
- Docker Engine;
- Docker Compose v2, available through the `docker compose` command.

Confirm that Docker is running and accessible by your user:

```bash
git --version
docker version
docker compose version
docker run --rm hello-world
```

Do not continue until all four commands succeed.

### Windows 11 with WSL2

The recommended setup is:

1. Install Docker Desktop.
2. Enable **Use the WSL 2 based engine** in Docker Desktop.
3. Enable integration for your Ubuntu distribution under **Settings →
   Resources → WSL integration**.
4. Open an Ubuntu/WSL terminal.
5. Run all Git and Docker commands from that WSL terminal.

Verify the installation inside WSL:

```bash
git --version
docker version
docker compose version
docker run --rm hello-world
```

Clone the project into the WSL Linux filesystem, for example under
`~/projects`. Avoid `/mnt/c`, `/mnt/d` and other Windows-mounted paths. Native
WSL paths provide more predictable permissions, Linux line endings and better
filesystem performance for containerized Node.js applications.

## 3. Obtain the complete project

Clone the repository and enter its root directory:

```bash
mkdir -p ~/projects
cd ~/projects
git clone <repository-url> micado
cd micado
```

Replace `<repository-url>` with the actual Git repository URL.

The complete checkout must contain at least:

```text
micado/
├── apps/
│   ├── backend/
│   ├── migrants/
│   ├── pa_frontoffice/
│   ├── ngo_frontoffice/
│   └── piper/
├── infrastructure/
├── test/
├── .env.example
├── docker-compose.yml
├── docker-compose.dev.yml
└── docker-compose.prod.yml
```

Verify the checkout before continuing:

```bash
test -f docker-compose.yml
test -f docker-compose.dev.yml
test -f .env.example
test -d apps/backend
test -d apps/migrants
test -d apps/pa_frontoffice
test -d apps/ngo_frontoffice
test -d apps/piper
test -d infrastructure/postgres/init
echo "Project structure OK"
```

If any `test` command fails, the checkout or distribution package is
incomplete. An infrastructure-only archive cannot build the full platform.

## 4. Protect Linux scripts from Windows line endings

The repository must contain a committed `.gitattributes` file with at least:

```gitattributes
*.sh   text eol=lf
*.sql  text eol=lf
*.yml  text eol=lf
*.yaml text eol=lf
.env*  text eol=lf
```

This makes Git check out shell scripts with Linux LF endings even when a user's
global Git configuration enables `core.autocrlf`.

Check the scripts before the first startup:

```bash
if grep -rIl $'\r' infrastructure --include='*.sh' | grep -q .; then
  echo "ERROR: one or more shell scripts use Windows CRLF endings"
  grep -rIl $'\r' infrastructure --include='*.sh'
  exit 1
else
  echo "Shell script line endings OK"
fi
```

If files were already converted to CRLF, normalize them once:

```bash
find infrastructure -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
```

The PostgreSQL error `env: 'bash\r': No such file or directory` always means
that the executed shell script has CRLF line endings. It is not caused by
PostgreSQL credentials or `.env` values.

## 5. Development installation

Run all commands in this section from the project root, where
`docker-compose.yml` is located.

### 5.1 Create the local environment file

Copy the provided example:

```bash
cp .env.example .env
```

For a local `localhost` installation, the example values are sufficient to
bootstrap the database and start the services. Confirm this value is present:

```dotenv
BASE_DOMAIN=localhost
```

The example contains deliberately weak development passwords and placeholder
email addresses. They must never be reused for a public deployment.

Several database identifiers are fixed by the current bootstrap scripts and
service configuration. Leave these values unchanged unless the corresponding
Compose and application code is changed at the same time:

```dotenv
POSTGRES_DB=micado
KEYCLOAK_DB_USER=keycloak
APP_DB_USER=micado
GITEA_DB_USER=gitea
WEBLATE_DB_USER=weblate
DBOS_DB_USER=dbos
DBOS_DB_SCHEMA=dbos
UMAMI_DB_USER=umami
```

Passwords for those users are configurable and should be replaced before a
non-local installation.

If you need Weblate to send email, replace its placeholder SMTP values before
testing notifications. Invalid SMTP credentials do not explain a shell-script
line-ending failure.

Never commit `.env`:

```bash
git status --short
```

If `.env` appears as an untracked file, add it to the root `.gitignore` before
continuing.

### 5.2 Validate the resolved Compose configuration

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  config --quiet
```

No output means that the Compose files and required variable substitutions are
valid. Fix every warning or error before starting the stack.

### 5.3 Check local ports

Development uses these host ports:

| Port | Purpose |
|---:|---|
| 80 | All public MICADO URLs through Traefik |
| 5432 | PostgreSQL, exposed for development and tests |
| 8088 | Direct Traefik development dashboard |

If another service is already using one of them, stop that service or change
the development mapping before starting MICADO.

On Linux or WSL, a quick check is:

```bash
ss -ltn | grep -E ':(80|5432|8088)[[:space:]]' || true
```

No output means that those ports are currently free.

### 5.4 Build and start

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build
```

The first run downloads several images, builds five applications, initializes
PostgreSQL, imports the Keycloak realms, initializes Gitea and Weblate, and
creates the Umami websites. It will take longer than an ordinary restart.

Follow the final readiness container:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  logs -f stack-ready
```

The installation is ready when the output contains:

```text
MICADO IS READY!
```

Press `Ctrl+C` only to stop following the logs. The containers continue to run
in the background.

### 5.5 Verify container status

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  ps --all
```

Long-running services should be `Up` and eventually `healthy`. Initialization
services such as `bootstrap-perms`, `gitea-init`, `weblate-init`, `umami-init`
and `stack-ready` are expected to show `Exited (0)` after completing their job.
An initializer showing a non-zero exit code indicates a failed installation.

## 6. Development URLs

With `BASE_DOMAIN=localhost`, use:

| Service | URL |
|---|---|
| Migrants frontend | <http://migrants.localhost> |
| PA frontend | <http://pa.localhost> |
| NGO frontend | <http://ngo.localhost> |
| Backend API | <http://api.localhost> |
| Backend health check | <http://api.localhost/ping> |
| Keycloak | <http://auth.localhost> |
| Gitea | <http://git.localhost> |
| Weblate | <http://weblate.localhost> |
| Umami | <http://analytics.localhost> |
| Piper development endpoint | <http://piper.localhost> |
| Traefik dashboard | <http://traefik.localhost/#> |
| Traefik dashboard, direct port | <http://localhost:8088/dashboard/> |

Modern browsers treat names below `.localhost` as loopback addresses. If a
host cannot resolve them, first verify from WSL:

```bash
getent hosts api.localhost
curl -fsS http://api.localhost/ping
```

If the browser runs on Windows and resolution still fails, add explicit entries
for the required names to the Windows hosts file. Windows does not support
wildcards in that file.

## 7. Development accounts

Passwords are read from the root `.env` during the first initialization.

| Application | Username | Password variable |
|---|---|---|
| Keycloak administration | value of `KC_BOOTSTRAP_ADMIN_USERNAME` | `KC_BOOTSTRAP_ADMIN_PASSWORD` |
| Migrants | `migrants-user` | `MIGRANTS_USER_PASSWORD` |
| Migrants administrator | `migrants-admin` | `MIGRANTS_ADMIN_PASSWORD` |
| PA administrator | `pa-admin` | `PA_ADMIN_PASSWORD` |
| PA operator | `pa-operator` | `PA_OPERATOR_PASSWORD` |
| NGO administrator | `ngo-admin` | `NGO_ADMIN_PASSWORD` |
| NGO operator | `ngo-operator` | `NGO_OPERATOR_PASSWORD` |
| Weblate | `admin` | `WEBLATE_ADMIN_PASSWORD` |
| Gitea administrator | `gitea-admin` | current bootstrap default: `gitea-admin` |
| Umami | `UMAMI_ADMIN_USERNAME` | `UMAMI_ADMIN_PASSWORD` |

The current Compose configuration does not pass `GITEA_ADMIN_*`,
`GITEA_WEBLATE_*` or `GITEA_TRANSLATIONS_REPO` from `.env` into `gitea-init`,
even though `.env.example` declares them. The development defaults happen to
match most script defaults, but changing them can produce credentials or
repository names that disagree between Gitea, Weblate and the backend. Correct
the Compose environment forwarding before customizing these values or making a
production deployment.

> [!IMPORTANT]
> Keycloak realm imports and PostgreSQL initialization happen only when their
> persistent data is empty. Changing a bootstrap password in `.env` and
> restarting containers does not update an account that was already created.

## 8. Focused development

For backend development without real authentication, enable the dummy-auth
variables in `.env`:

```dotenv
AUTH_DISABLE_KEYCLOAK=true
AUTH_DUMMY_ROLES=pa_admin
AUTH_DUMMY_USERNAME=dev.user
AUTH_DUMMY_SUB=dev-user
```

Recreate the backend so it receives the changed environment:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build --force-recreate backend
```

Dummy authentication is development/test-only. Set
`AUTH_DISABLE_KEYCLOAK=false` before validating real login, identity propagation
or role-based access.

To start a development subset, list the required services explicitly:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build traefik db backend
```

Compose can still start transitive dependencies required by `backend`; this is
expected.

## 9. Persistence and initialization

Named volumes preserve PostgreSQL, Redis, Keycloak, Gitea, Weblate, shared
bootstrap data and generated Piper audio between container recreations.

On an empty PostgreSQL volume, files in `infrastructure/postgres/init/` execute
once in lexical order:

1. `001-create-dbs.sh` creates the fixed service roles and schemas.
2. `010-app-schema.sql` creates the MICADO application schema.
3. `020-app-seed.sql` creates the initial application data.
4. `030-app-test-seed.sql` inserts test records.

The current `030-app-test-seed.sql` has no environment guard. Because it is
inside `/docker-entrypoint-initdb.d`, it runs automatically on every fresh
database, including one created with the production overlay. It is not optional
in the current layout. Move it out of the automatic initialization directory or
add an explicit opt-in mechanism before treating the Compose configuration as
production-ready.

Files under `infrastructure/postgres/migrations/` are not currently applied
automatically.

The translation bootstrap creates the Gitea repository and Weblate project,
components, languages and webhooks before the backend becomes ready. No manual
Gitea or Weblate setup should be required on a successful first installation.

## 10. Ordinary operations

### Show status

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps --all
```

### Follow all logs

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
```

### Follow one service

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f backend
```

Replace `backend` with another service name such as `db`, `keycloak`, `gitea`,
`gitea-init`, `weblate`, `weblate-init`, `piper` or `umami`.

### Restart one service

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend
```

### Apply changed environment values

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build --force-recreate
```

This recreates containers but preserves named volumes and their data.

### Stop while preserving data

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Start again

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## 11. Recover from a failed first initialization

First inspect the failing service:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps --all
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=300 db
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=300 gitea-init
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=300 weblate-init
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=300 umami-init
```

Correct the underlying problem before recreating anything.

PostgreSQL runs the files in `/docker-entrypoint-initdb.d` only when its data
directory is empty. If the first database bootstrap failed after `initdb`
completed, a normal restart will not rerun the initialization scripts.

For a failed brand-new installation with no data to preserve, perform a full
reset:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  down -v --remove-orphans

docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build
```

> [!CAUTION]
> `down -v` permanently deletes all Compose-managed MICADO data, including the
> PostgreSQL database, Keycloak, Gitea, Weblate, Redis and bootstrap data. Use
> it only for a disposable or failed fresh installation. Never use it as an
> ordinary restart command.

## 12. Run the Playwright verification suite

The tests run against an already-running development stack. Build the test
image once:

```bash
docker build --pull \
  --build-arg PLAYWRIGHT_VERSION=1.62.1 \
  -t micado-playwright:1.62.1 \
  ./test/image
```

Run the standard smoke and backend API suites:

```bash
docker run --rm --init --ipc=host \
  --add-host host.docker.internal:host-gateway \
  --add-host auth.localhost:host-gateway \
  --add-host api.localhost:host-gateway \
  --env-file ./.env \
  -v "${PWD}/test:/opt/micado-playwright/tests" \
  micado-playwright:1.62.1
```

Test reports are written below `test/results`. See [`test/README.md`](test/README.md)
for API-test authentication, subsets, real-Keycloak opt-in suites and the full
business workflow.

## 13. Production installation

Do not expose the development configuration to the internet.

Before the first production startup:

1. Correct the `gitea-init` environment forwarding described in section 7.
2. Remove `030-app-test-seed.sql` from automatic production initialization or
   add an explicit opt-in guard, as described in section 9.
3. Provision a Linux host with Docker Engine and Docker Compose v2.
4. Point either a wildcard DNS record or explicit records for all MICADO
   subdomains to that host.
5. Allow inbound TCP ports 80 and 443. Port 80 is required by the configured
   Let's Encrypt HTTP challenge and redirects to HTTPS.
6. Copy `.env.example` to `.env`.
7. Set `BASE_DOMAIN` to the real domain without a scheme, for example
   `micado.example.org`.
8. Set `TRAEFIK_EMAIL` to a valid Let's Encrypt contact address.
9. Replace every example, `change-me`, default and placeholder password.
10. Generate a new `WEBLATE_WEBHOOK_SECRET` using the format expected by the
   application.
11. Configure real Weblate SMTP values if email is required.
12. Ensure development-only authentication variables are absent or false.

The following names must resolve publicly when using
`BASE_DOMAIN=micado.example.org`:

```text
migrants.micado.example.org
pa.micado.example.org
ngo.micado.example.org
api.micado.example.org
auth.micado.example.org
git.micado.example.org
weblate.micado.example.org
analytics.micado.example.org
```

Validate the production configuration:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  config --quiet
```

Start it:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --build
```

Follow initialization and verify status:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f stack-ready
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps --all
```

The production frontend and identity URLs use HTTPS. Confirm that Traefik
obtained valid certificates before giving the URLs to users.

Production deployment also requires an operational backup and restore plan for
all persistent volumes. A successful `docker compose up` is not a backup.

## 14. Troubleshooting checklist

### `env: 'bash\r': No such file or directory`

One or more shell scripts use Windows CRLF endings. Normalize them as described
in section 4. If PostgreSQL had already initialized its volume, apply the fresh
installation reset from section 11.

### Compose reports that a variable is not set

Make sure `.env` exists in the same directory as `docker-compose.yml`, then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
```

Do not run Compose from `infrastructure/` or `apps/`.

### A frontend build context does not exist

You have an incomplete checkout or an infrastructure-only package. Obtain the
complete repository containing every directory listed in section 3.

### A URL returns `404` or cannot be resolved

Check that:

- `BASE_DOMAIN=localhost` for development;
- the URL uses the correct subdomain from section 6;
- Traefik is healthy;
- the application service is healthy;
- no proxy, VPN or security product is intercepting `.localhost`;
- Windows can resolve the hostname if the browser runs outside WSL.

Useful commands:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps --all
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=200 traefik
curl -v http://api.localhost/ping
```

### An initializer exited with a non-zero code

Read that initializer's complete logs. Do not treat `Exited (0)` as an error;
the initialization containers are one-shot jobs and are supposed to stop after
success.

### Credentials changed in `.env` but login still uses the old password

Bootstrap variables create initial state; they are not a general password-sync
mechanism. Update the account through the corresponding administration UI, or
reset volumes only when the installation is disposable and contains no data.

## 15. Security notes

- `.env.example` is suitable only as a local bootstrap template.
- Never commit `.env`, access tokens, SMTP app passwords or Playwright traces
  containing credentials.
- Never expose PostgreSQL port 5432 or the insecure Traefik development
  dashboard in production.
- Keep `AUTH_DISABLE_KEYCLOAK=false` in production.
- Use unique passwords for PostgreSQL roles, Keycloak, Gitea, Weblate and Umami.
- Back up persistent volumes before upgrades and test the restore procedure.
