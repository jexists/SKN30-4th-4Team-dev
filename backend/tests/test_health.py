def test_health_returns_standard_envelope(client):
    res = client.get("/api/v1/health")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["code"] == 200
    assert body["data"]["db"] == "ok"
    assert body["error"] is None


def test_hello(client):
    res = client.get("/api/v1/hello")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "message" in body["data"]
