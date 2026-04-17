#!/usr/bin/env node
// Fails the commit if models have changed without a matching migration.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

try {
  execSync('uv run python manage.py makemigrations --check --dry-run', {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  console.error('\nModel changes detected without a matching migration.');
  console.error('Run: uv run python manage.py makemigrations');
  process.exit(1);
}
