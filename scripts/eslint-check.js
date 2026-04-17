#!/usr/bin/env node
// Cross-platform ESLint runner for pre-commit
const { execSync } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..', 'frontend', 'task-tracker');
try {
  execSync('npx eslint --max-warnings=0 .', { cwd, stdio: 'inherit' });
} catch {
  process.exit(1);
}
