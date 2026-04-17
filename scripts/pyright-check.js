#!/usr/bin/env node
// Cross-platform pyright runner for pre-commit (Pylance parity).
// Invokes via `uv run` so pyright sees the same resolved environment the
// developer uses locally — `python -m pyright` fails to discover
// site-packages on some Windows setups.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

try {
  execSync('uv run pyright', { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
