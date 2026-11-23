def test_replay_says_so_when_the_tool_is_not_available(client):
    r = client.get("/replay?symbol=AAPL")
    assert r.status_code == 503 and "not built" in r.json()["detail"]
