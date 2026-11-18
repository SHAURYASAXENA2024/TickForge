"""The exchange-api against the real C++ engine and the real Rust database, with a kill -9 in the middle.

Skipped unless TICKFORGE_ENGINE_BIN points at engine_server (./build.sh test sets it) and the
tickforge_db module is installed. Nothing here touches the network (everything is 127.0.0.1).
"""
import importlib.util
import os
import signal
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.traders import START_CASH, START_SHARES
from tests.conftest import free_port, order, wait_for

ENGINE = os.environ.get("TICKFORGE_ENGINE_BIN", "")

pytestmark = pytest.mark.skipif(
    not (ENGINE and os.path.exists(ENGINE) and importlib.util.find_spec("tickforge_db")),
    reason="needs TICKFORGE_ENGINE_BIN and tickforge_db",
)


def start_engine(port, wal):
    proc = subprocess.Popen([ENGINE, "--port", str(port), "--wal", str(wal), "--accounts"],
                            stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            import socket
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return proc
        except OSError:
            time.sleep(0.05)
    proc.kill()
    raise AssertionError("engine did not start")


def make_client(port, data_dir):
    settings = Settings(engine_port=port, data_dir=str(data_dir), memory_db=False,
                        traders_start_running=False, tick_seconds=0.1, reconnect_seconds=0.1)
    return TestClient(create_app(settings))


def snapshot(client):
    """Everything a restart must not change."""
    traders = {t["trader_id"]: (t["cash"], t["reserved_cash"], t["holdings"], t["reserved_shares"])
               for t in client.get("/traders").json()["traders"]}
    manual = client.get("/traders/25").json()
    traders[25] = (manual["cash"], manual["reserved_cash"], manual["holdings"], manual["reserved_shares"])
    orders = [(o["order_id"], o["status"], o["filled"]) for o in client.get("/orders?trader_id=25").json()["orders"]]
    fills = [(f["trade_id"], f["counterparty_name"], f["price_cents"], f["quantity"])
             for f in client.get("/traders/25/fills").json()["fills"]]
    return traders, orders, fills


def test_orders_balances_and_locks_survive_kill_9(tmp_path):
    port = free_port()
    wal = tmp_path / "engine.wal"
    data = tmp_path / "data"
    engine = start_engine(port, wal)
    try:
        with make_client(port, data) as client:
            wait_for(lambda: client.get("/health").json()["engine"] == "connected")
            # Kapinza buys from trader 3 (price improvement), sells part of it to trader 6,
            # has one order resting, and one rejected for funds.
            order(client, 3, "SELL", 18900, 100)
            bought = order(client, 0, "BUY", 19000, 100).json()["order_id"]
            order(client, 6, "BUY", 19100, 30)
            sold = order(client, 0, "SELL", 19100, 30).json()["order_id"]
            resting = order(client, 0, "BUY", 16000, 20).json()["order_id"]
            assert order(client, 0, "BUY", 19000, 10_000).status_code == 409
            wait_for(lambda: len(client.get("/traders/25/fills").json()["fills"]) == 2)
            wait_for(lambda: {o["order_id"]: o["status"] for o in client.get("/orders?trader_id=25").json()["orders"]}
                     .get(sold) == "filled")

            before = snapshot(client)
            traders, orders, fills = before
            cash, reserved, holdings, _ = traders[25]
            # bought 100 at the resting price of 18900 (limit 19000), sold 30 at 19100 to trader 6
            assert cash == START_CASH - 100 * 18900 + 30 * 19100
            assert reserved == 20 * 16000  # only the resting order is still locked
            assert holdings["AAPL"] == START_SHARES + 70
            assert {o[0]: o[1] for o in orders}[bought] == "filled"
            assert {o[0]: o[1] for o in orders}[resting] == "open"
            assert sorted(f[1] for f in fills) == ["Anil Kumar", "Rahul Verma"]  # trader 6 and trader 3

        engine.send_signal(signal.SIGKILL)
        engine.wait()
        engine = start_engine(port, wal)
        with make_client(port, data) as client:
            wait_for(lambda: client.get("/health").json()["engine"] == "connected")
            assert snapshot(client) == before
            assert client.get("/health").json()["trades"] == 2
    finally:
        engine.kill()
        engine.wait()
