#!/usr/bin/env bash
set -euo pipefail

: "${GITEA_ADMIN_USER:=gitea-admin}"
: "${GITEA_ADMIN_PASSWORD:=gitea-admin}"
: "${GITEA_ADMIN_EMAIL:=admin@example.com}"

: "${GITEA_WEBLATE_USER:=weblate-bot}"
: "${GITEA_WEBLATE_PASSWORD:=weblate-bot}"
: "${GITEA_WEBLATE_EMAIL:=weblate-bot@example.com}"

: "${GITEA_TRANSLATIONS_REPO:=backend-translations}"

# Gitea binary expects WORK_DIR; in docker image it's /data/gitea
export GITEA_WORK_DIR=/data/gitea

echo "[gitea-init] Running migrate..."
gitea migrate || true

echo "[gitea-init] Creating users (idempotent)..."
gitea admin user create --username "$GITEA_ADMIN_USER" --password "$GITEA_ADMIN_PASSWORD" --email "$GITEA_ADMIN_EMAIL" --admin --must-change-password=false || true
gitea admin user create --username "$GITEA_WEBLATE_USER" --password "$GITEA_WEBLATE_PASSWORD" --email "$GITEA_WEBLATE_EMAIL" --must-change-password=false || true

echo "[gitea-init] Waiting for HTTP..."
until curl -sf "http://gitea:3000/" >/dev/null; do
  sleep 2
done

echo "[gitea-init] Creating repo for Weblate user (idempotent)..."
curl -sf -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD"   -H "Content-Type: application/json"   -X POST "http://gitea:3000/api/v1/user/repos"   -d "{"name":"$GITEA_TRANSLATIONS_REPO","private":true,"auto_init":true}" >/dev/null || true

echo "[gitea-init] Ensuring initial translation skeleton exists..."
# Create /backend/en.json to give Weblate a stable file to track
curl -sf -u "$GITEA_WEBLATE_USER:$GITEA_WEBLATE_PASSWORD"   -H "Content-Type: application/json"   -X POST "http://gitea:3000/api/v1/repos/$GITEA_WEBLATE_USER/$GITEA_TRANSLATIONS_REPO/contents/backend/en.json"   -d '{"content":"ewogICJfX3NjaGVtYSI6ICJiYWNrZW5kLWxvY2FsZXMiLAogICJwaW5nIjogIlBpbmciLAogICJ3aG9hbWkiOiAiV2hvIGFtIEk/Igp9Cg==","message":"init translations skeleton","branch":"main"}' >/dev/null || true

echo "[gitea-init] Done."
