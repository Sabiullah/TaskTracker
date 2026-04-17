#!/usr/bin/env node
// Cross-platform mypy runner for pre-commit (uses django-stubs plugin).
// Invokes via `uv run` so the resolved environment matches local runs.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

try {
  execSync('uv run mypy .', { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
