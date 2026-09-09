#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

smoke_port="${RADAR_SMOKE_PORT:-4173}"
smoke_url="http://127.0.0.1:${smoke_port}"
mkdir -p .tmp
smoke_log=".tmp/preview-smoke.log"

npm run build
npm run preview -- --host 127.0.0.1 --port "$smoke_port" --strictPort >"$smoke_log" 2>&1 &
preview_pid=$!

cleanup() {
  kill "$preview_pid" >/dev/null 2>&1 || true
  wait "$preview_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=false
for _ in {1..40}; do
  if curl --fail --silent "$smoke_url/" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "$preview_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if [[ "$ready" != true ]]; then
  printf 'ERROR: production preview did not become ready at %s.\n' "$smoke_url" >&2
  printf 'WHY: a successful build is not enough if the generated site cannot start.\n' >&2
  printf 'FIX: inspect %s and resolve the preview startup failure.\n' "$smoke_log" >&2
  sed -n '1,120p' "$smoke_log" >&2
  exit 1
fi

index_html="$(curl --fail --silent --show-error "$smoke_url/")"
if [[ "$index_html" != *'./assets/'* ]]; then
  printf 'ERROR: the preview HTML does not reference built assets with relative URLs.\n' >&2
  printf 'WHY: absolute development paths break GitHub project Pages deployments.\n' >&2
  printf 'FIX: preserve the relative Vite base and rebuild the site.\n' >&2
  exit 1
fi

for data_file in timetable formations latest; do
  curl --fail --silent --show-error "$smoke_url/data/${data_file}.json" \
    | python3 -m json.tool >/dev/null
done

python3 -m scripts.smoke_history "$smoke_url"

printf 'Smoke passed: built assets and all static JSON load from %s.\n' "$smoke_url"
