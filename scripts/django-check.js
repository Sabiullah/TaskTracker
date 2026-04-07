#!/usr/bin/env node
// Cross-platform Django system check runner for pre-commit
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');

// Resolve venv python across platforms
const venvPython = process.platform === 'win32'
  ? path.join(root, '.venv', 'Scripts', 'python.exe')
  : path.join(root, '.venv', 'bin', 'python');

if (!fs.existsSync(venvPython)) {
  console.error(`Virtual environment python not found at: ${venvPython}`);
  console.error('Run: python -m venv .venv && .venv/bin/pip install -r requirements.txt');
  process.exit(1);
}

try {
  execFileSync(venvPython, ['manage.py', 'check'], { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
