"""Google Play Payments policy: Android clients get no outside checkout.

The Play-distributed Android app may sell Foxory Plus only through Google
Play Billing. The server therefore withholds the Ziina checkout, price and
provider details from Android clients, including older builds that don't
send X-Foxory-Platform (recognised by React Native's OkHttp User-Agent).

    pip install mongomock-motor pytest
    pytest backend/tests/test_payments_policy.py
"""
import os
import sys
from pathlib import Path

import pytest

pytest.importorskip("mongomock_motor")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "foxory_test")
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402

FREE_USER = {"id": "user-free", "email": "free@example.com", "plan": "free", "is_superuser": False}

ANDROID_CLIENTS = [
    {"X-Foxory-Platform": "android"},
    {"User-Agent": "okhttp/4.12.0"},  # older Android builds (no platform header)
]
OTHER_CLIENTS = [
    {"X-Foxory-Platform": "ios"},
    {"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"},
    {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15"},
]
PAYMENT_WORDS = ("ziina", "aed", "$", "checkout", "test mode", "http")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["foxory_test"])
    server.app.dependency_overrides[server.get_current_user] = lambda: FREE_USER
    with TestClient(server.app) as c:
        yield c
    server.app.dependency_overrides.clear()


@pytest.mark.parametrize("headers", ANDROID_CLIENTS)
def test_billing_config_has_no_payment_details_for_android(client, monkeypatch, headers):
    monkeypatch.setattr(server, "ZIINA_API_KEY", "configured-key")
    body = client.get("/api/billing/config", headers=headers).json()
    assert body["configured"] is False
    assert body["provider"] == "none"
    assert body["test_mode"] is False
    text = str(body).lower()
    for word in PAYMENT_WORDS:
        assert word not in text, word
    assert body["plans"][0]["features"], "Plus features are still described"


@pytest.mark.parametrize("headers", ANDROID_CLIENTS)
def test_checkout_is_refused_for_android(client, monkeypatch, headers):
    monkeypatch.setattr(server, "ZIINA_API_KEY", "configured-key")

    async def no_network(*_args, **_kwargs):  # pragma: no cover - must not run
        raise AssertionError("Ziina must not be called for Android clients")

    monkeypatch.setattr(server.httpx.AsyncClient, "post", no_network, raising=False)
    r = client.post("/api/billing/checkout", json={}, headers=headers)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "checkout_unavailable"
    assert "ziina" not in r.text.lower()


@pytest.mark.parametrize("headers", OTHER_CLIENTS)
def test_web_and_ios_billing_config_unchanged(client, monkeypatch, headers):
    monkeypatch.setattr(server, "ZIINA_API_KEY", "configured-key")
    body = client.get("/api/billing/config", headers=headers).json()
    assert body["provider"] == "ziina"
    assert body["configured"] is True


def test_web_checkout_is_not_blocked_by_the_android_rule(client, monkeypatch):
    # No key configured: the web request reaches the normal Ziina handler (503),
    # not the Android refusal (403).
    monkeypatch.setattr(server, "ZIINA_API_KEY", "")
    r = client.post("/api/billing/checkout", json={}, headers={"User-Agent": "Mozilla/5.0"})
    assert r.status_code == 503


def test_plus_required_message_has_no_price(client):
    r = client.post("/api/export/xlsx", json={"month": "2026-11"}, headers={"X-Foxory-Platform": "android"})
    assert r.status_code == 402
    message = r.json()["detail"]["message"]
    for word in PAYMENT_WORDS:
        assert word not in message.lower(), word


def test_cors_allows_platform_header():
    assert "X-Foxory-Platform" in next(
        m.kwargs["allow_headers"] for m in server.app.user_middleware if "allow_headers" in m.kwargs
    )
