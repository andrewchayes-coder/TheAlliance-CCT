#!/bin/sh
set -eu
# Runtime receives Replit's production DATABASE_URL, not the build/workspace connection.
if [ "${NODE_ENV:-}" != "production" ]; then
  echo "Production launcher requires NODE_ENV=production." >&2
  exit 1
fi
node artifacts/api-server/dist/preflight.mjs
pnpm --filter @workspace/db run migrate
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
