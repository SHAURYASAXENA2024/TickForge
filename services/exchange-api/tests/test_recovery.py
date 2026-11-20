"""The crash recovery demo: comparison logic, the guards, and a full run against the real engine
with a small supervisor (the same job build.sh does with TICKFORGE_DEMO=1)."""
import importlib.util
import json
import os
import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.recovery import compare_snapshots
from tests.conftest import TEST_SNAPSHOT, free_port, order, wait_for

ENGINE = os.environ.get("TICKFORGE_ENGINE_BIN", "")
LOCAL = ("127.0.0.1", 50000)


def snap(**over):
    base = {"last_sequence": 10, "state_hash": "abc", "engine_trades": 3, "db_trades": 3,
            "orders_by_status": {"open": 2, "filled": 1},
            "books": {"AAPL": {"bids": [[100, 5]], "asks": []}},
            "cash": {"Kapinza": {"cash": 5, "reserved_cash": 1}}}
    base.update(over)
    return base


# ---- comparison logic ---------------------------------------------------------------------------
def test_identical_snapshots_pass():
    result = compare_snapshots(snap(), snap())
    assert result["result"] == "PASS" and result["differing"] == []
    assert result["fields"]["cash.Kapinza.cash"] == {"before": 5, "after": 5, "match": True}


def test_a_mismatching_snapshot_fails_and_names_the_fields():
    after = snap(state_hash="zzz", cash={"Kapinza": {"cash": 4, "reserved_cash": 1}},
                 orders_by_status={"open": 1, "filled": 1})
    result = compare_snapshots(snap(), after)
    assert result["result"] == "FAIL"
    assert result["differing"] == ["state_hash", "cash.Kapinza.cash", "orders_by_status.open"] or \
        sorted(result["differing"]) == sorted(["state_hash", "cash.Kapinza.cash", "orders_by_status.open"])
    assert result["fields"]["last_sequence"]["match"] is True


def test_a_field_missing_after_the_crash_is_a_mismatch():
    after = snap()
    del after["books"]["AAPL"]
    assert compare_snapshots(snap(), after)["result"] == "FAIL"


# ---- guards (fake engine) -----------------------------------------------------------------------
def test_flag_off_returns_403_and_status_says_so(client):
    r = client.post("/recovery/crash-demo")
    assert r.status_code == 403 and "TICKFORGE_DEMO=1" in r.json()["detail"]
    status = client.get("/recovery/status").json()
    assert status["demo_enabled"] is False and status["demo"]["running"] is False


@pytest.fixture()
def demo_client(engine, tmp_path):
    settings = Settings(engine_port=engine.port, memory_db=True, traders_start_running=False, tick_seconds=0.1,
                        reconnect_seconds=0.1, reference_snapshot=TEST_SNAPSHOT, demo_enabled=True,
                        data_dir=str(tmp_path))
    with TestClient(create_app(settings), client=LOCAL) as c:
        wait_for(lambda: c.get("/health").json()["engine"] == "connected")
        yield c


def test_non_local_caller_gets_403(engine, tmp_path):
    settings = Settings(engine_port=engine.port, memory_db=True, traders_start_running=False,
                        reference_snapshot=TEST_SNAPSHOT, demo_enabled=True, data_dir=str(tmp_path))
    with TestClient(create_app(settings), client=("203.0.113.9", 4000)) as c:
        r = c.post("/recovery/crash-demo")
        assert r.status_code == 403 and "localhost" in r.json()["detail"]


def test_second_demo_gets_409_and_orders_are_refused_while_it_runs(demo_client):
    demo_client.app.state.exchange.demo.active = True  # as if a demo were running
    assert demo_client.post("/recovery/crash-demo").status_code == 409
    r = order(demo_client, 0, "BUY", 19000, 1)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "recovery demo in progress"
    demo_client.app.state.exchange.demo.active = False
    assert order(demo_client, 0, "BUY", 19000, 1).status_code == 200


def test_unsupervised_engine_fails_cleanly_and_unblocks_everything(demo_client):
    # The fake engine has no wal_status, so the demo cannot start: FAIL, and nothing stays blocked.
    r = demo_client.post("/recovery/crash-demo")
    assert r.status_code == 200 and r.json()["result"] == "FAIL" and r.json()["error"]
    ex = demo_client.app.state.exchange
    assert ex.demo.active is False and ex.state == "stopped"
    assert order(demo_client, 0, "BUY", 19000, 1).status_code == 200


# ---- the real engine, killed for real ---------------------------------------------------------------
real = pytest.mark.skipif(not (ENGINE and os.path.exists(ENGINE) and importlib.util.find_spec("tickforge_db")),
                          reason="needs TICKFORGE_ENGINE_BIN and tickforge_db")


class Supervisor:
    """Starts the engine, writes supervisor.json and restarts the engine when it dies (like build.sh)."""

    def __init__(self, port, wal, data):
        self.port, self.wal, self.data = port, str(wal), data
        self.restarts, self.stop = 0, False
        self.proc = self._start()
        self._write()
        self.thread = threading.Thread(target=self._watch, daemon=True)
        self.thread.start()

    def _start(self):
        return subprocess.Popen([ENGINE, "--port", str(self.port), "--wal", self.wal, "--accounts"],
                                stderr=subprocess.DEVNULL)

    def _write(self):
        data = {"supervised": True, "restart_on_crash": True, "engine_pid": self.proc.pid,
                "restarts": self.restarts, "last_restart_ms": int(time.time() * 1000)}
        (self.data / "supervisor.json").write_text(json.dumps(data))

    def _watch(self):
        while not self.stop:
            if self.proc.poll() is not None:
                self.proc = self._start()
                self.restarts += 1
                self._write()
            time.sleep(0.05)

    def close(self):
        self.stop = True
        self.thread.join(2)
        self.proc.kill()
        self.proc.wait()


@real
def test_crash_demo_passes_against_the_real_engine(tmp_path):
    port, data = free_port(), tmp_path / "data"
    data.mkdir()
    sup = Supervisor(port, tmp_path / "engine.wal", data)
    settings = Settings(engine_port=port, data_dir=str(data), memory_db=False, traders_start_running=False,
                        tick_seconds=0.1, reconnect_seconds=0.1, reference_snapshot=TEST_SNAPSHOT, demo_enabled=True)
    try:
        with TestClient(create_app(settings), client=LOCAL) as c:
            wait_for(lambda: c.get("/health").json()["engine"] == "connected")
            order(c, 3, "SELL", 18900, 100)
            order(c, 0, "BUY", 19000, 100)
            order(c, 0, "BUY", 16000, 20)
            status = c.get("/recovery/status").json()
            assert status["supervisor"]["engine_alive"] and status["engine"]["frames_written"] >= 3
            for _ in range(2):  # twice in a row
                body = c.post("/recovery/crash-demo").json()
                assert body["result"] == "PASS", body.get("differing") or body.get("error")
                assert body["before"]["state_hash"] == body["after"]["state_hash"]
                assert body["before"]["last_sequence"] == body["after"]["last_sequence"]
                assert body["frames_replayed"] == body["before"]["frames_written"] > 0
                assert body["restarts"] > body["restarts_before"]
            ex = c.app.state.exchange
            assert ex.demo.active is False
            assert order(c, 0, "BUY", 16000, 1).status_code == 200  # orders work again after recovery
    finally:
        sup.close()
