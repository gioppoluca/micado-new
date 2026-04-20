#!/bin/sh
# docker-entrypoint.sh
#
# Generates /usr/share/nginx/html/config.json from environment variables
# before nginx starts.  Same pattern as pa_frontoffice.
#
# Required:
#   API_URL              — base URL of the Micado backend API
#   KEYCLOAK_URL         — base URL of the Keycloak server
#   KEYCLOAK_REALM       — Keycloak realm name (e.g. ngo_frontoffice)
#   KEYCLOAK_CLIENT_ID   — Keycloak public client ID for this app

set -e

CONFIG_FILE="/usr/share/nginx/html/config.json"

echo "[entrypoint] writing ${CONFIG_FILE}"

cat > "${CONFIG_FILE}" << JSONEOF
{
  "apiUrl":           "${API_URL:?API_URL is required}",
  "keycloakUrl":      "${KEYCLOAK_URL:?KEYCLOAK_URL is required}",
  "keycloakRealm":    "${KEYCLOAK_REALM:?KEYCLOAK_REALM is required}",
  "keycloakClientId": "${KEYCLOAK_CLIENT_ID:?KEYCLOAK_CLIENT_ID is required}",
  "migrantDomain":    "${MIGRANT_DOMAIN:-}",
  "titleLimit":       ${TITLE_LIMIT:-30},
  "umamiUrl":         "${UMAMI_URL:-}",
  "umamiWebsiteId":   "${UMAMI_WEBSITE_ID:-}",
  "umamiDomains":     "${UMAMI_DOMAINS:-}"
}
JSONEOF

echo "[entrypoint] config written:"
cat "${CONFIG_FILE}"

echo "[entrypoint] starting nginx"
exec nginx -g "daemon off;"
