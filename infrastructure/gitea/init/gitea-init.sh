#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="gitea-init"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '%s [%s] [%s] %s\n' "$(timestamp)" "$APP_NAME" "$1" "$2" >&2; }
info() { log INFO "$*"; }
debug() { log DEBUG "$*"; }
warn() { log WARN "$*"; }
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
    secret)
      info "ENV $name=$(mask_secret "$value")"
      ;;
    plain)
      info "ENV $name=$value"
      ;;
    *)
      info "ENV $name=<unknown sensitivity>"
      ;;
  esac
}

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

export GITEA_WORK_DIR=/data/gitea
GITEA_CONFIG_FILE="${GITEA_CONFIG_FILE:-/data/gitea/conf/app.ini}"
BOOTSTRAP_DIR=/bootstrap
TOKEN_FILE="${BOOTSTRAP_DIR}/gitea-weblate.token"
API_BASE="http://gitea:3000/api/v1"
SEED_PATH="backend/en.json"
SEED_CONTENT_B64='ewogICJfX3NjaGVtYSI6ICJtaWNhZG8iLAogICJwaW5nIjogIlBpbmciCn0K'

on_error() {
  local line="$1" rc="$2" cmd="${3:-unknown}"
  error "Bootstrap failed at line ${line} with exit code ${rc}"
  error "Last command: ${cmd}"
}
trap 'on_error ${LINENO} $? "$BASH_COMMAND"' ERR

log_environment() {
  info "Effective bootstrap configuration follows"
  log_var GITEA_ADMIN_USER "$GITEA_ADMIN_USER"
  log_var GITEA_ADMIN_PASSWORD "$GITEA_ADMIN_PASSWORD" secret
  log_var GITEA_ADMIN_EMAIL "$GITEA_ADMIN_EMAIL"
  log_var GITEA_WEBLATE_USER "$GITEA_WEBLATE_USER"
  log_var GITEA_WEBLATE_PASSWORD "$GITEA_WEBLATE_PASSWORD" secret
  log_var GITEA_WEBLATE_EMAIL "$GITEA_WEBLATE_EMAIL"
  log_var GITEA_TRANSLATIONS_REPO "$GITEA_TRANSLATIONS_REPO"
  log_var GITEA_TRANSLATIONS_BRANCH "$GITEA_TRANSLATIONS_BRANCH"
  log_var GITEA_TRANSLATIONS_REPO_PRIVATE "$GITEA_TRANSLATIONS_REPO_PRIVATE"
  log_var GITEA_WEBLATE_TOKEN_NAME "$GITEA_WEBLATE_TOKEN_NAME"
  log_var GITEA_WEBLATE_TOKEN_SCOPES "$GITEA_WEBLATE_TOKEN_SCOPES"
  log_var GITEA_CONFIG_FILE "$GITEA_CONFIG_FILE"
  log_var GITEA_WORK_DIR "$GITEA_WORK_DIR"
  log_var BOOTSTRAP_DIR "$BOOTSTRAP_DIR"
  log_var TOKEN_FILE "$TOKEN_FILE"
  log_var API_BASE "$API_BASE"
  log_var SEED_PATH "$SEED_PATH"
  info "Seed payload base64 length=${#SEED_CONTENT_B64}"
}

run_gitea() {
  local output rc
  info "Executing Gitea CLI: gitea --config $GITEA_CONFIG_FILE $*"
  set +e
  output="$(gitea --config "$GITEA_CONFIG_FILE" "$@" 2>&1)"
  rc=$?
  set -e
  if (( rc != 0 )); then
    error "Gitea CLI failed (rc=$rc): ${output}"
    return "$rc"
  fi
  if [[ -n "$output" ]]; then
    info "Gitea CLI output: ${output}"
  else
    debug "Gitea CLI completed without output"
  fi
}

wait_for_url() {
  local url="$1" name="$2" max_attempts="${3:-60}" attempt=1
  until curl -fsS "$url" >/dev/null; do
    if (( attempt >= max_attempts )); then
      error "$name not ready after ${attempt} attempts ($url)"
      return 1
    fi
    info "Waiting for $name (${attempt}/${max_attempts}) at $url"
    attempt=$((attempt + 1))
    sleep 2
  done
  info "$name is ready ($url)"
}

wait_for_file() {
  local path="$1" name="$2" max_attempts="${3:-60}" attempt=1
  until [[ -s "$path" ]]; do
    if (( attempt >= max_attempts )); then
      error "$name not available after ${attempt} attempts ($path)"
      return 1
    fi
    info "Waiting for $name (${attempt}/${max_attempts}) at $path"
    attempt=$((attempt + 1))
    sleep 2
  done
  info "$name is available ($path)"
}

user_exists_api() {
  local admin_user="$1" admin_pass="$2" username="$3"
  debug "Checking via API whether user '$username' exists"
  curl -fsS -u "$admin_user:$admin_pass" "${API_BASE}/users/${username}" >/dev/null
}

ensure_user_cli() {
  local username="$1" password="$2" email="$3" admin_flag="${4:-false}"
  local -a args=(admin user create --username "$username" --password "$password" --email "$email" --must-change-password=false)
  [[ "$admin_flag" == "true" ]] && args+=(--admin)

  info "Ensuring user '$username' exists (admin=$admin_flag, email=$email)"
  if user_exists_api "$GITEA_ADMIN_USER" "$GITEA_ADMIN_PASSWORD" "$username"; then
    info "User '$username' already exists according to API"
    return 0
  fi

  local output rc
  info "Creating user '$username' through Gitea CLI"
  set +e
  output="$(gitea --config "$GITEA_CONFIG_FILE" "${args[@]}" 2>&1)"
  rc=$?
  set -e

  if (( rc == 0 )); then
    if [[ -n "$output" ]]; then
      info "User '$username' created. CLI output: $output"
    else
      info "User '$username' created"
    fi
    return 0
  fi

  if grep -Eiq 'already exists|user exists|duplicate' <<<"$output"; then
    warn "User '$username' already exists according to Gitea CLI, continuing: $output"
    return 0
  fi

  error "Failed creating user '$username' (rc=$rc): $output"
  return "$rc"
}

repo_exists_api() {
  local username="$1" repo="$2"
  debug "Checking via API whether repository '${username}/${repo}' exists"
  curl -fsS -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" "${API_BASE}/repos/${username}/${repo}" >/dev/null
}

ensure_repo_api() {
  info "Ensuring repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}' exists"
  if repo_exists_api "$GITEA_WEBLATE_USER" "$GITEA_TRANSLATIONS_REPO"; then
    info "Repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}' already exists"
    return 0
  fi

  local private_json="true"
  if [[ "${GITEA_TRANSLATIONS_REPO_PRIVATE,,}" == "false" ]]; then
    private_json="false"
  fi
  info "Creating repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}' with branch '${GITEA_TRANSLATIONS_BRANCH}' private=${private_json}"

  curl -fsS -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    -H "Content-Type: application/json" \
    -X POST "${API_BASE}/user/repos" \
    -d @- >/dev/null <<JSON
{
  "name": "${GITEA_TRANSLATIONS_REPO}",
  "private": ${private_json},
  "auto_init": true,
  "default_branch": "${GITEA_TRANSLATIONS_BRANCH}"
}
JSON
  info "Repository '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}' created"
}

file_exists_api() {
  debug "Checking via API whether seed file '${SEED_PATH}' exists in '${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}'"
  curl -fsS -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    "${API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${SEED_PATH}?ref=${GITEA_TRANSLATIONS_BRANCH}" >/dev/null
}

ensure_seed_file_api() {
  info "Ensuring seed file '${SEED_PATH}' exists"
  if file_exists_api; then
    info "Seed file '${SEED_PATH}' already exists"
    return 0
  fi

  info "Creating seed file '${SEED_PATH}' on branch '${GITEA_TRANSLATIONS_BRANCH}'"
  curl -fsS -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD" \
    -H "Content-Type: application/json" \
    -X POST "${API_BASE}/repos/${GITEA_WEBLATE_USER}/${GITEA_TRANSLATIONS_REPO}/contents/${SEED_PATH}" \
    -d @- >/dev/null <<JSON
{
  "content": "${SEED_CONTENT_B64}",
  "message": "init translations skeleton",
  "branch": "${GITEA_TRANSLATIONS_BRANCH}"
}
JSON
  info "Seed file '${SEED_PATH}' created"
}

ensure_token_file() {
  info "Ensuring PAT file exists at '$TOKEN_FILE'"
  mkdir -p "$BOOTSTRAP_DIR"
  if [[ -s "$TOKEN_FILE" ]]; then
    info "Reusing persisted token file '$TOKEN_FILE'"
    return 0
  fi

  info "Generating PAT '${GITEA_WEBLATE_TOKEN_NAME}' for '${GITEA_WEBLATE_USER}' with scopes '${GITEA_WEBLATE_TOKEN_SCOPES}'"
  local output token
  output="$(gitea --config "$GITEA_CONFIG_FILE" admin user generate-access-token \
    --username "$GITEA_WEBLATE_USER" \
    --token-name "$GITEA_WEBLATE_TOKEN_NAME" \
    --scopes "$GITEA_WEBLATE_TOKEN_SCOPES" 2>&1)"
  token="$(printf '%s\n' "$output" | tail -n 1 | tr -d '\r')"
  if [[ -z "$token" ]]; then
    error "PAT generation returned empty output: $output"
    return 1
  fi
  printf '%s' "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  info "Persisted token to '$TOKEN_FILE' with masked value $(mask_secret "$token")"
}

main() {
  info "Starting unattended Gitea bootstrap"
  log_environment
  wait_for_file "$GITEA_CONFIG_FILE" "Gitea config" 60
  wait_for_url "http://gitea:3000/api/healthz" "Gitea API" 60
  wait_for_url "${API_BASE}/version" "Gitea API version endpoint" 30

  info "About to ensure admin and Weblate users"
  ensure_user_cli "$GITEA_ADMIN_USER" "$GITEA_ADMIN_PASSWORD" "$GITEA_ADMIN_EMAIL" true
  ensure_user_cli "$GITEA_WEBLATE_USER" "$GITEA_WEBLATE_PASSWORD" "$GITEA_WEBLATE_EMAIL" false

  info "About to ensure repository, seed file, and PAT"
  ensure_repo_api
  ensure_seed_file_api
  ensure_token_file

  info "Gitea bootstrap completed successfully"
}

main "$@"
