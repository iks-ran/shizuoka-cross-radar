#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable.\n' "$1" >&2
    printf 'WHY: the repository harness cannot run reproducibly without it.\n' >&2
    printf 'FIX: install %s, then rerun scripts/bootstrap.sh.\n' "$2" >&2
    exit 1
  fi
}

require_command node 'Node.js 24'
require_command npm 'npm'
require_command python3 'Python 3.10 or newer'
require_command curl 'curl'

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 24 )); then
  printf 'ERROR: Node.js 24 or newer is required; found %s.\n' "$(node --version)" >&2
  printf 'WHY: local verification must match the Node.js 24 Pages workflow.\n' >&2
  printf 'FIX: activate Node.js 24 (for example, nvm use 24) and rerun bootstrap.\n' >&2
  exit 1
fi

python3 - <<'PY'
import sys

if sys.version_info < (3, 10):
    print(f"ERROR: Python 3.10 or newer is required; found {sys.version.split()[0]}.", file=sys.stderr)
    print("WHY: the data adapters and tests rely on the documented Python baseline.", file=sys.stderr)
    print("FIX: activate Python 3.10+ and rerun scripts/bootstrap.sh.", file=sys.stderr)
    raise SystemExit(1)
PY

printf 'Repository: %s\n' "$repo_root"
printf 'Installing locked frontend dependencies...\n'
npm ci

printf 'Checking the local baseline...\n'
npm run check:fast

printf 'Baseline ready. Start with: npm run dev\n'
