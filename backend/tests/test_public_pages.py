"""Public legal/support pages required by the app stores."""

from __future__ import annotations

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "foxory_test")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-unit-tests")

from server import app, privacy_page, support_page, terms_page  # noqa: E402


def _body(response) -> str:
    return response.body.decode("utf-8")


def test_public_page_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    assert {"/privacy", "/terms", "/support"} <= paths


def test_privacy_page_describes_imports_and_data_use() -> None:
    response = asyncio.run(privacy_page())
    body = _body(response)
    assert response.status_code == 200
    assert "Privacy Policy" in body
    assert "RevenueCat" in body
    assert "review before any shifts are saved" in body
    assert "privacy@foxory.info" in body


def test_terms_page_describes_app_store_subscription() -> None:
    body = _body(asyncio.run(terms_page()))
    assert "auto-renewing monthly subscription" in body
    assert "Restore Purchases" in body
    assert "official workplace schedule" in body


def test_support_page_has_contact_and_account_controls() -> None:
    response = asyncio.run(support_page())
    body = _body(response)
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert "support@foxory.info" in body
    assert "delete your account" in body
    assert "uncertain results are never saved automatically" in body
