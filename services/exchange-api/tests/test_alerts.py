"""Price alerts: validation, firing once, persistence, delete, and firing from the live price."""
import time

import pytest

from app.alerts import AlertBook, AlertError

SYMS = {"AAPL", "MSFT"}


def test_above_fires_at_or_over_the_price_once():
    book = AlertBook(None, SYMS)
    a = book.add("AAPL", "above", 19000)
    assert book.check("AAPL", 18999) == []
    fired = book.check("AAPL", 19000, now_ms=123)
    assert [f["alert_id"] for f in fired] == [a["alert_id"]] and fired[0]["fired_ms"] == 123 and fired[0]["fired_price_cents"] == 19000
    assert book.check("AAPL", 25000) == []          # fires once only


def test_below_and_other_symbol():
    book = AlertBook(None, SYMS)
    book.add("MSFT", "below", 30000)
    assert book.check("AAPL", 1) == []
    assert len(book.check("MSFT", 29999)) == 1


@pytest.mark.parametrize("args", [("ZZZ", "above", 100), ("AAPL", "up", 100), ("AAPL", "above", 0), ("AAPL", "below", -5),
                                  ("AAPL", "above", 10**9)])
def test_bad_alerts_are_refused(args):
    with pytest.raises(AlertError):
        AlertBook(None, SYMS).add(*args)


def test_limit_on_active_alerts():
    book = AlertBook(None, SYMS)
    for i in range(100):
        book.add("AAPL", "above", 100 + i)
    with pytest.raises(AlertError):
        book.add("AAPL", "above", 5)


def test_saved_and_reloaded_with_fire_time(tmp_path):
    book = AlertBook(str(tmp_path), SYMS)
    book.add("AAPL", "above", 100)
    book.add("AAPL", "below", 50)
    book.check("AAPL", 120, now_ms=999)
    again = AlertBook(str(tmp_path), SYMS)
    assert [(a["direction"], a["fired_ms"]) for a in again.alerts] == [("above", 999), ("below", None)]
    assert again.add("MSFT", "above", 1)["alert_id"] == 3


def test_a_damaged_file_is_ignored(tmp_path):
    (tmp_path / "alerts.json").write_text("{not json")
    assert AlertBook(str(tmp_path), SYMS).alerts == []


def test_api_create_list_delete_and_empty_state(client):
    assert client.get("/alerts").json() == {"alerts": []}
    r = client.post("/alerts", json={"symbol": "AAPL", "direction": "above", "price": 10**7})
    assert r.status_code == 200 and r.json()["fired_ms"] is None
    assert len(client.get("/alerts").json()["alerts"]) == 1
    assert client.post("/alerts", json={"symbol": "ZZZ", "direction": "above", "price": 100}).status_code == 422
    assert client.post("/alerts", json={"symbol": "AAPL", "direction": "sideways", "price": 100}).status_code == 422
    assert client.post("/alerts", json={"symbol": "AAPL", "direction": "above", "price": 0}).status_code == 422
    assert client.post("/alerts", json={"symbol": "AAPL", "direction": "above"}).status_code == 422
    assert client.delete(f"/alerts/{r.json()['alert_id']}").status_code == 200
    assert client.delete("/alerts/999").status_code == 404
    assert client.get("/alerts").json() == {"alerts": []}


def test_alert_fires_from_the_live_price(client):
    ref = client.get("/reference").json()["prices"]["AAPL"]
    a = client.post("/alerts", json={"symbol": "AAPL", "direction": "above", "price": max(1, ref - 1)}).json()
    deadline = time.time() + 5
    row = None
    while time.time() < deadline:
        row = next(x for x in client.get("/alerts").json()["alerts"] if x["alert_id"] == a["alert_id"])
        if row["fired_ms"]:
            break
        time.sleep(0.1)
    assert row["fired_ms"] and row["fired_price_cents"] >= row["price_cents"]
