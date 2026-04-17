#!/bin/sh
# Container entrypoint.
#
# 1. Sync the baked-in frontend `dist/` and Django `staticfiles/` into the
#    bind-mounted target dirs so every deploy replaces stale assets (bind
#    mounts otherwise shadow the image's content).
# 2. Run DB migrations.
# 3. collectstatic (re-populates after sync so later changes land too).
# 4. Exec gunicorn with uvicorn workers (Channels needs ASGI, not WSGI).
set -e

sync_baked() {
    src="$1"
    dst="$2"
    [ -d "$src" ] || return 0
    mkdir -p "$dst"
    # Empty then copy — old hashed chunks must disappear, not linger.
    find "$dst" -mindepth 1 -delete 2>/dev/null || true
    cp -r "$src"/. "$dst"/
    echo "synced $src -> $dst"
}

sync_baked /app/.baked-dist          /app/frontend/task-tracker/dist
sync_baked /app/.baked-staticfiles   /app/staticfiles

uv run python manage.py migrate --no-input
uv run python manage.py collectstatic --no-input

exec uv run gunicorn config.asgi:application \
    -k uvicorn.workers.UvicornWorker \
    -w 3 \
    -b 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
