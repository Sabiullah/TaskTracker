#!/usr/bin/env node
// Cross-platform Django system check runner for pre-commit.
// Invokes via `uv run` so it matches the way developers run locally.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// Supply placeholder settings so the check can load Django config even when
// the runtime environment (e.g. a CI pre-commit job) has no .env file. Real
// environments keep their own values; these are only fallbacks.
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
  execSync('uv run python manage.py check', { cwd: root, stdio: 'inherit', env });
} catch {
  process.exit(1);
}
