#!/bin/sh
# docker-entrypoint.sh
#
# Generates /usr/share/nginx/html/config.json from environment variables
# before nginx starts.  This is what makes the same Docker image deployable
# to multiple environments (staging, production, etc.) without rebuilding.
#
# Required environment variables:
#   API_URL              — base URL of the Micado backend API
#   KEYCLOAK_URL         — base URL of the Keycloak server
#   KEYCLOAK_REALM       — Keycloak realm name
#   KEYCLOAK_CLIENT_ID   — Keycloak public client ID for this app
#
# Optional environment variables (have sensible defaults):
#   PA_URL               — public URL of this PA app
#   MIGRANT_DOMAIN       — public domain of the migrant app
#   TITLE_LIMIT          — max title character length (default: 30)
#
# Security note:
#   None of these values are secrets.  Keycloak public clients have no
#   client secret by design — PKCE provides the security for browser SPAs.
#   It is safe to write all of them to a publicly-served JSON file.

set -e

CONFIG_FILE="/usr/share/nginx/html/config.json"

echo "[entrypoint] writing ${CONFIG_FILE}"

cat > "${CONFIG_FILE}" << EOF
{
  "apiUrl":           "${API_URL:?API_URL is required}",
  "keycloakUrl":      "${KEYCLOAK_URL:?KEYCLOAK_URL is required}",
  "keycloakRealm":    "${KEYCLOAK_REALM:?KEYCLOAK_REALM is required}",
  "keycloakClientId": "${KEYCLOAK_CLIENT_ID:?KEYCLOAK_CLIENT_ID is required}",
  "paUrl":            "${PA_URL:-}",
  "migrantDomain":    "${MIGRANT_DOMAIN:-}",
  "titleLimit":       ${TITLE_LIMIT:-30}
}
EOF

echo "[entrypoint] config written:"
cat "${CONFIG_FILE}"

echo "[entrypoint] starting nginx"
exec nginx -g "daemon off;"