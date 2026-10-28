#!/usr/bin/env fish
# TickForge — Fish shell launcher
# Usage: fish start.fish [--no-rust] [--no-engine] [--no-frontend]

set ROOT (dirname (realpath (status filename)))
set LOG_DIR $ROOT/logs
mkdir -p $LOG_DIR

set NO_RUST false
set NO_ENGINE false
set NO_FRONTEND false

for arg in $argv
    switch $arg
        case --no-rust;     set NO_RUST true
        case --no-engine;   set NO_ENGINE true
        case --no-frontend; set NO_FRONTEND true
    end
end

set PIDS

function cleanup
    echo ""
    echo "[tickforge] Shutting down all services…"
    for pid in $PIDS
        kill $pid 2>/dev/null
    end
    rm -f /tmp/tickforge_engine.sock
    echo "[tickforge] Done."
end

# Register cleanup on exit / Ctrl-C
trap cleanup INT TERM EXIT

# ── Step 1: Build Rust LSM database ───────────────────────────────────────
if test $NO_RUST = false
    echo "[..] Building Rust LSM database (tickforge_db PyO3 extension)…"
    if not command -q maturin
        echo "[warn] maturin not found — installing via pip"
        pip install maturin --quiet
    end
    cd $ROOT/tickforge-db
    maturin develop --release 2>&1 | tee $LOG_DIR/rust_build.log
    cd $ROOT
    echo "[ok] Rust database built and installed"
else
    echo "[warn] Skipping Rust build (--no-rust)"
end

# ── Step 2 & 3: Build + Start C++ engine server ───────────────────────────
if test $NO_ENGINE = false
    echo "[..] Building C++ engine server…"
    set BUILD_DIR $ROOT/matching-engine/build
    rm -rf $BUILD_DIR
    mkdir -p $BUILD_DIR
    cd $BUILD_DIR
    cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 2>&1 | tee $LOG_DIR/cmake.log
    cmake --build . --target engine_server -j(nproc) 2>&1 | tee $LOG_DIR/cpp_build.log
    cd $ROOT
    echo "[ok] C++ engine_server built"

    echo "[..] Starting C++ engine server…"
    $BUILD_DIR/engine_server >$LOG_DIR/engine_server.log 2>&1 &
    set -a PIDS $last_pid

    # Wait for socket to appear (max 6s)
    for i in (seq 1 20)
        if test -S /tmp/tickforge_engine.sock
            break
        end
        sleep 0.3
    end

    if test -S /tmp/tickforge_engine.sock
        echo "[ok] Engine server ready at /tmp/tickforge_engine.sock"
    else
        echo "[warn] Engine socket not found — check $LOG_DIR/engine_server.log"
    end
else
    echo "[warn] Skipping C++ engine (--no-engine)"
end

# ── Step 4: Install Exchange API Python deps ───────────────────────────────
echo "[..] Installing Exchange API Python dependencies…"
pip install -r $ROOT/exchange-api/requirements.txt --quiet
echo "[ok] Python dependencies ready"

# ── Step 5: Start Market Data API (port 8000) ─────────────────────────────
echo "[..] Starting Market Data API on port 8000…"
set MARKET_VENV $ROOT/venv310
if test -d $MARKET_VENV
    set UV $MARKET_VENV/bin/uvicorn
else
    set UV uvicorn
end

cd $ROOT/market-data
$UV main:app --host 0.0.0.0 --port 8000 >$LOG_DIR/market_data.log 2>&1 &
set -a PIDS $last_pid
cd $ROOT
echo "[ok] Market Data API starting (port 8000)"

# ── Step 6: Start Exchange API (port 8001) ────────────────────────────────
echo "[..] Starting Exchange API on port 8001…"
cd $ROOT/exchange-api
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload >$LOG_DIR/exchange_api.log 2>&1 &
set -a PIDS $last_pid
cd $ROOT
echo "[ok] Exchange API starting (port 8001)"

# ── Step 7: Start Frontend dev server ─────────────────────────────────────
if test $NO_FRONTEND = false
    if not test -d $ROOT/frontend/node_modules
        echo "[..] Installing frontend npm packages…"
        cd $ROOT/frontend && npm install --silent && cd $ROOT
    end
    echo "[..] Starting Frontend dev server on port 5173…"
    cd $ROOT/frontend
    npm run dev >$LOG_DIR/frontend.log 2>&1 &
    set -a PIDS $last_pid
    cd $ROOT
    echo "[ok] Frontend starting (port 5173)"
else
    echo "[warn] Skipping frontend (--no-frontend)"
end

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TickForge — all services launched!"
echo ""
echo "  Frontend     →  http://localhost:5173"
echo "  Exchange API →  http://localhost:8001"
echo "  Market Data  →  http://localhost:8000"
echo "  Engine sock  →  /tmp/tickforge_engine.sock"
echo "  Logs         →  $LOG_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Press Ctrl+C to stop all services."
echo ""

# Keep alive
wait
