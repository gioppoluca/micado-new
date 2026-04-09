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
#   KEYCLOAK_REALM       — Keycloak realm name (should be "migrants")
#   KEYCLOAK_CLIENT_ID   — Keycloak public client ID (should be "migrants")
#
# Optional environment variables (have sensible defaults or can be empty):
#   PA_URL               — public URL of the PA backoffice (for cross-app links)
#   MIGRANT_DOMAIN       — public domain of this migrants app
#   TITLE_LIMIT          — max title character length (default: 30)
#   UMAMI_URL            — base URL of the Umami analytics server
#   UMAMI_WEBSITE_ID     — Umami website ID for this frontend
#   UMAMI_DOMAINS        — comma-separated hostnames to restrict tracking to
#
# Security note:
#   None of these values are secrets.  Keycloak public clients (PKCE flow)
#   have no client secret by design — it is safe to write them to a
#   publicly-served JSON file.

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
  "titleLimit":       ${TITLE_LIMIT:-30},
  "umamiUrl":         "${UMAMI_URL:-}",
  "umamiWebsiteId":   "${UMAMI_WEBSITE_ID:-}",
  "umamiDomains":     "${UMAMI_DOMAINS:-}"
}
EOF

echo "[entrypoint] config written:"
cat "${CONFIG_FILE}"

echo "[entrypoint] starting nginx"
exec nginx -g "daemon off;"