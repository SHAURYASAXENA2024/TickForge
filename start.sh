#!/usr/bin/env bash
# TickForge master launch script
# Starts all components in the correct dependency order.
# Usage: bash start.sh [--no-rust] [--no-engine] [--no-frontend]
# Logs from each service go to logs/<service>.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

NO_RUST=false
NO_ENGINE=false
NO_FRONTEND=false
for arg in "$@"; do
  case $arg in
    --no-rust)     NO_RUST=true ;;
    --no-engine)   NO_ENGINE=true ;;
    --no-frontend) NO_FRONTEND=true ;;
  esac
done

PIDS=()

cleanup() {
  echo ""
  echo "[start.sh] Shutting down all services…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Kill the C++ engine server socket
  rm -f /tmp/tickforge_engine.sock
  echo "[start.sh] Done."
}
trap cleanup EXIT INT TERM

# ── Colour helpers ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
info() { echo -e "${CYAN}[..] $*${NC}"; }
warn() { echo -e "${YELLOW}[warn] $*${NC}"; }
err()  { echo -e "${RED}[err] $*${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TickForge — Full Stack Launcher"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Build Rust LSM database (PyO3 .so) ────────────────────────────
if [ "$NO_RUST" = false ]; then
  info "Building Rust LSM database (tickforge_db PyO3 extension)…"
  if command -v maturin &>/dev/null; then
    (cd "$ROOT/tickforge-db" && maturin develop --release 2>&1 | tee "$LOG_DIR/rust_build.log")
    ok "Rust database built and installed"
  else
    warn "maturin not found — trying 'pip install maturin' first"
    pip install maturin --quiet
    (cd "$ROOT/tickforge-db" && maturin develop --release 2>&1 | tee "$LOG_DIR/rust_build.log")
    ok "Rust database built and installed"
  fi
else
  warn "Skipping Rust build (--no-rust)"
fi

# ── Step 2: Build C++ engine server ───────────────────────────────────────
if [ "$NO_ENGINE" = false ]; then
  info "Building C++ engine server…"
  BUILD_DIR="$ROOT/matching-engine/build"
  # Always wipe the build dir to avoid stale CMakeCache.txt from a different source path
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
  (cd "$BUILD_DIR" && \
   cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 2>&1 | tee "$LOG_DIR/cmake.log" && \
   cmake --build . --target engine_server -j"$(nproc)" 2>&1 | tee "$LOG_DIR/cpp_build.log")
  ok "C++ engine_server built at $BUILD_DIR/engine_server"

  # Step 3: Start C++ engine server
  info "Starting C++ engine server on /tmp/tickforge_engine.sock…"
  "$BUILD_DIR/engine_server" >"$LOG_DIR/engine_server.log" 2>&1 &
  PIDS+=($!)
  # Wait for socket to appear
  for i in $(seq 1 20); do
    [ -S /tmp/tickforge_engine.sock ] && break
    sleep 0.3
  done
  if [ -S /tmp/tickforge_engine.sock ]; then
    ok "Engine server ready"
  else
    warn "Engine server socket not found after 6s — check $LOG_DIR/engine_server.log"
  fi
else
  warn "Skipping C++ engine build (--no-engine)"
fi

# ── Step 4: Install Exchange API Python deps ───────────────────────────────
info "Installing Exchange API Python dependencies…"
pip install -r "$ROOT/exchange-api/requirements.txt" --quiet
ok "Python dependencies ready"

# ── Step 5: Start Market Data API (port 8000) ─────────────────────────────
info "Starting Market Data API on port 8000…"
MARKET_VENV="$ROOT/venv310"
if [ -d "$MARKET_VENV" ]; then
  PYTHON="$MARKET_VENV/bin/python"
  UV="$MARKET_VENV/bin/uvicorn"
else
  PYTHON="python3"
  UV="uvicorn"
fi
(cd "$ROOT/market-data" && "$UV" main:app --host 0.0.0.0 --port 8000 >"$LOG_DIR/market_data.log" 2>&1) &
PIDS+=($!)
ok "Market Data API starting (port 8000)"

# ── Step 6: Start Exchange API (port 8001) ────────────────────────────────
info "Starting Exchange API on port 8001…"
(cd "$ROOT/exchange-api" && python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload >"$LOG_DIR/exchange_api.log" 2>&1) &
PIDS+=($!)
ok "Exchange API starting (port 8001)"

# ── Step 7: Start Frontend dev server ─────────────────────────────────────
if [ "$NO_FRONTEND" = false ]; then
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    info "Installing frontend npm packages…"
    (cd "$ROOT/frontend" && npm install --silent)
  fi
  info "Starting Frontend dev server on port 5173…"
  (cd "$ROOT/frontend" && npm run dev >"$LOG_DIR/frontend.log" 2>&1) &
  PIDS+=($!)
  ok "Frontend starting (port 5173)"
else
  warn "Skipping frontend (--no-frontend)"
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}All services launched!${NC}"
echo ""
echo "  Frontend       →  http://localhost:5173"
echo "  Exchange API   →  http://localhost:8001"
echo "  Market Data    →  http://localhost:8000"
echo "  Engine socket  →  /tmp/tickforge_engine.sock"
echo ""
echo "  Logs directory: $LOG_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Press Ctrl+C to stop all services."
echo ""

# Keep script alive so trap fires on Ctrl+C
wait
