#!/usr/bin/env sh
# weblate-init.sh — unattended Weblate project + component bootstrap
#
# ── Repository structure (must match gitea-init.sh exactly) ──────────────────
#
#   <category-slug>/<lang>.json
#
#   Weblate component per category:
#     filemask:  <category-slug>/*.json
#     template:  <category-slug>/<source_lang>.json
#
#   e.g.  user-types/*.json   (matches user-types/en.json, user-types/it.json …)
#         news/*.json
#
#   NOTE: NO "backend/" prefix.  Previous versions used backend/<category>/*.json
#   which did NOT match the backend application's file paths.  Fixed here.
#
# ── Weblate webhook add-on (weblate.webhook.webhook) ────────────────────────
#
#   The add-on is installed on EVERY component.  Weblate fires a POST to
#   WEBLATE_WEBHOOK_URL when strings are translated.
#
#   The backend endpoint:  /api/webhooks/weblate/translation-complete
#
#   Events are INTEGER values from Weblate's AddonEvent enum (weblate/addons/events.py):
#     1  = EVENT_POST_PUSH       — Repository post-push
#     2  = EVENT_POST_UPDATE     — Repository post-update
#     4  = EVENT_POST_COMMIT     — Repository post-commit  ← USE THIS
#     8  = EVENT_UNIT_POST_SAVE  — Unit post-save (fires on every save — too noisy)
#    11  = EVENT_DAILY           — Daily
#    12  = EVENT_COMPONENT_UPDATE — Component update
#
#   EVENT_POST_COMMIT (4) fires after Weblate commits translated strings to git.
#   This is the correct trigger: translator has finished, strings are in git,
#   our backend can pull them from Gitea.
#
#   IMPORTANT: string names like "new_translation" are NOT valid choices.
#   The field name in the API is "webhook_url" (not "url").
#   The "events" field takes an array of integers, not strings.
#
# ── Auth ─────────────────────────────────────────────────────────────────────
#
#   Gitea: credentials configured in settings-override.py (GITEA_CREDENTIALS)
#   Weblate admin API token: retrieved via `weblate drf_create_token`
#
set -eu

APP_NAME="weblate-init"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()   { printf '%s [%s] [%s] %s\n' "$(timestamp)" "$APP_NAME" "$1" "$2" >&2; }
info()  { log INFO  "$1"; }
warn()  { log WARN  "$1"; }
error() { log ERROR "$1"; }
debug() { log DEBUG "$1"; }

mask_secret() {
  value="${1:-}"
  length=$(printf '%s' "$value" | wc -c | tr -d ' ')
  if [ "$length" -eq 0 ]; then
    printf '<empty>'
  elif [ "$length" -le 4 ]; then
    printf '**** (len=%s)' "$length"
  else
    first=$(printf '%s' "$value" | cut -c1-2)
    last=$(printf '%s' "$value" | rev 2>/dev/null | cut -c1-2 | rev 2>/dev/null || printf '??')
    printf '%s****%s (len=%s)' "$first" "$last" "$length"
  fi
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
: "${WEBLATE_URL:=http://weblate:8080}"
: "${WEBLATE_ADMIN_EMAIL:=weblate@example.com}"
: "${WEBLATE_ADMIN_USERNAME:=admin}"

: "${WEBLATE_PROJECT_NAME:=micado}"
: "${WEBLATE_PROJECT_SLUG:=micado}"
: "${WEBLATE_PROJECT_WEB:=http://weblate.local}"

# Webhook settings
: "${WEBLATE_WEBHOOK_URL:=}"
: "${WEBLATE_WEBHOOK_SECRET:=}"
# Events for the webhook add-on — comma-separated integers from ActionEvents
# (weblate/trans/actions.py), NOT from AddonEvent. These are translation history
# action codes, completely different from the add-on lifecycle enum.
#
# Relevant values for our use case:
#   2  = CHANGE    — a translator edits a string
#   17 = COMMIT    — Weblate commits changes to the local git repo
#   18 = PUSH      — Weblate pushes to Gitea  ← USE THIS
#   36 = APPROVE   — a translation is approved
#
# We use PUSH (18) + COMMIT (17) so the backend is notified whenever
# Weblate writes to Gitea. Commits happen first; push follows.
# The backend then pulls the full translated catalog from Gitea.
: "${WEBLATE_WEBHOOK_EVENTS:=17,18}"

: "${WEBLATE_GIT_REPO:=http://gitea:3000/weblate-bot/translations.git}"
: "${WEBLATE_GIT_BRANCH:=main}"
: "${WEBLATE_FILE_FORMAT:=json}"
: "${WEBLATE_VCS:=git}"
# Push URL — Weblate writes translated files back to Gitea via this URL.
# Must include credentials since the Weblate container authenticates to Gitea.
# If empty, Weblate will use the same URL as WEBLATE_GIT_REPO (works for HTTP with GITEA_CREDENTIALS).
# Set explicitly if you use SSH or a separate push endpoint.
: "${WEBLATE_GIT_PUSH_REPO:=}"

# Must match gitea-init.sh values exactly
: "${MICADO_SOURCE_LANG:=en}"
: "${MICADO_CATEGORIES:=}"
# Comma-separated list of target language codes to add to every component.
# Must be ISO codes that Weblate already knows (e.g. it, fr, ar, de, pt_BR).
# Example: "it,fr,ar,de,sq,mk"
: "${MICADO_TARGET_LANGS:=}"

: "${BOOTSTRAP_DIR:=/bootstrap}"
: "${TOKEN_FILE:=${BOOTSTRAP_DIR}/gitea-weblate.token}"

# Gitea API access — used to pre-create template files before Weblate component creation.
# GITEA_API_BASE is derived from WEBLATE_GIT_REPO by default (strip .git suffix, add /api/v1).
# GITEA_WEBLATE_USER and GITEA_TRANSLATIONS_REPO must match gitea-init.sh values.
: "${GITEA_API_BASE:=http://gitea:3000/api/v1}"
: "${GITEA_WEBLATE_USER:=weblate-bot}"
: "${GITEA_TRANSLATIONS_REPO:=translations}"

# Completion marker written by gitea-init when it finishes all file creation.
# weblate-init waits for this before creating components, so the template
# files are guaranteed to exist in Gitea before Weblate validates them.
: "${GITEA_INIT_DONE_FILE:=${BOOTSTRAP_DIR}/gitea-init.done}"

WEBLATE_ADMIN_API_TOKEN=""

# ---------------------------------------------------------------------------
# Slug helpers — identical to gitea-init.sh
# ---------------------------------------------------------------------------
slugify_category() {
  input="$1"
  output=$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9._-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//' \
    | sed 's/-$//')
  if [ -z "$output" ]; then
    error "Category '${input}' becomes empty after slugification"
    return 1
  fi
  printf '%s' "$output"
}

normalize_csv_items() {
  printf '%s' "$1" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//' \
    | sed 's/[[:space:]]*$//' \
    | sed '/^$/d'
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
check_mounts() {
  info "=== Checking mounts and config files ==="
  ls -ld /app/data "$BOOTSTRAP_DIR" >&2 || true
  ls -la "$BOOTSTRAP_DIR" >&2 || true

  if [ -f /app/data/settings-override.py ]; then
    info "  settings-override.py: present"
    # Log key lines for debugging (mask passwords)
    grep -E "^GITEA_CREDENTIALS|^VCS_ALLOW_SCHEMES|^ALLOWED_HOSTS" \
      /app/data/settings-override.py >&2 || true
  else
    warn "  settings-override.py: NOT FOUND — Weblate may fail to authenticate to Gitea"
  fi
}

log_env() {
  info "=== Weblate bootstrap configuration ==="
  info "  WEBLATE_URL=${WEBLATE_URL}"
  info "  WEBLATE_ADMIN_EMAIL=${WEBLATE_ADMIN_EMAIL}"
  info "  WEBLATE_ADMIN_USERNAME=${WEBLATE_ADMIN_USERNAME}"
  info "  WEBLATE_PROJECT_SLUG=${WEBLATE_PROJECT_SLUG}"
  info "  WEBLATE_GIT_REPO=${WEBLATE_GIT_REPO}"
  info "  WEBLATE_GIT_BRANCH=${WEBLATE_GIT_BRANCH}"
  info "  WEBLATE_FILE_FORMAT=${WEBLATE_FILE_FORMAT}"
  info "  WEBLATE_WEBHOOK_URL=${WEBLATE_WEBHOOK_URL:-<not set>}"
  info "  WEBLATE_WEBHOOK_SECRET=$(mask_secret "${WEBLATE_WEBHOOK_SECRET:-}")"
  info "  WEBLATE_WEBHOOK_EVENTS=${WEBLATE_WEBHOOK_EVENTS} (ActionEvents: 2=CHANGE,17=COMMIT,18=PUSH,36=APPROVE)"
  info "  MICADO_SOURCE_LANG=${MICADO_SOURCE_LANG}"
  info "  MICADO_CATEGORIES=${MICADO_CATEGORIES:-<none>}"
  info "  MICADO_TARGET_LANGS=${MICADO_TARGET_LANGS:-<none>}"
  info "  WEBLATE_GIT_PUSH_REPO=${WEBLATE_GIT_PUSH_REPO:-<same as repo>}"
  info "  GITEA_API_BASE=${GITEA_API_BASE}"
  info "  GITEA_WEBLATE_USER=${GITEA_WEBLATE_USER}"
  info "  GITEA_TRANSLATIONS_REPO=${GITEA_TRANSLATIONS_REPO}"
  info "  GITEA_INIT_DONE_FILE=${GITEA_INIT_DONE_FILE}"
  info "  TOKEN_FILE=${TOKEN_FILE}"
  if [ -f "$TOKEN_FILE" ]; then
    token_preview=$(head -c 8 "$TOKEN_FILE" 2>/dev/null || true)
    info "  Gitea token: PRESENT, preview=$(mask_secret "$token_preview")"
  else
    warn "  Gitea token: NOT FOUND at ${TOKEN_FILE}"
  fi
  info "======================================="
}

# ---------------------------------------------------------------------------
# Wait helpers
# ---------------------------------------------------------------------------
wait_for_http() {
  url="$1"; name="$2"; max="${3:-80}"; attempt=1
  info "Waiting for ${name} at ${url}"
  while :; do
    http_code=$(curl -o /dev/null -sS -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ] || [ "$http_code" = "301" ] || [ "$http_code" = "302" ]; then
      info "  ${name} is ready (HTTP ${http_code})"
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      error "${name} not ready after ${attempt} attempts (last HTTP ${http_code}): ${url}"
      return 1
    fi
    info "  Waiting for ${name} (${attempt}/${max}, HTTP ${http_code})"
    attempt=$((attempt + 1))
    sleep 5
  done
}

wait_for_file() {
  path="$1"; name="$2"; max="${3:-60}"; attempt=1
  info "Waiting for ${name} at ${path}"
  while :; do
    if [ -s "$path" ]; then
      info "  ${name} found at ${path}"
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      error "${name} not found after ${attempt} attempts: ${path}"
      return 1
    fi
    info "  Waiting for ${name} (${attempt}/${max})"
    attempt=$((attempt + 1))
    sleep 3
  done
}

# Wait for gitea-init to write its completion marker.
# This guarantees all category source files exist in Gitea before we ask
# Weblate to create components (which validates template files synchronously).
wait_for_gitea_init() {
  info "Waiting for gitea-init to complete (marker: ${GITEA_INIT_DONE_FILE})"
  wait_for_file "$GITEA_INIT_DONE_FILE" "gitea-init completion marker" 120
  done_at=$(cat "$GITEA_INIT_DONE_FILE" 2>/dev/null || echo "unknown")
  info "gitea-init completed at: ${done_at}"
}

# ---------------------------------------------------------------------------
# Admin token retrieval
# ---------------------------------------------------------------------------
fetch_admin_token() {
  info "Retrieving API token for '${WEBLATE_ADMIN_USERNAME}'"
  info "  Command: weblate drf_create_token ${WEBLATE_ADMIN_USERNAME}"

  raw_output="$(weblate drf_create_token "${WEBLATE_ADMIN_USERNAME}" 2>&1 || true)"
  info "  drf_create_token output: ${raw_output}"

  token="$(printf '%s\n' "$raw_output" \
    | sed -n 's/^Generated token \([^ ]*\) for user .*$/\1/p' \
    | head -n1)"

  if [ -z "$token" ]; then
    token="$(printf '%s\n' "$raw_output" \
      | awk '/Generated token / {print $3; exit}' \
      | tr -d '[:space:]')"
  fi

  if [ -z "$token" ]; then
    error "Token retrieval FAILED — command output was: ${raw_output}"
    return 1
  fi

  WEBLATE_ADMIN_API_TOKEN="$token"
  info "  Token retrieved: $(mask_secret "$WEBLATE_ADMIN_API_TOKEN")"
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
api_get() {
  url_path="$1"
  full_url="${WEBLATE_URL}${url_path}"
  debug "  API GET ${full_url}"
  response=$(curl -fsS \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    "$full_url" 2>&1) || {
      error "API GET ${full_url} failed: $response"
      return 1
    }
  printf '%s' "$response"
}

api_post_json() {
  url_path="$1"; body="$2"
  full_url="${WEBLATE_URL}${url_path}"
  info "  API POST ${full_url}"
  debug "    payload: ${body}"

  response=$(curl -sS -w '\n%{http_code}' \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -X POST -d "$body" \
    "$full_url")
  http_code=$(printf '%s' "$response" | tail -n1)
  body_out=$(printf '%s' "$response" | sed '$d')

  info "  Response HTTP ${http_code}"
  debug "  Response body: ${body_out}"

  if [ "$http_code" -lt 200 ] || [ "$http_code" -gt 299 ]; then
    error "POST ${url_path} failed HTTP ${http_code}: ${body_out}"
    return 1
  fi
  printf '%s' "$body_out"
}

api_patch_json() {
  url_path="$1"; body="$2"
  full_url="${WEBLATE_URL}${url_path}"
  info "  API PATCH ${full_url}"
  debug "    payload: ${body}"

  response=$(curl -sS -w '\n%{http_code}' \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -X PATCH -d "$body" \
    "$full_url")
  http_code=$(printf '%s' "$response" | tail -n1)
  body_out=$(printf '%s' "$response" | sed '$d')

  info "  Response HTTP ${http_code}"
  debug "  Response body: ${body_out}"

  if [ "$http_code" -lt 200 ] || [ "$http_code" -gt 299 ]; then
    error "PATCH ${url_path} failed HTTP ${http_code}: ${body_out}"
    return 1
  fi
  printf '%s' "$body_out"
}

# ---------------------------------------------------------------------------
# Existence checks
# ---------------------------------------------------------------------------
project_exists() {
  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    "${WEBLATE_URL}/api/projects/${WEBLATE_PROJECT_SLUG}/" 2>/dev/null || echo "000")
  debug "  project_exists HTTP ${http_code}"
  [ "$http_code" = "200" ]
}

component_exists() {
  comp_slug="$1"
  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    "${WEBLATE_URL}/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/" 2>/dev/null || echo "000")
  debug "  component_exists '${comp_slug}' HTTP ${http_code}"
  [ "$http_code" = "200" ]
}

# ---------------------------------------------------------------------------
# Webhook add-on detection
#
# The per-component endpoint /api/components/.../addons/ only accepts POST
# (confirmed from Weblate source: @action(detail=True, methods=["post"])).
# GET on that URL returns 405 Method Not Allowed.
#
# To check whether the webhook add-on is already installed we use the global
# GET /api/addons/ endpoint and filter by component URL client-side.
# ---------------------------------------------------------------------------
find_component_webhook_addon_id() {
  comp_slug="$1"
  comp_url="${WEBLATE_URL}/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/"

  info "  Checking global add-ons list for component '${comp_slug}'"
  debug "    GET ${WEBLATE_URL}/api/addons/?page_size=200"

  addons_json=$(curl -sS \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    "${WEBLATE_URL}/api/addons/?page_size=200" 2>/dev/null || true)

  if [ -z "$addons_json" ]; then
    warn "  No response from /api/addons/ — cannot check existing add-ons"
    printf ''
    return 0
  fi

  debug "  /api/addons/ response length: $(printf '%s' "$addons_json" | wc -c) bytes"

  if command -v jq >/dev/null 2>&1; then
    addon_id=$(printf '%s' "$addons_json" \
      | jq -r --arg comp "$comp_url" \
        '.results[]? | select(.name == "weblate.webhook.webhook" and .component == $comp) | .id' \
        2>/dev/null | head -n1 || true)
    info "  jq found addon_id='${addon_id:-<none>}'"
    printf '%s' "${addon_id:-}"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    addon_id=$(printf '%s' "$addons_json" | python3 -c \
      "import sys,json; data=json.load(sys.stdin); comp=sys.argv[1]; [print(a['id']) for a in data.get('results',[]) if a.get('name')=='weblate.webhook.webhook' and a.get('component')==comp]" \
      "$comp_url" 2>/dev/null | head -1 || true)
    info "  python3 found addon_id='${addon_id:-<none>}'"
    printf '%s' "${addon_id:-}"
    return 0
  fi

  # Last resort: grep (only works if no other webhook addon is installed)
  addon_id=$(printf '%s' "$addons_json" \
    | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || true)
  info "  grep fallback found addon_id='${addon_id:-<none>}'"
  printf '%s' "${addon_id:-}"
}

# ---------------------------------------------------------------------------
# Webhook add-on payload builder
#
# Correct field names (validated from Weblate API error messages):
#   webhook_url  — destination URL  (NOT "url")
#   secret       — Standard Webhooks secret (base64-encoded, may be empty)
#   events       — array of INTEGERS from ActionEvents enum (NOT AddonEvent, NOT strings)
#
# ActionEvents integers (weblate/trans/actions.py):
#   2  = CHANGE    — string edited by translator
#   17 = COMMIT    — changes committed to local git
#   18 = PUSH      — changes pushed to Gitea  ← primary trigger
#   36 = APPROVE   — translation approved
#
# WEBLATE_WEBHOOK_EVENTS: comma-separated integers, e.g. "17,18"
# ---------------------------------------------------------------------------
build_addon_payload() {
  events_csv="${WEBLATE_WEBHOOK_EVENTS}"
  events_json="["
  first=1
  IFS=','
  for ev in $events_csv; do
    ev=$(printf '%s' "$ev" | tr -d '[:space:]')
    [ -z "$ev" ] && continue
    case "$ev" in
      ''|*[!0-9]*) warn "  Ignoring non-integer event value: '${ev}'"; continue ;;
    esac
    if [ "$first" = "1" ]; then
      events_json="${events_json}${ev}"
      first=0
    else
      events_json="${events_json},${ev}"
    fi
  done
  unset IFS
  events_json="${events_json}]"

  printf '{"name":"weblate.webhook.webhook","configuration":{"webhook_url":"%s","secret":"%s","events":%s}}' \
    "${WEBLATE_WEBHOOK_URL}" \
    "${WEBLATE_WEBHOOK_SECRET:-}" \
    "${events_json}"
}

ensure_webhook_addon() {
  comp_slug="$1"

  if [ -z "${WEBLATE_WEBHOOK_URL:-}" ]; then
    info "  WEBLATE_WEBHOOK_URL not set — skipping webhook add-on for '${comp_slug}'"
    return 0
  fi

  info "Ensuring webhook add-on on component '${comp_slug}'"
  info "  Webhook URL: ${WEBLATE_WEBHOOK_URL}"
  info "  Events:      ${WEBLATE_WEBHOOK_EVENTS} (ActionEvents: 17=COMMIT,18=PUSH)"

  addon_id=$(find_component_webhook_addon_id "$comp_slug" || true)

  payload=$(build_addon_payload)
  debug "  Addon payload: ${payload}"

  if [ -n "${addon_id}" ]; then
    info "  Add-on already exists (id=${addon_id}) — updating via PATCH"
    api_patch_json "/api/addons/${addon_id}/" "$payload" >/dev/null
    info "  Webhook add-on updated for '${comp_slug}' (id=${addon_id})"
  else
    info "  Installing new webhook add-on on '${comp_slug}'"
    result=$(api_post_json "/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/addons/" "$payload")
    if command -v jq >/dev/null 2>&1; then
      new_id=$(printf '%s' "$result" | jq -r '.id // empty' 2>/dev/null || true)
    elif command -v python3 >/dev/null 2>&1; then
      new_id=$(printf '%s' "$result" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
    else
      new_id=$(printf '%s' "$result" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || true)
    fi
    info "  Webhook add-on installed for '${comp_slug}' (new id=${new_id:-unknown})"
  fi

  verify_id=$(find_component_webhook_addon_id "$comp_slug" || true)
  if [ -n "$verify_id" ]; then
    info "  Verification OK: add-on id=${verify_id} is present on '${comp_slug}'"
  else
    warn "  Verification: add-on not found in global list — check Weblate admin UI to confirm"
  fi
}

# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------
ensure_project() {
  info "Ensuring project '${WEBLATE_PROJECT_SLUG}'"
  if project_exists; then
    info "  Project already exists — skipping"
    return 0
  fi

  body=$(printf '{"name":"%s","slug":"%s","web":"%s"}' \
    "$WEBLATE_PROJECT_NAME" "$WEBLATE_PROJECT_SLUG" "$WEBLATE_PROJECT_WEB")

  result=$(api_post_json "/api/projects/" "$body")

  if command -v jq >/dev/null 2>&1; then
    slug=$(printf '%s' "$result" | jq -r '.slug // empty')
  else
    slug=$(printf '%s' "$result" | grep -o '"slug":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi

  if [ "$slug" = "$WEBLATE_PROJECT_SLUG" ]; then
    info "  Project '${WEBLATE_PROJECT_SLUG}' created"
  else
    error "  Project creation — unexpected response: ${result}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Gitea repo reachability pre-flight
# ---------------------------------------------------------------------------
check_repo_reachable() {
  info "=== Pre-flight: Gitea repo reachability check ==="
  info "  Git repo URL: ${WEBLATE_GIT_REPO}"

  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    --max-time 10 \
    "${WEBLATE_GIT_REPO}/info/refs?service=git-upload-pack" 2>/dev/null || echo "CURL_FAILED")

  if [ "$http_code" = "CURL_FAILED" ]; then
    warn "  curl failed entirely — network/DNS issue"
  elif [ "$http_code" = "200" ] || [ "$http_code" = "401" ]; then
    info "  Gitea repo responded HTTP ${http_code} — reachable OK"
  else
    warn "  Gitea repo responded HTTP ${http_code} — may not be accessible"
  fi

  info "  Checking DNS resolution for 'gitea':"
  gitea_ip=$(getent hosts gitea 2>/dev/null | awk '{print $1}' || echo "UNRESOLVED")
  info "  gitea → ${gitea_ip}"
  info "================================================="
}

# ---------------------------------------------------------------------------
# Gitea token reader
# ---------------------------------------------------------------------------
read_gitea_token() {
  if [ ! -f "$TOKEN_FILE" ]; then
    error "Gitea token file not found: ${TOKEN_FILE}"
    return 1
  fi
  cat "$TOKEN_FILE" | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# ensure_gitea_template_file
#
# Weblate validates that the template file (source language JSON) exists in
# the Gitea repository BEFORE it accepts the component creation POST.
# gitea-init.sh creates these files for all categories in MICADO_CATEGORIES,
# but the weblate-init container must guard against the case where the file
# is missing (e.g. gitea-init ran before this category was added to the list,
# or the bootstrap order was wrong).
#
# This function creates the minimal seed JSON via the Gitea contents API if
# the file does not already exist.  It is idempotent — safe to call every run.
#
# $1  file_path   e.g. locations/en.json
# ---------------------------------------------------------------------------
ensure_gitea_template_file() {
  file_path="$1"

  gitea_token=$(read_gitea_token) || return 1

  info "Ensuring Gitea template file '${file_path}' exists"

  # Check if file already exists
  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    -H "Authorization: token ${gitea_token}" \
    "${GITEA_API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${file_path}?ref=${WEBLATE_GIT_BRANCH}" \
    2>/dev/null || echo "000")

  info "  Gitea file check '${file_path}' → HTTP ${http_code}"

  if [ "$http_code" = "200" ]; then
    info "  Template file '${file_path}' already exists — OK"
    return 0
  fi

  if [ "$http_code" != "404" ]; then
    warn "  Unexpected HTTP ${http_code} checking '${file_path}' — will attempt to create anyway"
  fi

  # Empty JSON object — Weblate only checks for valid JSON existence at component
  # creation time. {} means zero strings appear in Weblate until the backend
  # pushes real translation keys via GiteaTranslationExportService.
  seed_json='{}'
  content_b64=$(printf '%s\n' "$seed_json" | base64 | tr -d '\n')
  commit_msg="init $(dirname "$file_path") source translations (weblate-init)"

  info "  Creating template file '${file_path}' in Gitea (content: {})"

  response=$(curl -sS -w '\n%{http_code}' \
    -H "Authorization: token ${gitea_token}" \
    -H "Content-Type: application/json" \
    -X POST \
    "${GITEA_API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${file_path}" \
    -d "{\"content\":\"${content_b64}\",\"message\":\"${commit_msg}\",\"branch\":\"${WEBLATE_GIT_BRANCH}\"}")

  http_code=$(printf '%s' "$response" | tail -n1)
  resp_body=$(printf '%s' "$response" | sed '$d')

  if [ "$http_code" -ge 200 ] && [ "$http_code" -le 299 ]; then
    info "  Template file '${file_path}' created (HTTP ${http_code})"
  elif printf '%s' "$resp_body" | grep -qi '"already exists\|sha is required\|is not a valid filename"'; then
    info "  Template file '${file_path}' already existed (race condition — OK)"
  else
    error "  Failed to create template file '${file_path}': HTTP ${http_code}: ${resp_body}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Component
#
#   $1  comp_name   human label
#   $2  comp_slug   unique slug within project
#   $3  filemask    e.g. user-types/*.json
#   $4  template    e.g. user-types/en.json
#
# IMPORTANT: filemask and template paths match GiteaTranslationExportService:
#   computeRepoPath() = `${category}/${isoCode.toLowerCase()}.json`
#   → filemask = `${category}/*.json`
#   → template = `${category}/${sourceLang}.json`
# ---------------------------------------------------------------------------
ensure_component() {
  comp_name="$1"; comp_slug="$2"; filemask="$3"; template="$4"

  info "Ensuring component '${comp_slug}'"
  info "  name:     ${comp_name}"
  info "  filemask: ${filemask}"
  info "  template: ${template}"

  if component_exists "$comp_slug"; then
    info "  Component '${comp_slug}' already exists — skipping"
    return 0
  fi

  # Use push URL if set, otherwise fall back to repo URL (works with HTTP GITEA_CREDENTIALS)
  push_repo="${WEBLATE_GIT_PUSH_REPO:-$WEBLATE_GIT_REPO}"

  payload=$(printf '{
    "name": "%s",
    "slug": "%s",
    "vcs": "%s",
    "repo": "%s",
    "push": "%s",
    "branch": "%s",
    "filemask": "%s",
    "template": "%s",
    "file_format": "%s",
    "push_on_commit": false,
    "manage_units": false,
    "new_lang": "add"
  }' \
    "$comp_name" "$comp_slug" "$WEBLATE_VCS" \
    "$WEBLATE_GIT_REPO" "$push_repo" "$WEBLATE_GIT_BRANCH" \
    "$filemask" "$template" "$WEBLATE_FILE_FORMAT")

  result=$(api_post_json "/api/projects/${WEBLATE_PROJECT_SLUG}/components/" "$payload")

  if command -v jq >/dev/null 2>&1; then
    returned_slug=$(printf '%s' "$result" | jq -r '.slug // empty')
  else
    returned_slug=$(printf '%s' "$result" | grep -o '"slug":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi

  if [ -z "$returned_slug" ]; then
    error "Component '${comp_slug}' creation failed — no slug in response: ${result}"
    return 1
  fi

  info "  Component accepted (slug=${returned_slug}) — polling for async git clone..."
  max=40; attempt=1
  while :; do
    if component_exists "$comp_slug"; then
      comp_data=$(api_get "/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/" 2>/dev/null || true)
      if command -v jq >/dev/null 2>&1; then
        repo_error=$(printf '%s' "$comp_data" | jq -r '.error // empty')
      else
        repo_error=$(printf '%s' "$comp_data" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4)
      fi
      if [ -n "${repo_error}" ] && [ "${repo_error}" != "null" ]; then
        warn "  Component '${comp_slug}' has repo error: ${repo_error}"
      else
        info "  Component '${comp_slug}' is ready"
        return 0
      fi
    fi
    if [ "$attempt" -ge "$max" ]; then
      error "Component '${comp_slug}' not ready after ${attempt} polls"
      return 1
    fi
    info "  ... polling (${attempt}/${max})"
    attempt=$((attempt + 1))
    sleep 5
  done
}

# ---------------------------------------------------------------------------
# Pull latest strings from Gitea into Weblate
# ---------------------------------------------------------------------------
refresh_component() {
  comp_slug="$1"
  info "Pulling latest from Gitea for component '${comp_slug}'"
  result=$(api_post_json \
    "/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/repository/" \
    '{"operation":"pull"}' || true)
  info "  Pull response: ${result}"
}

# ---------------------------------------------------------------------------
# ensure_component_languages
#
# Adds each language in MICADO_TARGET_LANGS to the given component by POSTing
# to /api/components/{project}/{slug}/translations/.
#
# Requires new_lang="add" on the component (set in ensure_component payload).
# The language code must already exist in Weblate's language database.
# Weblate ships with ~500 language definitions; if a code is missing, add it
# via the Weblate admin UI first.
#
# The source language (MICADO_SOURCE_LANG) is skipped — it is the template
# and already present as the component's source.
#
# HTTP 400 with "already exists" body is treated as success (idempotent).
# ---------------------------------------------------------------------------
ensure_component_languages() {
  comp_slug="$1"

  if [ -z "${MICADO_TARGET_LANGS:-}" ]; then
    info "  MICADO_TARGET_LANGS not set — skipping language setup for '${comp_slug}'"
    return 0
  fi

  info "Adding target languages to component '${comp_slug}'"
  info "  Target langs: ${MICADO_TARGET_LANGS}"
  info "  Source lang:  ${MICADO_SOURCE_LANG} (skipped)"

  IFS=','
  for lang in $MICADO_TARGET_LANGS; do
    lang=$(printf '%s' "$lang" | tr -d '[:space:]')
    [ -z "$lang" ] && continue

    # Skip source language — it is already the template
    if [ "$lang" = "$MICADO_SOURCE_LANG" ]; then
      debug "  Skipping source lang '${lang}'"
      continue
    fi

    info "  Adding language '${lang}' to component '${comp_slug}'"

    response=$(curl -sS -w '\n%{http_code}' \
      -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -X POST \
      "${WEBLATE_URL}/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/translations/" \
      -d "{\"language_code\":\"${lang}\"}")

    http_code=$(printf '%s' "$response" | tail -n1)
    resp_body=$(printf '%s' "$response" | sed '$d')

    debug "  Response HTTP ${http_code}: ${resp_body}"

    case "$http_code" in
      201)
        info "  Language '${lang}' added to '${comp_slug}' (HTTP 201)"
        ;;
      400)
        # Weblate returns 400 if language already exists or is not found.
        # Distinguish: if body contains the language code it likely already exists.
        if printf '%s' "$resp_body" | grep -qi 'already\|exists\|no language code'; then
          info "  Language '${lang}' already present or unknown — skipping: ${resp_body}"
        else
          warn "  Language '${lang}' on '${comp_slug}' returned HTTP 400: ${resp_body}"
        fi
        ;;
      403)
        # Fires if new_lang != "add" on the component
        error "  Language '${lang}' on '${comp_slug}' permission denied (HTTP 403)"
        error "  Check that new_lang='add' is set on the component"
        ;;
      *)
        warn "  Language '${lang}' on '${comp_slug}' returned unexpected HTTP ${http_code}: ${resp_body}"
        ;;
    esac
  done
  unset IFS

  info "  Language setup done for '${comp_slug}'"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  info "====== Starting Weblate bootstrap ======"
  check_mounts
  log_env

  wait_for_http "${WEBLATE_URL}/api/" "Weblate API" 80

  # Wait for gitea-init to finish completely — it writes the marker AFTER creating
  # all category source files.  This prevents the race where weblate-init tries
  # to create a component before gitea-init has pushed the template file.
  wait_for_gitea_init

  # TOKEN_FILE is written by gitea-init before the done marker, so it is
  # guaranteed to exist at this point.  The explicit wait is kept as a guard.
  wait_for_file "$TOKEN_FILE" "Gitea PAT" 10

  fetch_admin_token

  info "Verifying API token..."
  check=$(api_get "/api/" 2>&1) || {
    error "API token verification failed. Response: ${check}"
    return 1
  }
  info "API token verified OK"

  check_repo_reachable

  ensure_project

  # ── Create one Weblate component per content-type category ───────────────
  #
  # Path convention (NO backend/ prefix):
  #   filemask = <category-slug>/*.json
  #   template = <category-slug>/<source-lang>.json
  #
  if [ -n "${MICADO_CATEGORIES:-}" ]; then
    info "=== Processing per-category components ==="
    info "  Categories: ${MICADO_CATEGORIES}"

    categories=$(normalize_csv_items "$MICADO_CATEGORIES")
    printf '%s\n' "$categories" | while IFS= read -r category; do
      [ -z "$category" ] && continue

      cat_slug=$(slugify_category "$category")

      # Component slug = category slug (no "category-" prefix needed)
      comp_slug="${cat_slug}"

      # Human-readable name: capitalize first letter
      cap=$(printf '%s' "$cat_slug" | cut -c1 | tr '[:lower:]' '[:upper:]')
      rest=$(printf '%s' "$cat_slug" | cut -c2-)
      comp_name="${cap}${rest}"

      # File paths — must match gitea-init.sh and GiteaTranslationExportService
      filemask="${cat_slug}/*.json"
      template="${cat_slug}/${MICADO_SOURCE_LANG}.json"

      info "--- Component: ${comp_slug} ---"
      info "  name:     ${comp_name}"
      info "  filemask: ${filemask}"
      info "  template: ${template}"

      # Weblate rejects component creation if the template file does not exist
      # in Gitea at POST time.  Ensure it is present before calling ensure_component.
      ensure_gitea_template_file "$template"

      ensure_component "$comp_name" "$comp_slug" "$filemask" "$template"
      ensure_component_languages "$comp_slug"
      ensure_webhook_addon "$comp_slug"
      refresh_component "$comp_slug"
    done
  else
    info "MICADO_CATEGORIES is empty — no category components to create"
  fi

  info "====== Weblate bootstrap completed successfully ======"
}

main "$@"