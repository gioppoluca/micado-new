#!/usr/bin/env bash
# gitea-init.sh — unattended Gitea bootstrap for Micado translation repository
#
# ── Repository file structure ─────────────────────────────────────────────────
#
#   <category-slug>/<lang>.json
#
#   Examples:
#     user-types/en.json      (source language seed for the user-types component)
#     user-types/it.json      (Italian translations — written by Weblate)
#     news/en.json
#     processes/fr.json
#
# ── Removal of the "backend/" prefix ─────────────────────────────────────────
#
#   Previous versions created files under backend/<category>/<lang>.json.
#   That prefix was removed: the backend application's GiteaTranslationExportService
#   uses path = "<category>/<lang>.json" and the Weblate filemask must match.
#
# ── Auth ──────────────────────────────────────────────────────────────────────
#
#   Admin user is created via Gitea CLI (gitea admin user create).
#   Weblate bot user is created the same way.
#   A PAT (Personal Access Token) is generated for the bot and written to
#   $TOKEN_FILE so weblate-init.sh can read it.
#
set -Eeuo pipefail

APP_NAME="gitea-init"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '%s [%s] [%s] %s\n' "$(timestamp)" "$APP_NAME" "$1" "$2" >&2; }
info()  { log INFO  "$*"; }
debug() { log DEBUG "$*"; }
warn()  { log WARN  "$*"; }
error() { log ERROR "$*"; }

mask_secret() {
  local value="${1:-}"
  local len=${#value}
  if (( len == 0 )); then
    printf '<empty>'
  elif (( len <= 4 )); then
    printf '****'
  else
    printf '%s****%s (len=%d)' "${value:0:2}" "${value: -2}" "$len"
  fi
}

log_var() {
  local name="$1" value="$2" sensitivity="${3:-plain}"
  case "$sensitivity" in
    secret) info "ENV $name=$(mask_secret "$value")" ;;
    plain)  info "ENV $name=$value" ;;
    *)      info "ENV $name=<unknown sensitivity>" ;;
  esac
}

# ---------------------------------------------------------------------------
# Environment defaults
# ---------------------------------------------------------------------------

: "${GITEA_ADMIN_USER:=gitea-admin}"
: "${GITEA_ADMIN_PASSWORD:=gitea-admin}"
: "${GITEA_ADMIN_EMAIL:=admin@micado.local}"
: "${GITEA_WEBLATE_USER:=weblate-bot}"
: "${GITEA_WEBLATE_PASSWORD:=weblate-bot}"
: "${GITEA_WEBLATE_EMAIL:=weblate-bot@micado.local}"
: "${GITEA_TRANSLATIONS_REPO:=translations}"
: "${GITEA_TRANSLATIONS_BRANCH:=main}"
: "${GITEA_TRANSLATIONS_REPO_PRIVATE:=true}"
: "${GITEA_WEBLATE_TOKEN_NAME:=weblate-bootstrap}"
: "${GITEA_WEBLATE_TOKEN_SCOPES:=read:repository,write:repository,read:user}"
: "${GITEA_RUN_UID:=1000}"
: "${GITEA_RUN_GID:=1000}"

# Micado-specific bootstrap variables
: "${MICADO_SOURCE_LANG:=en}"
: "${MICADO_CATEGORIES:=}"       # CSV list, e.g. "user-types,news,processes"

export GITEA_WORK_DIR=/data/gitea
GITEA_CONFIG_FILE="${GITEA_CONFIG_FILE:-/data/gitea/conf/app.ini}"
BOOTSTRAP_DIR=/bootstrap
TOKEN_FILE="${BOOTSTRAP_DIR}/gitea-weblate.token"
API_BASE="http://gitea:3000/api/v1"

# Minimal seed JSON:  { "_schema": "micado", "ping": "Ping" }
# Empty JSON object — Weblate only needs valid JSON to accept the template file.
# The backend pushes real translation keys later via GiteaTranslationExportService.
# Using {} means zero strings appear in Weblate until real content arrives.
SEED_CONTENT_B64='e30K'

on_error() {
  local line="$1" rc="$2" cmd="${3:-unknown}"
  error "Bootstrap failed at line ${line} with exit code ${rc}"
  error "Last command: ${cmd}"
}
trap 'on_error ${LINENO} $? "$BASH_COMMAND"' ERR

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

log_environment() {
  info "====== Effective bootstrap configuration ======"
  log_var GITEA_ADMIN_USER       "$GITEA_ADMIN_USER"
  log_var GITEA_ADMIN_PASSWORD   "$GITEA_ADMIN_PASSWORD"   secret
  log_var GITEA_ADMIN_EMAIL      "$GITEA_ADMIN_EMAIL"
  log_var GITEA_WEBLATE_USER     "$GITEA_WEBLATE_USER"
  log_var GITEA_WEBLATE_PASSWORD "$GITEA_WEBLATE_PASSWORD" secret
  log_var GITEA_WEBLATE_EMAIL    "$GITEA_WEBLATE_EMAIL"
  log_var GITEA_TRANSLATIONS_REPO         "$GITEA_TRANSLATIONS_REPO"
  log_var GITEA_TRANSLATIONS_BRANCH       "$GITEA_TRANSLATIONS_BRANCH"
  log_var GITEA_TRANSLATIONS_REPO_PRIVATE "$GITEA_TRANSLATIONS_REPO_PRIVATE"
  log_var GITEA_WEBLATE_TOKEN_NAME        "$GITEA_WEBLATE_TOKEN_NAME"
  log_var GITEA_WEBLATE_TOKEN_SCOPES      "$GITEA_WEBLATE_TOKEN_SCOPES"
  log_var GITEA_RUN_UID          "$GITEA_RUN_UID"
  log_var GITEA_RUN_GID          "$GITEA_RUN_GID"
  log_var GITEA_CONFIG_FILE      "$GITEA_CONFIG_FILE"
  log_var GITEA_WORK_DIR         "$GITEA_WORK_DIR"
  log_var BOOTSTRAP_DIR          "$BOOTSTRAP_DIR"
  log_var TOKEN_FILE             "$TOKEN_FILE"
  log_var API_BASE               "$API_BASE"
  log_var MICADO_SOURCE_LANG     "$MICADO_SOURCE_LANG"
  log_var MICADO_CATEGORIES      "$MICADO_CATEGORIES"
  info "Runtime: uid=$(id -u) gid=$(id -g) user=$(id -un 2>/dev/null || echo unknown)"
  info "=============================================="
}

# ---------------------------------------------------------------------------
# Wait helpers
# ---------------------------------------------------------------------------

wait_for_url() {
  local url="$1" name="$2" max_attempts="${3:-60}" attempt=1
  info "Waiting for $name at $url (max ${max_attempts} attempts)"
  until curl -fsS "$url" >/dev/null; do
    if (( attempt >= max_attempts )); then
      error "$name not ready after ${attempt} attempts ($url)"
      return 1
    fi
    info "  ... waiting for $name (${attempt}/${max_attempts})"
    attempt=$((attempt + 1))
    sleep 2
  done
  info "$name is ready ($url)"
}

wait_for_file() {
  local path="$1" name="$2" max_attempts="${3:-60}" attempt=1
  info "Waiting for $name at $path (max ${max_attempts} attempts)"
  until [[ -s "$path" ]]; do
    if (( attempt >= max_attempts )); then
      error "$name not available after ${attempt} attempts ($path)"
      return 1
    fi
    info "  ... waiting for $name (${attempt}/${max_attempts})"
    attempt=$((attempt + 1))
    sleep 2
  done
  info "$name is available ($path)"
}

# ---------------------------------------------------------------------------
# Safety check
# ---------------------------------------------------------------------------

ensure_not_root() {
  if [[ "$(id -u)" == "0" ]]; then
    error "This helper is running as root. Gitea CLI refuses that. Configure gitea-init to run as ${GITEA_RUN_UID}:${GITEA_RUN_GID}."
    return 1
  fi
  info "Container user is non-root (uid=$(id -u)) — OK"
}

# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

user_exists_cli() {
  local username="$1"
  local output
  output="$(gitea --config "$GITEA_CONFIG_FILE" admin user list 2>/dev/null || true)"
  grep -Eq "(^|[[:space:]])${username}([[:space:]]|$)" <<<"$output"
}

ensure_user_cli() {
  local username="$1" password="$2" email="$3" admin_flag="${4:-false}"
  local -a args=(admin user create --username "$username" --password "$password" --email "$email" --must-change-password=false)
  [[ "$admin_flag" == "true" ]] && args+=(--admin)

  info "Ensuring user '$username' (admin=$admin_flag, email=$email)"
  if user_exists_cli "$username"; then
    info "User '$username' already exists — skipping"
    return 0
  fi

  local output rc
  info "Creating user '$username'"
  set +e
  output="$(gitea --config "$GITEA_CONFIG_FILE" "${args[@]}" 2>&1)"
  rc=$?
  set -e

  if (( rc == 0 )); then
    info "User '$username' created. CLI output: ${output:-<none>}"
    return 0
  fi

  if grep -Eiq 'already exists|user exists|duplicate' <<<"$output"; then
    warn "User '$username' already existed (race condition). CLI output: $output"
    return 0
  fi

  error "Failed creating user '$username' (rc=$rc): $output"
  return "$rc"
}

# ---------------------------------------------------------------------------
# Repository management
# ---------------------------------------------------------------------------

repo_exists_api() {
  local username="$1" repo="$2"
  local http_code
  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    "${API_BASE}/repos/${username}/${repo}" 2>/dev/null || echo "000")
  info "  repo_exists check: ${username}/${repo} → HTTP ${http_code}"
  [[ "$http_code" == "200" ]]
}

ensure_repo_api() {
  info "Ensuring repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}'"
  if repo_exists_api "$GITEA_WEBLATE_USER" "$GITEA_TRANSLATIONS_REPO"; then
    info "Repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}' already exists"
    return 0
  fi

  local private_json="true"
  [[ "${GITEA_TRANSLATIONS_REPO_PRIVATE,,}" == "false" ]] && private_json="false"

  local body
  body=$(printf '{"name":"%s","private":%s,"auto_init":true,"default_branch":"%s"}' \
    "$GITEA_TRANSLATIONS_REPO" "$private_json" "$GITEA_TRANSLATIONS_BRANCH")

  info "Creating repository. Payload: $body"
  local response http_code
  response=$(curl -sS -w '\n%{http_code}' \
    -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    -H 'Content-Type: application/json' \
    -X POST "${API_BASE}/user/repos" \
    -d "$body")
  http_code=$(printf '%s' "$response" | tail -n1)
  local resp_body
  resp_body=$(printf '%s' "$response" | sed '$d')

  if [[ "$http_code" -lt 200 || "$http_code" -gt 299 ]]; then
    error "Repo creation failed HTTP ${http_code}: ${resp_body}"
    return 1
  fi
  info "Repository created. Response: ${resp_body}"
}

# ---------------------------------------------------------------------------
# File management — path: <category-slug>/<lang>.json
#
# NOTE: NO "backend/" prefix.  This matches the backend application's
#       GiteaTranslationExportService.computeRepoPath():
#         return `${category}/${isoCode.toLowerCase()}.json`;
# ---------------------------------------------------------------------------

repo_file_exists_api() {
  local file_path="$1"
  local http_code
  http_code=$(curl -o /dev/null -sS -w '%{http_code}' \
    -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    "${API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${file_path}?ref=${GITEA_TRANSLATIONS_BRANCH}" \
    2>/dev/null || echo "000")
  debug "  file_exists check: ${file_path} → HTTP ${http_code}"
  [[ "$http_code" == "200" ]]
}

ensure_repo_file_api() {
  local file_path="$1" content_b64="$2" commit_message="$3"

  info "Ensuring repository file '${file_path}'"
  if repo_file_exists_api "$file_path"; then
    info "File '${file_path}' already exists — skipping"
    return 0
  fi

  local body
  body=$(printf '{"content":"%s","message":"%s","branch":"%s"}' \
    "$content_b64" "$commit_message" "$GITEA_TRANSLATIONS_BRANCH")

  info "Creating file '${file_path}' (commit: ${commit_message})"
  local response http_code
  response=$(curl -sS -w '\n%{http_code}' \
    -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    -H 'Content-Type: application/json' \
    -X POST "${API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${file_path}" \
    -d "$body")
  http_code=$(printf '%s' "$response" | tail -n1)
  local resp_body
  resp_body=$(printf '%s' "$response" | sed '$d')

  if [[ "$http_code" -lt 200 || "$http_code" -gt 299 ]]; then
    error "File creation failed HTTP ${http_code}: ${resp_body}"
    return 1
  fi
  info "File '${file_path}' created. HTTP ${http_code}"
}

# ---------------------------------------------------------------------------
# Slug helpers (must match weblate-init.sh exactly)
# ---------------------------------------------------------------------------

normalize_csv_items() {
  printf '%s' "$1" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//' \
    | sed 's/[[:space:]]*$//' \
    | sed '/^$/d'
}

slugify_category() {
  local input="$1"
  local output
  output="$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9._-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//' \
    | sed 's/-$//')"

  if [[ -z "$output" ]]; then
    error "Category '$input' becomes empty after slugification"
    return 1
  fi
  printf '%s' "$output"
}

# Build base64-encoded seed JSON for a category source file.
# {} is the correct content: Weblate needs valid JSON to accept the template file,
# but zero keys means nothing appears in the translator UI until the backend
# pushes real translation strings via GiteaTranslationExportService.
json_b64_for_category() {
  printf '{}\n' | base64 | tr -d '\n'
}

# ---------------------------------------------------------------------------
# Bootstrap per-category source files
#
# For each category in MICADO_CATEGORIES we create:
#   <category-slug>/<MICADO_SOURCE_LANG>.json
#
# This is the Weblate "template" file (source strings) for that component.
# The backend will later overwrite it with real translation keys via the API.
# ---------------------------------------------------------------------------

ensure_category_source_files_api() {
  if [[ -z "${MICADO_CATEGORIES// }" ]]; then
    warn "MICADO_CATEGORIES is empty — skipping category source file bootstrap"
    return 0
  fi

  info "Bootstrapping category source files (source lang: ${MICADO_SOURCE_LANG})"
  info "Categories: ${MICADO_CATEGORIES}"

  while IFS= read -r category; do
    [[ -z "$category" ]] && continue

    local normalized path content_b64
    normalized="$(slugify_category "$category")"

    # Path convention:  <category-slug>/<source-lang>.json
    # NO "backend/" prefix — matches GiteaTranslationExportService.computeRepoPath()
    path="${normalized}/${MICADO_SOURCE_LANG}.json"
    content_b64="$(json_b64_for_category)"

    info "  Category '${category}' → slug='${normalized}' → path='${path}'"

    ensure_repo_file_api \
      "$path" \
      "$content_b64" \
      "init ${normalized} source translations"

  done < <(normalize_csv_items "$MICADO_CATEGORIES")

  info "Category source file bootstrap completed"
}

# ---------------------------------------------------------------------------
# PAT (Personal Access Token) generation
# ---------------------------------------------------------------------------

ensure_token_file() {
  info "Checking bootstrap directory writability: $BOOTSTRAP_DIR"
  if [ ! -w "$BOOTSTRAP_DIR" ]; then
    error "Bootstrap directory '$BOOTSTRAP_DIR' is not writable by uid=$(id -u)"
    ls -ld "$BOOTSTRAP_DIR" >&2 || true
    exit 1
  fi

  mkdir -p "$BOOTSTRAP_DIR"

  if [[ -s "$TOKEN_FILE" ]]; then
    info "Reusing persisted token file '$TOKEN_FILE'"
    return 0
  fi

  info "Generating PAT '${GITEA_WEBLATE_TOKEN_NAME}' for '${GITEA_WEBLATE_USER}'"
  info "  scopes: ${GITEA_WEBLATE_TOKEN_SCOPES}"

  local output token raw_line
  output="$(gitea --config "$GITEA_CONFIG_FILE" admin user generate-access-token \
    --username "$GITEA_WEBLATE_USER" \
    --token-name "$GITEA_WEBLATE_TOKEN_NAME" \
    --scopes "$GITEA_WEBLATE_TOKEN_SCOPES" 2>&1)"

  # The command outputs: "Access token was successfully created: <token>"
  raw_line="$(printf '%s\n' "$output" | tail -n 1 | tr -d '\r')"
  token="$(printf '%s' "$raw_line" | awk '{print $NF}')"

  if [[ -z "$token" ]]; then
    error "PAT generation returned empty token"
    error "Full command output: $output"
    return 1
  fi

  info "PAT generated. Raw output line: ${raw_line}"
  info "Token value: $(mask_secret "$token")"

  printf '%s' "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  info "Token persisted to '$TOKEN_FILE'"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  info "====== Starting Gitea bootstrap ======"
  log_environment
  ensure_not_root

  info "Waiting for Gitea to be ready..."
  wait_for_file "$GITEA_CONFIG_FILE" "Gitea config" 60
  wait_for_url 'http://gitea:3000/api/healthz'   'Gitea health endpoint' 60
  wait_for_url "${API_BASE}/version"              'Gitea API version'     30

  info "Creating users..."
  ensure_user_cli "$GITEA_ADMIN_USER"   "$GITEA_ADMIN_PASSWORD"   "$GITEA_ADMIN_EMAIL"   true
  ensure_user_cli "$GITEA_WEBLATE_USER" "$GITEA_WEBLATE_PASSWORD" "$GITEA_WEBLATE_EMAIL" false

  info "Creating repository..."
  ensure_repo_api

  info "Generating PAT..."
  ensure_token_file

  info "Bootstrapping category source files..."
  ensure_category_source_files_api

  # Write a completion marker so weblate-init knows gitea-init has finished.
  # Both containers share the $BOOTSTRAP_DIR volume.
  DONE_FILE="${BOOTSTRAP_DIR}/gitea-init.done"
  printf '%s\n' "$(timestamp)" > "$DONE_FILE"
  info "Completion marker written to '${DONE_FILE}'"

  info "====== Gitea bootstrap completed successfully ======"
}

main "$@"