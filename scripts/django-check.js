#!/usr/bin/env node
// Cross-platform Django system check runner for pre-commit.
// Invokes via `uv run` so it matches the way developers run locally.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

try {
  execSync('uv run python manage.py check', { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
