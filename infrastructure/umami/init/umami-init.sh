#!/bin/sh
set -eu

: "${UMAMI_URL:?UMAMI_URL is required}"
: "${UMAMI_ADMIN_USERNAME:?UMAMI_ADMIN_USERNAME is required}"
: "${UMAMI_ADMIN_PASSWORD:?UMAMI_ADMIN_PASSWORD is required}"

apk add --no-cache curl jq >/dev/null

log() {
  printf '%s [umami-init] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

api_call() {
  METHOD="$1"
  URL="$2"
  BODY="${3:-}"

  TMP_BODY="$(mktemp)"
  HTTP_CODE="$(
    if [ -n "$BODY" ]; then
      curl -sS -o "$TMP_BODY" -w '%{http_code}' \
        -X "$METHOD" "$URL" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$BODY"
    else
      curl -sS -o "$TMP_BODY" -w '%{http_code}' \
        -X "$METHOD" "$URL" \
        -H "Authorization: Bearer ${TOKEN}"
    fi
  )"

  RESPONSE_BODY="$(cat "$TMP_BODY")"
  rm -f "$TMP_BODY"

  printf '%s\n%s' "$HTTP_CODE" "$RESPONSE_BODY"
}

wait_for_umami() {
  log "Waiting for Umami at ${UMAMI_URL} ..."
  i=0
  until curl -fsS "${UMAMI_URL}/api/heartbeat" >/dev/null 2>&1 || curl -fsS "${UMAMI_URL}/" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      log "ERROR: Umami did not become ready in time"
      exit 1
    fi
    sleep 5
  done
  log "Umami is reachable"
}

login() {
  log "Authenticating to Umami API ..."

  TMP_BODY="$(mktemp)"
  HTTP_CODE="$(
    curl -sS -o "$TMP_BODY" -w '%{http_code}' \
      -X POST "${UMAMI_URL}/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"${UMAMI_ADMIN_USERNAME}\",\"password\":\"${UMAMI_ADMIN_PASSWORD}\"}"
  )"
  RESPONSE_BODY="$(cat "$TMP_BODY")"
  rm -f "$TMP_BODY"

  if [ "$HTTP_CODE" -ge 300 ]; then
    log "ERROR: login failed with HTTP ${HTTP_CODE}"
    log "Response: ${RESPONSE_BODY}"
    exit 1
  fi

  TOKEN="$(printf '%s' "$RESPONSE_BODY" | jq -r '.token')"

  if [ -z "${TOKEN}" ] || [ "${TOKEN}" = "null" ]; then
    log "ERROR: failed to obtain Umami token"
    log "Response: ${RESPONSE_BODY}"
    exit 1
  fi
}

website_exists() {
  WEBSITE_ID="$1"

  TMP_BODY="$(mktemp)"
  HTTP_CODE="$(
    curl -sS -o "$TMP_BODY" -w '%{http_code}' \
      -H "Authorization: Bearer ${TOKEN}" \
      "${UMAMI_URL}/api/websites"
  )"
  RESPONSE_BODY="$(cat "$TMP_BODY")"
  rm -f "$TMP_BODY"

  if [ "$HTTP_CODE" -ge 300 ]; then
    log "ERROR: failed to list websites (HTTP ${HTTP_CODE})"
    log "Response: ${RESPONSE_BODY}"
    exit 1
  fi

  printf '%s' "$RESPONSE_BODY" | jq -e --arg id "$WEBSITE_ID" '
    if type == "array" then
      any(.[]; .id == $id)
    elif has("data") then
      any(.data[]; .id == $id)
    else
      false
    end
  ' >/dev/null 2>&1
}

create_website() {
  WEBSITE_ID="$1"
  NAME="$2"
  DOMAIN="$3"

  log "Creating website ${NAME} (${DOMAIN}) [${WEBSITE_ID}]"

  RESULT="$(api_call POST "${UMAMI_URL}/api/websites" \
    "{\"id\":\"${WEBSITE_ID}\",\"name\":\"${NAME}\",\"domain\":\"${DOMAIN}\"}")"

  HTTP_CODE="$(printf '%s' "$RESULT" | sed -n '1p')"
  RESPONSE_BODY="$(printf '%s' "$RESULT" | sed '1d')"

  if [ "$HTTP_CODE" -ge 300 ]; then
    log "ERROR: create failed with HTTP ${HTTP_CODE}"
    log "Response: ${RESPONSE_BODY}"
    exit 1
  fi
}

update_website() {
  WEBSITE_ID="$1"
  NAME="$2"
  DOMAIN="$3"

  log "Updating website ${NAME} (${DOMAIN}) [${WEBSITE_ID}]"

  RESULT="$(api_call POST "${UMAMI_URL}/api/websites/${WEBSITE_ID}" \
    "{\"name\":\"${NAME}\",\"domain\":\"${DOMAIN}\"}")"

  HTTP_CODE="$(printf '%s' "$RESULT" | sed -n '1p')"
  RESPONSE_BODY="$(printf '%s' "$RESULT" | sed '1d')"

  if [ "$HTTP_CODE" -ge 300 ]; then
    log "ERROR: update failed with HTTP ${HTTP_CODE}"
    log "Response: ${RESPONSE_BODY}"
    exit 1
  fi
}

upsert_website() {
  WEBSITE_ID="$1"
  NAME="$2"
  DOMAIN="$3"

  if website_exists "${WEBSITE_ID}"; then
    update_website "${WEBSITE_ID}" "${NAME}" "${DOMAIN}"
  else
    create_website "${WEBSITE_ID}" "${NAME}" "${DOMAIN}"
  fi
}

wait_for_umami
login

upsert_website "${UMAMI_MIGRANTS_WEBSITE_ID}" "${UMAMI_MIGRANTS_NAME}" "${UMAMI_MIGRANTS_DOMAIN}"
upsert_website "${UMAMI_PA_WEBSITE_ID}" "${UMAMI_PA_NAME}" "${UMAMI_PA_DOMAIN}"
upsert_website "${UMAMI_NGO_WEBSITE_ID}" "${UMAMI_NGO_NAME}" "${UMAMI_NGO_DOMAIN}"

log "Umami bootstrap completed successfully"