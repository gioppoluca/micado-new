# Monorepo MICADO (Vue + LoopBack + Keycloak + PGroonga + Traefik + Weblate)

Questa repo **riusa** il codice dello stack esistente (zip `vue-lb4-keycloak-stack`) e lo organizza in monorepo con:
- 3 SPA Vue: `migrants`, `pa_frontoffice`, `ngo_frontoffice`
- 1 backend LoopBack 4
- Keycloak (realm import unattended)
- Postgres + PGroonga (DB separati per app/keycloak/weblate)
- Traefik come entrypoint unico (TLS termination, pronto per Let's Encrypt)
- Weblate per la gestione traduzioni (usa lo stesso Postgres + Redis)

## Struttura
- `apps/`
- `infrastructure/`
- `docker-compose.yml` (prod)
- `docker-compose.dev.yml` (dev override)

## Dev
```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Hostnames (dev):
- http://migrants.localhost
- http://pa.localhost
- http://ngo.localhost
- http://api.localhost
- http://auth.localhost
- http://weblate.localhost
- http://traefik.localhost

## Prod
- imposta `BASE_DOMAIN` e DNS
- `docker compose up --build -d`

Nota: in prod Traefik forza HTTPS su :80 -> :443 e usa ACME httpChallenge.

## Nginx
- `infrastructure/nginx/spa.conf`: serve le SPA in produzione.
- `infrastructure/nginx/weblate-proxy.conf`: opzionale se vuoi un Nginx davanti a Weblate.


## Gitea + Weblate
- Gitea è esposto su `git.${BASE_DOMAIN}` e viene inizializzato automaticamente dal servizio `gitea-init`.
- Viene creato un utente bot per Weblate (`GITEA_WEBLATE_USER`) e un repository (`GITEA_TRANSLATIONS_REPO`) con un file iniziale `backend/en.json`.
- In Weblate crea un *Project* e un *Component* puntando al repo: `https://git.${BASE_DOMAIN}/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}.git`.
  - Auth consigliata: HTTP basic con username=`GITEA_WEBLATE_USER` e password=`GITEA_WEBLATE_PASSWORD` (oppure un token).


## Avvio
- **Sviluppo**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
- **Produzione**: `docker compose -f docker-compose.prod.yml up -d --build`


## Logging (KISS)
- Backend: `LOG_LEVEL` (silent|error|warn|info|debug|trace)
- Frontend: legge `FRONTEND_LOG_LEVEL` da `GET /public/config`.


## Quasar (Vue 3)
Le 3 SPA ora usano Quasar 2 con Vite plugin (non Quasar CLI) per mantenere l'UI il più vicino possibile durante il refactoring.

## Mock API (migrazione guscio UI)
In `docker-compose.dev.yml` è impostato `VITE_USE_MOCKS=true` per le SPA: le chiamate a `/public/config` e ad alcuni endpoint demo vengono simulate lato frontend.
Quando vuoi collegarti al backend reale, imposta `VITE_USE_MOCKS=false`.

## Migrazione layout (no patch)
Approccio: ci fornisci i file Quasar v1 (Vue2) dei layout; noi generiamo nuovi file Quasar2/Vue3 in `src/layouts/` e lasciamo i vecchi come riferimento. Nessun patch sui file originali.
