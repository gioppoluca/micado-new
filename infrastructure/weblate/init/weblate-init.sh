#!/bin/sh
set -eu

APP_NAME="weblate-init"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { level="$1"; shift; printf '%s [%s] [%s] %s\n' "$(timestamp)" "$APP_NAME" "$level" "$*" >&2; }
info() { log INFO "$@"; }
warn() { log WARN "$@"; }
error() { log ERROR "$@"; }

on_error() {
  rc=$?
  line=${1:-unknown}
  cmd=${2:-unknown}
  error "Bootstrap failed at line ${line} with exit code ${rc}"
  error "Last command: ${cmd}"
  exit "$rc"
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR 2>/dev/null || true

: "${WEBLATE_URL:=http://weblate:8080}"
: "${WEBLATE_PROJECT_NAME:=micado}"
: "${WEBLATE_PROJECT_SLUG:=micado}"
: "${WEBLATE_PROJECT_WEB:=http://weblate.local}"
: "${WEBLATE_PROJECT_INSTRUCTIONS:=Micado translation project bootstrap managed by Docker Compose.}"
: "${WEBLATE_IMPORT_COMPONENTS:=true}"
: "${WEBLATE_GIT_REPO:=http://gitea:3000/weblate-bot/translations.git}"
: "${WEBLATE_GIT_BRANCH:=main}"
: "${WEBLATE_FILEMASK:=backend/*.json}"
: "${WEBLATE_BASE_FILE_TEMPLATE:=backend/en.json}"
: "${WEBLATE_FILE_FORMAT:=json}"
: "${WEBLATE_NAME_TEMPLATE:=Backend}"
: "${WEBLATE_LOG_LEVEL:=INFO}"
: "${BOOTSTRAP_DIR:=/bootstrap}"
: "${TOKEN_FILE:=${BOOTSTRAP_DIR}/gitea-weblate.token}"
: "${WEBLATE_ADMIN_USER:=admin}"
: "${WEBLATE_ADMIN_PASSWORD:=admin}"
: "${WEBLATE_ADMIN_EMAIL:=admin@example.invalid}"

mask() {
  val="$1"
  len=$(printf '%s' "$val" | wc -c | tr -d ' ')
  if [ "$len" -le 4 ]; then
    printf '**** (len=%s)' "$len"
  else
    first=$(printf '%s' "$val" | cut -c1-2)
    last=$(printf '%s' "$val" | rev | cut -c1-2 | rev)
    printf '%s****%s (len=%s)' "$first" "$last" "$len"
  fi
}

log_env() {
  info "Effective bootstrap configuration follows"
  info "ENV WEBLATE_URL=${WEBLATE_URL}"
  info "ENV WEBLATE_PROJECT_NAME=${WEBLATE_PROJECT_NAME}"
  info "ENV WEBLATE_PROJECT_SLUG=${WEBLATE_PROJECT_SLUG}"
  info "ENV WEBLATE_PROJECT_WEB=${WEBLATE_PROJECT_WEB}"
  info "ENV WEBLATE_PROJECT_INSTRUCTIONS=${WEBLATE_PROJECT_INSTRUCTIONS}"
  info "ENV WEBLATE_IMPORT_COMPONENTS=${WEBLATE_IMPORT_COMPONENTS}"
  info "ENV WEBLATE_GIT_REPO=${WEBLATE_GIT_REPO}"
  info "ENV WEBLATE_GIT_BRANCH=${WEBLATE_GIT_BRANCH}"
  info "ENV WEBLATE_FILEMASK=${WEBLATE_FILEMASK}"
  info "ENV WEBLATE_BASE_FILE_TEMPLATE=${WEBLATE_BASE_FILE_TEMPLATE}"
  info "ENV WEBLATE_FILE_FORMAT=${WEBLATE_FILE_FORMAT}"
  info "ENV WEBLATE_NAME_TEMPLATE=${WEBLATE_NAME_TEMPLATE}"
  info "ENV WEBLATE_LOG_LEVEL=${WEBLATE_LOG_LEVEL}"
  info "ENV BOOTSTRAP_DIR=${BOOTSTRAP_DIR}"
  info "ENV TOKEN_FILE=${TOKEN_FILE}"
  info "ENV WEBLATE_ADMIN_USER=${WEBLATE_ADMIN_USER}"
  info "ENV WEBLATE_ADMIN_PASSWORD=$(mask "$WEBLATE_ADMIN_PASSWORD")"
  info "ENV WEBLATE_ADMIN_EMAIL=${WEBLATE_ADMIN_EMAIL}"
  if [ -r "$TOKEN_FILE" ]; then
    token_preview=$(head -c 8 "$TOKEN_FILE" 2>/dev/null || true)
    info "TOKEN_FILE present=yes preview=$(mask "$token_preview")"
  else
    warn "TOKEN_FILE present=no path=${TOKEN_FILE}"
  fi
}

wait_for_url() {
  url="$1"
  name="$2"
  max_attempts="${3:-60}"
  attempt=1
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      error "$name not ready after ${attempt} attempts ($url)"
      return 1
    fi
    info "Waiting for $name (${attempt}/${max_attempts})"
    attempt=$((attempt + 1))
    sleep 3
  done
  info "$name is ready"
}

resolve_weblate_cli() {
  if command -v weblate >/dev/null 2>&1; then
    WEBLATE_CLI="weblate"
    WEBLATE_SHELL_MODE="cli"
  elif command -v python3 >/dev/null 2>&1 && [ -f /app/manage.py ]; then
    WEBLATE_CLI="python3 /app/manage.py"
    WEBLATE_SHELL_MODE="manage"
  elif command -v python >/dev/null 2>&1 && [ -f /app/manage.py ]; then
    WEBLATE_CLI="python /app/manage.py"
    WEBLATE_SHELL_MODE="manage"
  else
    error "Could not find Weblate CLI or /app/manage.py inside container"
    return 1
  fi
  info "Resolved Weblate command: ${WEBLATE_CLI} (mode=${WEBLATE_SHELL_MODE})"
}

weblate_shell() {
  code="$1"
  if [ "$WEBLATE_SHELL_MODE" = "cli" ]; then
    sh -c "$WEBLATE_CLI shell -c \"$code\""
  else
    sh -c "$WEBLATE_CLI shell -c \"$code\""
  fi
}

weblate_cmd() {
  subcmd="$1"
  shift
  sh -c "$WEBLATE_CLI $subcmd \"$@\"" >/dev/null
}

ensure_project() {
  info "Ensuring Weblate project '${WEBLATE_PROJECT_SLUG}' exists"
  export WEBLATE_PROJECT_NAME WEBLATE_PROJECT_SLUG WEBLATE_PROJECT_WEB WEBLATE_PROJECT_INSTRUCTIONS
  result=$(
    weblate shell -c 'import os; from weblate.trans.models.project import Project; project, created = Project.objects.get_or_create(slug=os.environ["WEBLATE_PROJECT_SLUG"], defaults={"name": os.environ["WEBLATE_PROJECT_NAME"], "web": os.environ["WEBLATE_PROJECT_WEB"], "instructions": os.environ["WEBLATE_PROJECT_INSTRUCTIONS"]}); changed = False; \
for field, env_name in (("name","WEBLATE_PROJECT_NAME"),("web","WEBLATE_PROJECT_WEB"),("instructions","WEBLATE_PROJECT_INSTRUCTIONS")): \
    value = os.environ[env_name]; \
    changed = changed or getattr(project, field) != value; \
    setattr(project, field, value); \
project.save() if changed else None; \
print("created" if created else ("updated" if changed else "exists"))' 2>&1 | tail -n 1
  )
  info "Project ensure result: ${result:-unknown}"
}

import_components() {
  if [ "$(printf '%s' "$WEBLATE_IMPORT_COMPONENTS" | tr '[:upper:]' '[:lower:]')" != "true" ]; then
    warn "WEBLATE_IMPORT_COMPONENTS is disabled, skipping component import"
    return 0
  fi

  info "Importing components from '${WEBLATE_GIT_REPO}' using filemask '${WEBLATE_FILEMASK}'"
  if sh -c "$WEBLATE_CLI import_project --name-template \"$WEBLATE_NAME_TEMPLATE\" --file-format \"$WEBLATE_FILE_FORMAT\" --base-file-template \"$WEBLATE_BASE_FILE_TEMPLATE\" \"$WEBLATE_PROJECT_SLUG\" \"$WEBLATE_GIT_REPO\" \"$WEBLATE_GIT_BRANCH\" \"$WEBLATE_FILEMASK\"" >/tmp/weblate-import.log 2>&1; then
    info "Component import completed"
  else
    if grep -Eqi 'already exists|duplicate|exists' /tmp/weblate-import.log 2>/dev/null; then
      warn "Component import reported existing resources; treating as idempotent success"
      sed 's/^/IMPORT: /' /tmp/weblate-import.log >&2 || true
    else
      error "Component import failed"
      sed 's/^/IMPORT: /' /tmp/weblate-import.log >&2 || true
      return 1
    fi
  fi
}

refresh_repos() {
  info "Refreshing imported repositories for project '${WEBLATE_PROJECT_SLUG}'"
  if sh -c "$WEBLATE_CLI updategit \"$WEBLATE_PROJECT_SLUG\"" >/tmp/weblate-updategit.log 2>&1; then
    info "updategit completed"
  else
    warn "updategit returned a non-zero exit code"
    sed 's/^/UPDATEGIT: /' /tmp/weblate-updategit.log >&2 || true
  fi
}

main() {
  info "Checking mounts"
  ls -ld /bootstrap /app/data || true
  ls -l /bootstrap || true
  ls -l /app/data/settings-override.py || true
  info "Starting unattended Weblate bootstrap"
  log_env
  resolve_weblate_cli
  wait_for_url "${WEBLATE_URL}/api/" "Weblate API"
  wait_for_url "${WEBLATE_URL}/api/schema/" "Weblate API schema" 30 || true
  ensure_project
  import_components
  refresh_repos
  info "Weblate bootstrap completed successfully"
}

main "$@"
