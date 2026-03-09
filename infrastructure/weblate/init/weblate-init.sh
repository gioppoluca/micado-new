#!/usr/bin/env sh
# weblate-init.sh — unattended Weblate project + component bootstrap
# Requirements: curl, sh (POSIX)
#
# Repo structure mirrors gitea-init exactly:
#
#   backend/en.json                              → main "backend" component
#                                                  filemask:  backend/*.json
#                                                  template:  backend/en.json
#
#   backend/<category-slug>/<source_lang>.json   → one component per category
#                                                  filemask:  backend/<slug>/*.json
#                                                  template:  backend/<slug>/<source_lang>.json
#
# Auth:
#   Gitea:   plain repo URL — credentials in settings-override.py (GITEA_CREDENTIALS)
#   Weblate: token retrieved via official Weblate command:
#            weblate drf_create_token <username>
set -eu

APP_NAME="weblate-init"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
: "${WEBLATE_URL:=http://weblate:8080}"
: "${WEBLATE_ADMIN_EMAIL:=weblate@example.com}"
: "${WEBLATE_ADMIN_USERNAME:=admin}"

: "${WEBLATE_PROJECT_NAME:=micado}"
: "${WEBLATE_PROJECT_SLUG:=micado}"
: "${WEBLATE_PROJECT_WEB:=http://weblate.local}"

: "${WEBLATE_GIT_REPO:=http://gitea:3000/weblate-bot/translations.git}"
: "${WEBLATE_GIT_BRANCH:=main}"
: "${WEBLATE_FILE_FORMAT:=json}"
: "${WEBLATE_VCS:=git}"

# Must match gitea-init values exactly
: "${MICADO_SOURCE_LANG:=it}"
: "${MICADO_CATEGORIES:=}"

: "${BOOTSTRAP_DIR:=/bootstrap}"
: "${TOKEN_FILE:=${BOOTSTRAP_DIR}/gitea-weblate.token}"

# DB/Redis env are intentionally inherited from docker-compose so that
# this container points to the very same Weblate instance/database.
: "${POSTGRES_HOST:=db}"
: "${POSTGRES_DATABASE:=}"
: "${POSTGRES_USER:=}"
: "${POSTGRES_PASSWORD:=}"
: "${REDIS_HOST:=cache}"

WEBLATE_ADMIN_API_TOKEN=""

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()   { printf '%s [%s] [%s] %s\n' "$(timestamp)" "$APP_NAME" "$1" "$2" >&2; }
info()  { log INFO  "$1"; }
warn()  { log WARN  "$1"; }
error() { log ERROR "$1"; }

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
# Slugify — identical to gitea-init slugify_category()
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

# ---------------------------------------------------------------------------
# Normalize CSV — identical to gitea-init normalize_csv_items()
# ---------------------------------------------------------------------------
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
  info "Checking mounts"
  ls -ld /app/data "$BOOTSTRAP_DIR" >&2 || true
  ls -la "$BOOTSTRAP_DIR" >&2 || true
  if [ -f /app/data/settings-override.py ]; then
    info "settings-override.py present — GITEA_CREDENTIALS will be loaded by Weblate"
  else
    warn "settings-override.py NOT found — Weblate may fail to authenticate to Gitea"
  fi
}

log_env() {
  info "Bootstrap configuration:"
  info "  WEBLATE_URL=${WEBLATE_URL}"
  info "  WEBLATE_ADMIN_EMAIL=${WEBLATE_ADMIN_EMAIL}"
  info "  WEBLATE_ADMIN_USERNAME=${WEBLATE_ADMIN_USERNAME}"
  info "  WEBLATE_PROJECT_SLUG=${WEBLATE_PROJECT_SLUG}"
  info "  WEBLATE_GIT_REPO=${WEBLATE_GIT_REPO}"
  info "  WEBLATE_GIT_BRANCH=${WEBLATE_GIT_BRANCH}"
  info "  WEBLATE_FILE_FORMAT=${WEBLATE_FILE_FORMAT}"
  info "  MICADO_SOURCE_LANG=${MICADO_SOURCE_LANG}"
  info "  MICADO_CATEGORIES=${MICADO_CATEGORIES}"
  info "  POSTGRES_HOST=${POSTGRES_HOST}"
  info "  POSTGRES_DATABASE=${POSTGRES_DATABASE}"
  info "  POSTGRES_USER=${POSTGRES_USER}"
  info "  REDIS_HOST=${REDIS_HOST}"
  info "  TOKEN_FILE=${TOKEN_FILE}"
  if [ -f "$TOKEN_FILE" ]; then
    token_preview=$(head -c 8 "$TOKEN_FILE" 2>/dev/null || true)
    info "  Gitea token: present, preview=$(mask_secret "$token_preview")"
  else
    warn "  Gitea token: NOT FOUND at ${TOKEN_FILE}"
  fi
}

# ---------------------------------------------------------------------------
# Wait helpers
# ---------------------------------------------------------------------------
wait_for_http() {
  url="$1"; name="$2"; max="${3:-80}"; attempt=1
  while :; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      info "${name} is ready"
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      error "${name} not ready after ${attempt} attempts: ${url}"
      return 1
    fi
    info "Waiting for ${name} (${attempt}/${max})"
    attempt=$((attempt + 1))
    sleep 5
  done
}

wait_for_file() {
  path="$1"; name="$2"; max="${3:-60}"; attempt=1
  while :; do
    if [ -s "$path" ]; then
      info "${name} found at ${path}"
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      error "${name} not found after ${attempt} attempts: ${path}"
      return 1
    fi
    info "Waiting for ${name} (${attempt}/${max})"
    attempt=$((attempt + 1))
    sleep 3
  done
}

# ---------------------------------------------------------------------------
# Fetch admin token using official Weblate management command
# This container shares the same config/data/db settings as the main Weblate
# instance, so drf_create_token operates against the same installation.
# ---------------------------------------------------------------------------
fetch_admin_token() {
  info "Retrieving API token for '${WEBLATE_ADMIN_USERNAME}' via: weblate drf_create_token ${WEBLATE_ADMIN_USERNAME}"

  raw_output="$(
    weblate drf_create_token "${WEBLATE_ADMIN_USERNAME}" 2>&1 || true
  )"

  token="$(
    printf '%s\n' "$raw_output" \
      | sed -n 's/^Generated token \([^ ]*\) for user .*$/\1/p' \
      | head -n1
  )"

  if [ -z "$token" ]; then
    token="$(
      printf '%s\n' "$raw_output" \
        | awk '/Generated token / {print $3; exit}' \
        | tr -d '[:space:]'
    )"
  fi

  if [ -z "$token" ]; then
    error "Token retrieval failed via weblate drf_create_token"
    error "Command output was: ${raw_output}"
    return 1
  fi

  WEBLATE_ADMIN_API_TOKEN="$token"
  info "Token retrieved successfully: $(mask_secret "$WEBLATE_ADMIN_API_TOKEN")"
}

# ---------------------------------------------------------------------------
# API helpers — all errors are visible
# ---------------------------------------------------------------------------
api_get() {
  curl -fsS \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    "${WEBLATE_URL}${1}"
}

api_post_json() {
  path="$1"; body="$2"
  response=$(curl -sS -w '\n%{http_code}' \
    -H "Authorization: Token ${WEBLATE_ADMIN_API_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -X POST -d "$body" \
    "${WEBLATE_URL}${path}")
  http_code=$(printf '%s' "$response" | tail -n1)
  body_out=$(printf '%s' "$response" | sed '$d')
  if [ "$http_code" -lt 200 ] || [ "$http_code" -gt 299 ]; then
    error "POST ${path} returned HTTP ${http_code}: ${body_out}"
    return 1
  fi
  printf '%s' "$body_out"
}

project_exists() {
  api_get "/api/projects/${WEBLATE_PROJECT_SLUG}/" >/dev/null 2>&1
}

component_exists() {
  api_get "/api/components/${WEBLATE_PROJECT_SLUG}/${1}/" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------
ensure_project() {
  info "Ensuring project '${WEBLATE_PROJECT_SLUG}'"
  if project_exists; then
    info "Project already exists — skipping"
    return 0
  fi

  result=$(api_post_json "/api/projects/" \
    "{\"name\":\"${WEBLATE_PROJECT_NAME}\",\"slug\":\"${WEBLATE_PROJECT_SLUG}\",\"web\":\"${WEBLATE_PROJECT_WEB}\"}")

  slug=$(printf '%s' "$result" | tr ',' '\n' | grep '"slug"' | head -1 \
    | sed 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [ "$slug" = "$WEBLATE_PROJECT_SLUG" ]; then
    info "Project '${WEBLATE_PROJECT_SLUG}' created"
  else
    error "Project creation response unexpected: ${result}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Component
#   $1 comp_name   human label
#   $2 comp_slug   unique slug within project
#   $3 filemask    e.g. backend/*.json
#   $4 template    e.g. backend/en.json
# ---------------------------------------------------------------------------
ensure_component() {
  comp_name="$1"; comp_slug="$2"; filemask="$3"; template="$4"
  info "Ensuring component '${comp_slug}' filemask=${filemask} template=${template}"

  if component_exists "$comp_slug"; then
    info "Component '${comp_slug}' already exists — skipping"
    return 0
  fi

  result=$(api_post_json \
    "/api/projects/${WEBLATE_PROJECT_SLUG}/components/" \
    "{
      \"name\": \"${comp_name}\",
      \"slug\": \"${comp_slug}\",
      \"vcs\": \"${WEBLATE_VCS}\",
      \"repo\": \"${WEBLATE_GIT_REPO}\",
      \"branch\": \"${WEBLATE_GIT_BRANCH}\",
      \"filemask\": \"${filemask}\",
      \"template\": \"${template}\",
      \"file_format\": \"${WEBLATE_FILE_FORMAT}\",
      \"push_on_commit\": false,
      \"manage_units\": false,
      \"new_lang\": \"none\"
    }")

  returned_slug=$(printf '%s' "$result" | tr ',' '\n' | grep '"slug"' | head -1 \
    | sed 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [ -z "$returned_slug" ]; then
    error "Component '${comp_slug}' creation failed — no slug in response: ${result}"
    return 1
  fi

  info "Component '${comp_slug}' accepted — polling for async clone to finish..."
  max=40; attempt=1
  while :; do
    if component_exists "$comp_slug"; then
      comp_data=$(api_get "/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/" 2>/dev/null || true)
      repo_error=$(printf '%s' "$comp_data" | tr ',' '\n' \
        | grep '"error"' | grep -v 'null' | head -1 || true)
      if [ -n "$repo_error" ]; then
        warn "Component '${comp_slug}' has repo error: ${repo_error}"
      else
        info "Component '${comp_slug}' is ready"
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

refresh_component() {
  comp_slug="$1"
  info "Pulling latest from Gitea for '${comp_slug}'"
  result=$(api_post_json \
    "/api/components/${WEBLATE_PROJECT_SLUG}/${comp_slug}/repository/" \
    '{"operation":"pull"}' || true)
  info "Pull response: ${result}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  check_mounts
  log_env

  wait_for_http "${WEBLATE_URL}/api/" "Weblate API"
  wait_for_file "$TOKEN_FILE" "Gitea PAT"

  fetch_admin_token

  info "Verifying API token against ${WEBLATE_URL}/api/..."
  check=$(api_get "/api/" 2>&1) || {
    error "API token verification failed. Response: ${check}"
    return 1
  }
  info "API token verified OK"

  ensure_project

  ensure_component \
    "Backend" \
    "backend" \
    "backend/*.json" \
    "backend/en.json"
  refresh_component "backend"

  if [ -n "${MICADO_CATEGORIES:-}" ]; then
    info "Processing per-category components for: ${MICADO_CATEGORIES}"
    categories=$(normalize_csv_items "$MICADO_CATEGORIES")
    printf '%s\n' "$categories" | while IFS= read -r category; do
      [ -z "$category" ] && continue
      cat_slug=$(slugify_category "$category")
      comp_slug="category-${cat_slug}"
      cap=$(printf '%s' "$cat_slug" | cut -c1 | tr '[:lower:]' '[:upper:]')
      rest=$(printf '%s' "$cat_slug" | cut -c2-)
      comp_name="Category: ${cap}${rest}"
      filemask="backend/${cat_slug}/*.json"
      template="backend/${cat_slug}/${MICADO_SOURCE_LANG}.json"
      ensure_component "$comp_name" "$comp_slug" "$filemask" "$template"
      refresh_component "$comp_slug"
    done
  else
    info "MICADO_CATEGORIES is empty — no category components to create"
  fi

  info "Weblate bootstrap completed successfully"
}

main "$@"