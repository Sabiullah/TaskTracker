#!/usr/bin/env bash
# Local-only Postgres backup with 7-daily + 4-weekly retention.
#
# Runs on the VPS host (not inside a container). Invokes pg_dump via
# `docker compose exec` against the running postgres service, gzips the
# dump, writes it under $BACKUP_ROOT, and prunes old files.
#
# Install via crontab — see deploy/crontab.example.
#
# Required environment (set in the cron entry or /etc/environment):
#   APP_DIR       absolute path to the TaskTracker checkout on the server
#   BACKUP_ROOT   absolute path for backup storage (e.g. /var/backups/tasktracker)

set -euo pipefail

: "${APP_DIR:?APP_DIR must be set}"
: "${BACKUP_ROOT:?BACKUP_ROOT must be set}"

cd "$APP_DIR"

# Load POSTGRES_* from the app .env so we know which DB/user to dump
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${POSTGRES_DB:?POSTGRES_DB missing from .env}"
: "${POSTGRES_USER:?POSTGRES_USER missing from .env}"

DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DAILY_FILE="$DAILY_DIR/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"

echo "[$(date -Is)] Starting backup → $DAILY_FILE"

# -T disables TTY allocation so cron works. --no-owner keeps dumps portable.
docker compose exec -T postgres \
    pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 \
  > "$DAILY_FILE"

SIZE="$(du -h "$DAILY_FILE" | cut -f1)"
echo "[$(date -Is)] Dump written, size $SIZE"

# ── Weekly rollover (every Sunday) ─────────────────────────────────────────
if [ "$(date +%u)" = "7" ]; then
    cp -a "$DAILY_FILE" "$WEEKLY_DIR/"
    echo "[$(date -Is)] Copied to weekly archive"
fi

# ── Retention ──────────────────────────────────────────────────────────────
# Keep 7 daily, 4 weekly — delete older files.
find "$DAILY_DIR"  -type f -name "*.sql.gz" -mtime +7  -print -delete || true
find "$WEEKLY_DIR" -type f -name "*.sql.gz" -mtime +28 -print -delete || true

echo "[$(date -Is)] Backup complete"
