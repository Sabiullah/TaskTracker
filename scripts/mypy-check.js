#!/usr/bin/env node
// Cross-platform mypy runner for pre-commit (uses django-stubs plugin).
// Invokes via `uv run` so the resolved environment matches local runs.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// django-stubs plugin loads Django settings to infer model types. Provide
// placeholder env vars so the plugin can construct even when the runtime
// environment (e.g. a CI pre-commit job) has no .env file.
const env = {
  ...process.env,
  SECRET_KEY: process.env.SECRET_KEY || 'precommit-placeholder-not-a-real-secret',
  DEBUG: process.env.DEBUG || 'True',
  ALLOWED_HOSTS: process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1',
  DATABASE_URL: process.env.DATABASE_URL || 'sqlite:///precommit.sqlite3',
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
};

try {
  execSync('uv run mypy .', { cwd: root, stdio: 'inherit', env });
} catch {
  process.exit(1);
}
