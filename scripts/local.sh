#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${COURSESNAG_LOCAL_PORT:-4173}"

if [[ "$PORT" != "4173" ]]; then
  echo "Cloud testing is authorized only for http://localhost:4173." >&2
  echo "Use port 4173 or redeploy with a matching LOCAL_DEVELOPMENT_ORIGIN." >&2
  exit 1
fi

echo "CourseSnag local test site: http://localhost:${PORT}"
echo "Keep this terminal open while testing. Press Ctrl+C to stop."
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$PROJECT_ROOT"
