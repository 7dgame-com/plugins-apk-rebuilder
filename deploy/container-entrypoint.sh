#!/bin/sh
set -e

NODE_HOST="${HOST:-0.0.0.0}"
NODE_PORT="${PORT:-3007}"

echo "[entrypoint] starting apk-rebuilder backend on ${NODE_HOST}:${NODE_PORT}"
node /app/dist/index.js &
NODE_PID=$!

cleanup() {
  if kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

export NGINX_TEMPLATE="${NGINX_TEMPLATE:-/etc/nginx/templates/default.conf.template}"
export NGINX_OUTPUT="${NGINX_OUTPUT:-/etc/nginx/conf.d/default.conf}"
export DEBUG_ENV_FILE="${DEBUG_ENV_FILE:-/var/www/apk-rebuilder/debug-env.json}"

exec /usr/local/bin/nginx-entrypoint-apk-rebuilder.sh
