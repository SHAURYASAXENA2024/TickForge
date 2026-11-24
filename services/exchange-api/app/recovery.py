"""Crash recovery demo: kill the engine with SIGKILL while the exchange is quiet, and prove that the
write-ahead log brings back exactly the same state.

Routes: GET /recovery/status and POST /recovery/crash-demo (see docs/CONTRACTS.md and docs/DATA_SOURCES.md).
The engine is killed only through the PID the supervisor (build.sh with TICKFORGE_DEMO=1) wrote to
`<data dir>/supervisor.json`; nothing here ever looks processes up by name.

This protects against a process crash, not power loss: the WAL is not fsynced.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.engine_client import EngineDown, Rejected
from app.symbols import ALL_SYMBOLS, SYMBOL_IDS
from app.traders import MANUAL_ID

log = logging.getLogger("exchange-api.recovery")

router = APIRouter()

DEMO_BLOCK_REASON = "recovery demo in progress"
QUIESCE_STABLE_S = 0.5
QUIESCE_TIMEOUT_S = 10.0
RECOVER_TIMEOUT_S = 30.0
LOCAL_HOSTS = ("127.0.0.1", "::1", "localhost")
ORDER_STATUSES = ("open", "partially_filled", "filled", "cancelled", "rejected")


# ---- talking to the engine on a connection of our own -----------------------------------------------
async def engine_ask(host: str, port: int, command: dict, reply_type: str, timeout: float = 3.0) -> dict:
    """One request on a fresh connection, so it works while the shared client is reconnecting."""
    async def go() -> dict:
        reader, writer = await asyncio.open_connection(host, port, limit=1 << 20)
        try:
            writer.write((json.dumps({"type": "command", **command}) + "\n").encode())
            await writer.drain()
            while True:
                line = await reader.readline()
                if not line:
                    raise ConnectionError("engine closed the connection")
                msg = json.loads(line)
                if msg.get("type") == reply_type:
                    return msg
        finally:
            writer.close()
    return await asyncio.wait_for(go(), timeout)


def read_supervisor(data_dir: str) -> dict | None:
    try:
        with open(os.path.join(data_dir, "supervisor.json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def pid_is_engine(pid: int) -> bool:
    """True when `pid` is alive and is an engine_server (checked by its own /proc entry, not by a search)."""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return b"engine_server" in f.read()
    except OSError:
        return False


# ---- snapshots and comparison ---------------------------------------------------------------------
def compare_snapshots(before: dict, after: dict) -> dict:
    """Compare two snapshots field by field. PASS only if every field matches.

    Returns {"result", "fields": {name: {"before", "after", "match"}}, "differing": [names]}."""
    names: list[str] = []

    def add(prefix: str, a, b) -> None:
        if isinstance(a, dict) or isinstance(b, dict):
            a, b = a or {}, b or {}
            for key in sorted(set(a) | set(b), key=str):
                add(f"{prefix}.{key}" if prefix else str(key), a.get(key), b.get(key))
        else:
            names.append(prefix)
            fields[prefix] = {"before": a, "after": b, "match": a == b}

    fields: dict[str, dict] = {}
    add("", before, after)
    differing = [n for n in names if not fields[n]["match"]]
    return {"result": "PASS" if not differing else "FAIL", "fields": fields, "differing": differing}


async def take_snapshot(ex) -> dict:
    """Everything the demo compares. The engine is asked on its own connection; the database is
    asked on the database thread."""
    s = ex.settings
    ask = lambda cmd, typ: engine_ask(s.engine_host, s.engine_port, cmd, typ)  # noqa: E731
    status = await ask({"name": "wal_status"}, "wal_status")
    stats = await ask({"name": "stats"}, "stats")
    books = {}
    for symbol in ALL_SYMBOLS:
        reply = await ask({"name": "book", "symbol_id": SYMBOL_IDS[symbol], "depth": 5}, "book")
        books[symbol] = {"bids": reply.get("bids", [])[:5], "asks": reply.get("asks", [])[:5]}
    accounts = await ask({"name": "accounts"}, "accounts")
    cash = {}
    for a in accounts.get("accounts", []):
        if 1 <= a["trader_id"] <= MANUAL_ID:  # 24 virtual traders and Kapinza
            name = "Kapinza" if a["trader_id"] == MANUAL_ID else f"trader_{a['trader_id']}"
            cash[name] = {"cash": a["cash"], "reserved_cash": a["reserved_cash"]}
    rows = await ex.db(ex.store.list_orders, None, 10_000_000)
    by_status = {st: 0 for st in ORDER_STATUSES}
    for row in rows:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    return {
        "last_sequence": status["last_sequence"],
        "state_hash": status["state_hash"],
        "frames_written": status["frames_written"],
        "engine_trades": stats["trades_total"],
        "db_trades": await ex.db(ex.store.count),
        "orders_by_status": by_status,
        "books": books,
        "cash": cash,
    }


# ---- the demo -------------------------------------------------------------------------------------
class Demo:
    """State of the demo on the Exchange: one at a time, and a phase the panel can follow."""

    def __init__(self) -> None:
        self.active = False
        self.phase = "idle"  # idle, pausing, quiescing, snapshot_before, killed, replaying, snapshot_after, done
        self.started_ms = 0
        self.last: dict | None = None  # the last result, kept so a page that reloads can show it


def _now_ms() -> int:
    return int(time.time() * 1000)


async def quiesce(ex) -> None:
    """Wait until nothing is moving: engine queue empty, last sequence unchanged for 500 ms, and every
    trade and order the engine reported already saved in the database."""
    s = ex.settings
    deadline = time.monotonic() + QUIESCE_TIMEOUT_S
    stable_since, last_seq = None, None
    while time.monotonic() < deadline:
        try:
            st = await engine_ask(s.engine_host, s.engine_port, {"name": "wal_status"}, "wal_status", timeout=2.0)
        except (OSError, asyncio.TimeoutError, ConnectionError):
            await asyncio.sleep(0.1)
            continue
        idle = st["queue_depth"] == 0 and ex._manual_in_flight == 0 and ex._persist_queue.empty()
        if idle and st["last_sequence"] == last_seq:
            if stable_since is None:
                stable_since = time.monotonic()
            if time.monotonic() - stable_since >= QUIESCE_STABLE_S:
                # everything in the persist queue is written once this marker comes back
                marker = asyncio.get_running_loop().create_future()
                ex._persist_queue.put_nowait(("barrier", marker))
                await asyncio.wait_for(marker, max(0.1, deadline - time.monotonic()))
                return
        else:
            stable_since = None
        last_seq = st["last_sequence"]
        await asyncio.sleep(0.1)
    raise RuntimeError("could not quiesce")


async def wait_for_engine(ex, killed_ms: int) -> dict:
    """Wait until a new engine answers wal_status. Returns that status."""
    s = ex.settings
    deadline = time.monotonic() + RECOVER_TIMEOUT_S
    while time.monotonic() < deadline:
        try:
            st = await engine_ask(s.engine_host, s.engine_port, {"name": "wal_status"}, "wal_status", timeout=1.0)
            if st["last_recovery"]["recovered_at"] >= killed_ms:  # a new process, not the old one
                return st
        except (OSError, asyncio.TimeoutError, ConnectionError):
            pass
        await asyncio.sleep(0.05)
    raise RuntimeError("engine did not recover")


async def wait_for_client(ex, timeout: float = 15.0) -> None:
    """The shared engine client reconnects on its own; give it time before orders are allowed again."""
    deadline = time.monotonic() + timeout
    while not ex.engine.connected and time.monotonic() < deadline:
        await asyncio.sleep(0.1)


async def run_crash_demo(ex) -> dict:
    """Steps 1 to 8 of the demo. Always resumes the traders and unblocks orders."""
    demo = ex.demo
    s = ex.settings
    t0 = time.monotonic()
    saved_state = ex.state
    out: dict = {"started_ms": _now_ms()}
    try:
        demo.phase = "pausing"
        ex.state = "paused"  # step 1: virtual traders stop; place_order refuses new orders while demo.active
        demo.phase = "quiescing"
        await quiesce(ex)  # step 2

        demo.phase = "snapshot_before"
        before = await take_snapshot(ex)  # step 3

        sup = read_supervisor(s.data_dir)
        if not sup or not sup.get("restart_on_crash"):
            raise RuntimeError("the engine is not supervised: start the stack with TICKFORGE_DEMO=1 ./build.sh")
        pid = int(sup["engine_pid"])
        if not pid_is_engine(pid):
            raise RuntimeError(f"supervisor engine pid {pid} is not a running engine")
        restarts_before = sup.get("restarts", 0)
        killed_ms = _now_ms()  # step 4
        os.kill(pid, signal.SIGKILL)
        demo.phase = "killed"
        out.update(killed_ms=killed_ms, killed_pid=pid)
        await asyncio.sleep(0.05)
        demo.phase = "replaying"

        status_after = await wait_for_engine(ex, killed_ms)  # step 5
        out["recovered_ms"] = _now_ms()
        demo.phase = "snapshot_after"
        after = await take_snapshot(ex)  # step 6

        cmp = compare_snapshots(before, after)  # step 7
        rec = status_after["last_recovery"]
        cmp["fields"]["frames_replayed"] = {"before": before["frames_written"], "after": rec["frames_replayed"],
                                            "match": before["frames_written"] == rec["frames_replayed"]}
        if not cmp["fields"]["frames_replayed"]["match"]:
            cmp["differing"].append("frames_replayed")
            cmp["result"] = "FAIL"
        sup_after = read_supervisor(s.data_dir) or {}
        out.update(
            result=cmp["result"], differing=cmp["differing"], fields=cmp["fields"],
            before=before, after=after,
            frames_replayed=rec["frames_replayed"], duration_ms=rec["duration_ms"],
            restarts=sup_after.get("restarts", 0), restarted_new_pid=sup_after.get("engine_pid"),
            restarts_before=restarts_before,
        )
    except Exception as exc:  # the API never crashes because of the demo
        log.exception("crash demo failed")
        out.update(result="FAIL", differing=[], error=str(exc) or exc.__class__.__name__)
    finally:  # step 8: always
        await wait_for_client(ex)
        ex.state = saved_state
        demo.active = False
        demo.phase = "done"
        out["total_ms"] = int((time.monotonic() - t0) * 1000)
        demo.last = out
    return out


# ---- routes ---------------------------------------------------------------------------------------
def _exchange(request: Request):
    return request.app.state.exchange


@router.get("/recovery/status")
async def recovery_status(request: Request):
    ex = _exchange(request)
    s = ex.settings
    sup = read_supervisor(s.data_dir)
    engine, error = None, ""
    try:
        engine = await engine_ask(s.engine_host, s.engine_port, {"name": "wal_status"}, "wal_status", timeout=1.5)
        engine.pop("type", None)
    except (OSError, asyncio.TimeoutError, ConnectionError, ValueError) as exc:
        error = f"engine not answering: {exc.__class__.__name__}"
    pid = int(sup["engine_pid"]) if sup and sup.get("engine_pid") else None
    return {
        "engine": engine,
        "engine_error": error,
        "supervisor": {
            "supervised": bool(sup),
            "restart_on_crash": bool(sup and sup.get("restart_on_crash")),
            "engine_pid": pid,
            "engine_alive": bool(pid and pid_is_engine(pid)),
            "restarts": sup.get("restarts", 0) if sup else 0,
            "last_restart_ms": sup.get("last_restart_ms", 0) if sup else 0,
        },
        "demo_enabled": s.demo_enabled,
        "demo": {"running": ex.demo.active, "phase": ex.demo.phase, "started_ms": ex.demo.started_ms,
                 "last": ex.demo.last},
    }


@router.post("/recovery/crash-demo")
async def crash_demo(request: Request):
    ex = _exchange(request)
    if not ex.settings.demo_enabled:
        return JSONResponse(status_code=403, content={"detail": "the crash demo is off: start with TICKFORGE_DEMO=1"})
    host = request.client.host if request.client else ""
    if host not in LOCAL_HOSTS:
        return JSONResponse(status_code=403, content={"detail": "the crash demo only accepts requests from localhost"})
    if ex.demo.active:  # checked and set with no await between, so two calls cannot both pass
        return JSONResponse(status_code=409, content={"detail": "a crash demo is already running"})
    ex.demo.active = True
    ex.demo.started_ms = _now_ms()
    ex.demo.phase = "pausing"
    return await run_crash_demo(ex)


def guard_orders(ex) -> None:
    """Called by every path that writes to the engine's log: refuses while the demo runs."""
    if ex.demo.active:
        raise Rejected(DEMO_BLOCK_REASON)


__all__ = ["router", "Demo", "compare_snapshots", "guard_orders", "EngineDown"]
