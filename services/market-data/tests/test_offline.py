"""Offline safety: the saved snapshot is served when Yahoo fails or TICKFORGE_OFFLINE=1."""
import pandas as pd
import pytest

from app import stocks


class Fake:
    def __init__(self, fail=False):
        self.fail = fail

    def history(self, symbol, period, interval):
        if self.fail:
            raise RuntimeError("network down")
        idx = pd.date_range("2026-10-14 09:30", periods=3, freq="5min", tz="America/New_York")
        return pd.DataFrame({"Open": [1.0, 2, 3], "High": [1.0, 2, 3], "Low": [1.0, 2, 3], "Close": [1.0, 2, 3], "Volume": [1, 1, 1]}, index=idx)

    def info(self, symbol):
        return {}

    def actions(self, symbol):
        return pd.DataFrame()


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("TICKFORGE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("TICKFORGE_OFFLINE", raising=False)
    stocks._saved.clear()
    stocks._saved_loaded = False
    stocks.cache.clear()
    old = stocks.provider
    yield
    stocks.set_provider(old)
    stocks._saved.clear()
    stocks._saved_loaded = False


def test_failed_provider_serves_saved_snapshot():
    stocks.set_provider(Fake())
    live = stocks.get_stock_data("AAPL", "1d", "5m")
    assert "offline" not in live
    stocks.cache.clear()
    stocks.set_provider(Fake(fail=True))
    saved = stocks.get_stock_data("AAPL", "1d", "5m")
    assert saved["offline"] is True and saved["price"] == live["price"]


def test_offline_flag_never_calls_provider(monkeypatch):
    stocks.set_provider(Fake())
    stocks.get_stock_data("AAPL", "1d", "5m")
    stocks.cache.clear()
    stocks.set_provider(Fake(fail=True))
    monkeypatch.setenv("TICKFORGE_OFFLINE", "1")
    assert stocks.get_stock_data("AAPL", "1d", "5m")["offline"] is True


def test_snapshot_survives_restart():
    stocks.set_provider(Fake())
    stocks.get_stock_data("MSFT", "1d", "5m")
    stocks._saved.clear()
    stocks._saved_loaded = False
    stocks.cache.clear()
    stocks.set_provider(Fake(fail=True))
    assert stocks.get_stock_data("MSFT", "1d", "5m")["offline"] is True


def test_no_snapshot_and_failure_is_still_an_error():
    stocks.set_provider(Fake(fail=True))
    with pytest.raises(RuntimeError):
        stocks.get_stock_data("NVDA", "1d", "5m")
