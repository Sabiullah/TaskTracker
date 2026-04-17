#!/bin/sh
# Container entrypoint — runs DB migrations + collectstatic then hands off
# to gunicorn (with uvicorn workers so WebSockets work).
#
# Keeps the gunicorn flags in one place, so we don't have to fight YAML
# folded-scalar whitespace rules in docker-compose.yml.
set -e

uv run python manage.py migrate --no-input
uv run python manage.py collectstatic --no-input

exec uv run gunicorn config.asgi:application \
    -k uvicorn.workers.UvicornWorker \
    -w 3 \
    -b 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
