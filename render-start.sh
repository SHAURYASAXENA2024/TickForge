
#!/usr/bin/env bash
set -euo pipefail

ROOT=/app
DATA="$ROOT/.run/data"
LOGS="$ROOT/.run/logs"
PY="$ROOT/.venv/bin/python"
ENGINE="$ROOT/.run/build/engine/engine_server"
REPLAY="$ROOT/.run/build/engine/wal_replay"

mkdir -p "$DATA" "$LOGS"

"$ENGINE" --port 9100 --wal "$DATA/engine.wal" --accounts \
    > "$LOGS/engine.log" 2>&1 &
ENGINE_PID=$!

cd "$ROOT/services/exchange-api"
env TICKFORGE_ENGINE_PORT=9100 \
    TICKFORGE_DATA_DIR="$DATA" \
    TICKFORGE_REPLAY_BIN="$REPLAY" \
    "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 \
    > "$LOGS/exchange-api.log" 2>&1 &
EXCHANGE_PID=$!

cd "$ROOT/services/market-data"
env TICKFORGE_DATA_DIR="$DATA" \
    "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 \
    > "$LOGS/market-data.log" 2>&1 &
MARKET_PID=$!

cleanup() {
    kill "$ENGINE_PID" "$EXCHANGE_PID" "$MARKET_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

nginx -t
nginx -g 'daemon off;' &
NGINX_PID=$!

wait -n "$ENGINE_PID" "$EXCHANGE_PID" "$MARKET_PID" "$NGINX_PID"
