#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

printf 'Running static-data, Python, and frontend checks...\n'
npm run check:fast

printf 'Exercising the production build through the local preview server...\n'
npm run smoke

printf 'Full verification passed.\n'
