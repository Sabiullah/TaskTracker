# syntax=docker/dockerfile:1.7

# ── Stage 1: build the React frontend ──────────────────────────────────────
FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/task-tracker/package.json frontend/task-tracker/package-lock.json ./
RUN npm ci
COPY frontend/task-tracker/ ./
RUN npm run build

# ── Stage 2: Python runtime ────────────────────────────────────────────────
FROM python:3.14-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpq5 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution inside the image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install Python deps (prod only) — cached layer unless lockfile changes
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev --no-install-project \
 || uv sync --no-dev --no-install-project

# Application source
COPY . .

# Bring in the built frontend from stage 1 — BUT bake it to a path that is
# NOT bind-mounted at runtime. docker-compose.yml bind-mounts the host's
# ./frontend/task-tracker/dist onto /app/frontend/task-tracker/dist, which
# would shadow the image contents. The entrypoint syncs .baked-dist into
# that path at container start so every deploy replaces stale assets.
COPY --from=frontend /build/dist /app/.baked-dist
RUN mkdir -p /app/frontend/task-tracker/dist

# Same pattern for Django's collected static (admin/DRF assets).
#   SECRET_KEY is unused by collectstatic but required by settings.py
RUN SECRET_KEY=build-only \
    DEBUG=False \
    ALLOWED_HOSTS=localhost \
    DATABASE_URL=sqlite:///tmp.sqlite3 \
    uv run python manage.py collectstatic --noinput \
 && mv /app/staticfiles /app/.baked-staticfiles \
 && mkdir -p /app/staticfiles

RUN chmod +x deploy/entrypoint.sh

EXPOSE 8000

# Entrypoint runs migrate + collectstatic then exec's gunicorn with the
# uvicorn worker (Channels needs ASGI, not WSGI).
CMD ["deploy/entrypoint.sh"]
