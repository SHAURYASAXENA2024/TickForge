"""Manual order endpoint: input rules and the rate limit."""
import pytest

from app import routes


def post(client, **kw):
    body = {"trader_id": 25, "symbol": "AAPL", "side": "BUY", "price": 19000, "qty": 10}
    body.update(kw)
    return client.post("/orders", json=body)


def test_valid_order_is_accepted(client):
    assert post(client).status_code == 200


@pytest.mark.parametrize("qty", [0, -1, 10_001, 100_000])
def test_shares_outside_1_to_10000_are_refused(client, qty):
    r = post(client, qty=qty)
    assert r.status_code == 422


def test_shares_edges_are_accepted(client):
    assert post(client, qty=1).status_code == 200
    assert post(client, qty=10_000).status_code != 422


def test_fractional_shares_are_refused(client):
    assert post(client, qty=1.5).status_code == 422


@pytest.mark.parametrize("price", [0, -5])
def test_price_must_be_positive(client, price):
    assert post(client, price=price).status_code == 422


def test_price_in_dollars_with_fraction_is_refused(client):
    # price travels as integer cents, so a decimal cent amount cannot be sent
    assert post(client, price=190.005).status_code == 422


def test_unknown_symbol_and_side_are_refused(client):
    assert post(client, symbol="ZZZZ").status_code == 404
    assert post(client, side="HOLD").status_code == 422


def test_garbage_does_not_crash(client):
    assert client.post("/orders", json={"symbol": "AAPL"}).status_code == 422
    assert client.post("/orders", content=b"not json").status_code == 422
    assert client.get("/health").status_code == 200


def test_rate_limit_is_ten_per_second(client):
    codes = [post(client).status_code for _ in range(12)]
    assert codes[:10].count(429) == 0
    assert codes[10:] == [429, 429]
    assert post(client).headers.get("retry-after") == "1"
    assert routes.ORDERS_PER_SECOND == 10


def test_rate_limit_applies_per_client(client):
    for _ in range(10):
        post(client)
    assert post(client).status_code == 429
    routes._order_times.clear()
    assert post(client).status_code == 200
