#!/usr/bin/env bash
# Proves WAL crash recovery live: starts the stack with TICKFORGE_DEMO=1, trades for a while, kills the engine
# with the crash demo three times, and checks the state came back each time. Exits non-zero on any failure.
#
#   scripts/verify_recovery_demo.sh            (needs a built stack: run ./build.sh test or ./build.sh once)
#
# Works from any folder, including one with spaces and parentheses. The stack is stopped with SIGTERM.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
PY="$ROOT/.venv/bin/python"
API="http://127.0.0.1:8001"
OFF_PORT="${VERIFY_OFF_PORT:-8002}"   # a second exchange-api, without TICKFORGE_DEMO, for the 403 check
LOG="$RUN/logs/verify-stack.log"
FAILS=0
STACK_PID=""
OFF_PID=""

say() { printf '\n==> %s\n' "$*"; }
ok() { printf '  ok:   %s\n' "$*"; }
bad() { printf '  FAIL: %s\n' "$*"; FAILS=$((FAILS + 1)); }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }

# json FILE EXPR -> evaluates a Python expression on the parsed JSON (named j)
json() { "$PY" -I -c 'import json,sys; j=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"; }

stop_all() {
  trap - EXIT
  if [ -n "$OFF_PID" ] && kill -0 "$OFF_PID" 2> /dev/null; then kill -TERM "$OFF_PID" 2> /dev/null; wait "$OFF_PID" 2> /dev/null; fi
  if [ -n "$STACK_PID" ] && kill -0 "$STACK_PID" 2> /dev/null; then
    kill -TERM "$STACK_PID" 2> /dev/null
    for _ in $(seq 1 100); do kill -0 "$STACK_PID" 2> /dev/null || break; sleep 0.1; done
    kill -0 "$STACK_PID" 2> /dev/null && { bad "stack did not stop after SIGTERM"; }
  fi
  rm -rf "$TMP"
  if [ "$FAILS" -ne 0 ]; then printf '\nRESULT: %d check(s) failed. Stack log: %s\n' "$FAILS" "$LOG"; exit 1; fi
  printf '\nRESULT: all checks passed\n'
  exit 0
}
TMP="$(mktemp -d)"
trap 'stop_all' EXIT
trap 'FAILS=$((FAILS + 1)); exit 1' INT TERM

[ -x "$PY" ] || { echo "no .venv: run ./build.sh test or ./build.sh once first" >&2; FAILS=1; exit 1; }
mkdir -p "$RUN/logs"

say "Starting the stack with TICKFORGE_DEMO=1"
for port in 9100 8001 8000 8443 "$OFF_PORT"; do
  if (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then echo "port $port is in use: stop the other stack first" >&2; FAILS=1; exit 1; fi
done
TICKFORGE_DEMO=1 setsid "$ROOT/build.sh" > "$LOG" 2>&1 &
STACK_PID=$!
for _ in $(seq 1 600); do
  curl -fsS --max-time 1 "$API/health" > "$TMP/h.json" 2> /dev/null && [ "$(json "$TMP/h.json" 'j["engine"]' 2> /dev/null)" = connected ] && break
  kill -0 "$STACK_PID" 2> /dev/null || { tail -n 20 "$LOG"; bad "the stack stopped while starting"; exit 1; }
  sleep 0.5
done
check "stack healthy and engine connected" test "$(json "$TMP/h.json" 'j["engine"]')" = connected
curl -fsS "$API/recovery/status" > "$TMP/s.json"
check "demo enabled and engine supervised" test "$(json "$TMP/s.json" 'j["demo_enabled"] and j["supervisor"]["restart_on_crash"] and j["supervisor"]["engine_alive"]')" = True

say "Placing 20 orders as Kapinza and letting the virtual traders run for 10 s"
curl -fsS "$API/reference" > "$TMP/ref.json"
accepted=0
for i in $(seq 1 24); do
  symbol="$("$PY" -I -c 'import json,sys; j=json.load(open(sys.argv[1])); print(sorted(j["prices"])[int(sys.argv[2]) % 10])' "$TMP/ref.json" "$i")"
  price="$(json "$TMP/ref.json" "j['prices']['$symbol']")"
  side=BUY; [ $((i % 2)) -eq 0 ] && side=SELL
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/orders" -H 'Content-Type: application/json' \
    -d "{\"trader_id\":0,\"symbol\":\"$symbol\",\"side\":\"$side\",\"price\":$price,\"qty\":1}")"
  [ "$code" = 200 ] && accepted=$((accepted + 1))
done
check "at least 20 Kapinza orders accepted ($accepted)" test "$accepted" -ge 20
sleep 10
curl -fsS "$API/recovery/status" > "$TMP/s.json"
check "virtual traders sent orders (frames written: $(json "$TMP/s.json" 'j["engine"]["frames_written"]'))" \
  test "$(json "$TMP/s.json" 'j["engine"]["frames_written"] > 24')" = True

say "Crash demo three times in a row"
for n in 1 2 3; do
  code="$(curl -sS --max-time 90 -o "$TMP/d$n.json" -w '%{http_code}' -X POST "$API/recovery/crash-demo")"
  check "run $n: HTTP 200 ($code)" test "$code" = 200
  check "run $n: PASS" test "$(json "$TMP/d$n.json" 'j["result"]')" = PASS
  check "run $n: state hash before = after" test "$(json "$TMP/d$n.json" 'j["before"]["state_hash"] == j["after"]["state_hash"]')" = True
  check "run $n: last sequence before = after" test "$(json "$TMP/d$n.json" 'j["before"]["last_sequence"] == j["after"]["last_sequence"]')" = True
  echo "        replayed $(json "$TMP/d$n.json" 'j["frames_replayed"]') frames in $(json "$TMP/d$n.json" 'round(j["duration_ms"], 1)') ms, supervisor restarts: $(json "$TMP/d$n.json" 'j["restarts"]')"
done
check "supervisor counted 3 restarts" test "$(json "$TMP/d3.json" 'j["restarts"]')" = 3

say "Guards"
TICKFORGE_ENGINE_PORT=1 TICKFORGE_MEMORY_DB=1 TICKFORGE_REFERENCE=snapshot TICKFORGE_DATA_DIR="$TMP" TICKFORGE_DEMO= \
  setsid "$PY" -m uvicorn --app-dir "$ROOT/services/exchange-api" app.main:app --host 127.0.0.1 --port "$OFF_PORT" > "$TMP/off.log" 2>&1 &
OFF_PID=$!
for _ in $(seq 1 100); do curl -fsS --max-time 1 "http://127.0.0.1:$OFF_PORT/health" > /dev/null 2>&1 && break; sleep 0.2; done
code="$(curl -sS -o "$TMP/off.json" -w '%{http_code}' -X POST "http://127.0.0.1:$OFF_PORT/recovery/crash-demo")"
check "flag off returns 403 ($code)" test "$code" = 403
check "403 says how to enable it" grep -q "TICKFORGE_DEMO=1" "$TMP/off.json"

curl -sS --max-time 90 -o "$TMP/a.json" -X POST "$API/recovery/crash-demo" &
CALL_A=$!
for _ in $(seq 1 50); do
  curl -fsS "$API/recovery/status" > "$TMP/s.json" 2> /dev/null && [ "$(json "$TMP/s.json" 'j["demo"]["running"]')" = True ] && break
  sleep 0.1
done
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/recovery/crash-demo")"
check "a second concurrent call returns 409 ($code)" test "$code" = 409
code="$(curl -sS -o "$TMP/o.json" -w '%{http_code}' -X POST "$API/orders" -H 'Content-Type: application/json' \
  -d '{"trader_id":0,"symbol":"AAPL","side":"BUY","price":100,"qty":1}')"
check "orders are refused with 409 while the demo runs ($code)" test "$code" = 409
check "refusal says why" grep -q "recovery demo in progress" "$TMP/o.json"
wait "$CALL_A"
check "the demo that was running still PASSed" test "$(json "$TMP/a.json" 'j["result"]')" = PASS

say "After recovery"
curl -fsS "$API/recovery/status" > "$TMP/s.json"
frames="$(json "$TMP/s.json" 'j["engine"]["frames_written"]')"
sleep 5
curl -fsS "$API/recovery/status" > "$TMP/s.json"
check "virtual traders were resumed (frames $frames -> $(json "$TMP/s.json" 'j["engine"]["frames_written"]'))" \
  test "$(json "$TMP/s.json" "j['engine']['frames_written'] > $frames")" = True
check "demo is no longer running" test "$(json "$TMP/s.json" 'j["demo"]["running"]')" = False
curl -fsS "$API/health" > "$TMP/h.json"
check "stack healthy" test "$(json "$TMP/h.json" 'j["status"] + "/" + j["engine"]')" = ok/connected
price="$(json "$TMP/ref.json" "j['prices']['AAPL']")"
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/orders" -H 'Content-Type: application/json' \
  -d "{\"trader_id\":0,\"symbol\":\"AAPL\",\"side\":\"BUY\",\"price\":$price,\"qty\":1}")"
check "an order can be placed after recovery ($code)" test "$code" = 200

say "Stopping the stack with SIGTERM"
