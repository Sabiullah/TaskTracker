#!/usr/bin/env node
// Cross-platform TypeScript type-check runner for pre-commit
const { execSync } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..', 'frontend', 'task-tracker');
try {
  execSync('npx tsc -b --noEmit', { cwd, stdio: 'inherit' });
} catch {
  process.exit(1);
}
