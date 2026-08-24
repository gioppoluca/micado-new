#!/usr/bin/env bash
set -Eeuo pipefail

# Cold, direct-volume backup for the MICADO production Compose stack.
# The script intentionally runs on the Docker host: no application container
# receives access to the Docker socket or to the backup credentials.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="${MICADO_PROJECT_DIR:-$(cd -- "${SCRIPT_DIR}/../.." && pwd)}"
readonly LOCK_FILE="${MICADO_BACKUP_LOCK_FILE:-/run/lock/micado-backup.lock}"
readonly STOP_TIMEOUT="${MICADO_BACKUP_STOP_TIMEOUT:-180}"
readonly HEALTH_TIMEOUT="${MICADO_BACKUP_HEALTH_TIMEOUT:-300}"

readonly -a COMPOSE=(
  docker compose
  --project-directory "${PROJECT_DIR}"
  -f "${PROJECT_DIR}/docker-compose.yml"
  -f "${PROJECT_DIR}/docker-compose.prod.yml"
  -f "${PROJECT_DIR}/docker-compose.backup.yml"
)

declare -a RUNNING_SERVICES=()
RESTORE_REQUIRED=0

log() {
  printf '%s [MICADO][BACKUP] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

restart_recorded_services() {
  if ((RESTORE_REQUIRED == 0)); then
    return 0
  fi

  if ((${#RUNNING_SERVICES[@]} == 0)); then
    RESTORE_REQUIRED=0
    return 0
  fi

  log "Restarting the services that were running before the backup"
  "${COMPOSE[@]}" start "${RUNNING_SERVICES[@]}"
  RESTORE_REQUIRED=0
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM

  if ((RESTORE_REQUIRED != 0)); then
    log "Backup interrupted or failed while production was stopped"
    if ! restart_recorded_services; then
      log "CRITICAL: automatic production restart failed"
      status=1
    fi
  fi

  exit "${status}"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_state() {
  local service=$1
  local container_id
  local inspected
  container_id="$("${COMPOSE[@]}" ps -q "${service}")"
  [[ -n "${container_id}" ]] || {
    printf 'missing\n'
    return 0
  }

  if ! inspected="$(docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else}}{{.State.Status}}{{end}}' \
    "${container_id}" 2>/dev/null)"; then
    printf 'unknown\n'
    return 0
  fi
  printf '%s\n' "${inspected}"
}

wait_for_recovery() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  local all_ready service state

  log "Waiting up to ${HEALTH_TIMEOUT}s for the restarted services"
  while ((SECONDS < deadline)); do
    all_ready=1

    for service in "${RUNNING_SERVICES[@]}"; do
      state="$(container_state "${service}")"
      case "${state}" in
        healthy|running)
          ;;
        exited|dead|missing)
          # A service can start before its dependency is ready after a cold
          # restart. Retry it while the infrastructure becomes healthy.
          "${COMPOSE[@]}" start "${service}" >/dev/null 2>&1 || true
          all_ready=0
          ;;
        *)
          all_ready=0
          ;;
      esac
    done

    ((all_ready != 0)) && {
      log "All previously running services are available"
      return 0
    }
    sleep 3
  done

  for service in "${RUNNING_SERVICES[@]}"; do
    log "Recovery state: ${service}=$(container_state "${service}")"
  done
  return 1
}

verify_host_time() {
  local synchronized
  if ! command -v timedatectl >/dev/null 2>&1; then
    log "WARNING: timedatectl is unavailable; host NTP status was not verified"
    return 0
  fi

  synchronized="$(timedatectl show --property=NTPSynchronized --value 2>/dev/null || true)"
  [[ "${synchronized}" == "yes" ]] || fail "Docker host clock is not NTP-synchronized"
  log "Docker host clock is NTP-synchronized"
}

main() {
  local backup_status maintenance_status

  require_command docker
  require_command flock
  require_command install
  [[ -f "${PROJECT_DIR}/.env" ]] || fail "Missing ${PROJECT_DIR}/.env"

  install -d -m 0755 "$(dirname -- "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  flock -n 9 || fail "Another MICADO backup is already running"

  verify_host_time
  "${COMPOSE[@]}" config --quiet

  # Fail before creating downtime if the repository, credentials, SSH trust,
  # network, or Restic cache cannot be used.
  log "Checking Restic repository access before stopping production"
  "${COMPOSE[@]}" --profile backup run --rm --no-deps backup snapshots --compact >/dev/null

  mapfile -t RUNNING_SERVICES < <(
    "${COMPOSE[@]}" ps --services --status running
  )
  ((${#RUNNING_SERVICES[@]} > 0)) || fail "No running MICADO services were found"

  log "Running services: ${RUNNING_SERVICES[*]}"
  RESTORE_REQUIRED=1

  log "Stopping production gracefully (timeout ${STOP_TIMEOUT}s)"
  "${COMPOSE[@]}" stop --timeout "${STOP_TIMEOUT}" "${RUNNING_SERVICES[@]}"

  if [[ -n "$("${COMPOSE[@]}" ps --services --status running)" ]]; then
    fail "At least one production service is still running"
  fi

  log "Production is stopped; starting the direct-volume Restic snapshot"
  set +e
  "${COMPOSE[@]}" --profile backup run --rm --no-deps backup
  backup_status=$?
  set -e

  # This is the earliest safe restart point: Restic has stopped reading every
  # production volume, regardless of whether it succeeded or failed.
  log "Restic finished with exit code ${backup_status}; restarting production now"
  restart_recorded_services

  if ! wait_for_recovery; then
    fail "Production did not become healthy after the backup"
  fi

  if ((backup_status != 0)); then
    fail "Restic backup failed with exit code ${backup_status}; production was restarted"
  fi

  # Retention and pruning only access the remote repository/cache, so they run
  # after production has already recovered and do not extend the outage.
  log "Applying Restic retention policy after production recovery"
  set +e
  "${COMPOSE[@]}" --profile backup run --rm --no-deps backup \
    forget \
    --tag micado-cold-backup \
    --keep-daily 14 \
    --keep-weekly 8 \
    --keep-monthly 12 \
    --keep-yearly 3 \
    --prune
  maintenance_status=$?
  set -e

  ((maintenance_status == 0)) || fail "Backup succeeded, but retention/prune failed with exit code ${maintenance_status}"
  log "Backup, production recovery and retention completed successfully"
}

main "$@"
