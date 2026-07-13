"""CCAD auto-Plus + P3 security-audit hardening verification.

Covers:
  - CCAD-1..CCAD-8: CCAD email domains get auto Plus (plan_source='ccad').
  - P3-1/P3-2: Rate-limits on /auth/login and /auth/register.
  - P3-3: CORS lockdown at the *application* layer (see NOTE below).
  - P3-4: Neutral registration error (no email-exists leak).
  - P3-5: No "Ziina rejected" leakage in server.py.
  - Regression 2/3: Live Ziina checkout + webhook HMAC + Plus activation via webhook.

NOTE ON CORS (P3-3):
  The K8s preview ingress rewrites CORS response headers on the *public*
  hostname (returns `Access-Control-Allow-Origin: *` for every OPTIONS,
  regardless of the app's behaviour). Application-level CORS behaviour must
  therefore be verified against the internal backend port 8001.

Test order:
  Functional tests use a unique X-Forwarded-For per request to sidestep the
  in-process per-IP rate-limit bucket. The rate-limit tests themselves omit
  X-Forwarded-For so they hit the shared client-IP bucket and can trigger
  the 429 path.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from typing import Any

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else "https://nurse-planner-5.preview.emergentagent.com"
API = f"{BASE_URL}/api"
INTERNAL_API = "http://localhost:8001/api"  # bypasses K8s ingress CORS override

SUPER_EMAIL = "Sultan942002@yahoo.com"
SUPER_PASS = "S.nsmjalzaabi1"
ZIINA_SECRET = "rQmDpT0554V3Yzxpj151pgHnAGryFXP1_YZjAkRApR8"
SERVER_PY = "/app/backend/server.py"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _uxff() -> dict[str, str]:
    """Unique X-Forwarded-For per call — sidesteps per-IP rate-limit bucket."""
    return {
        "X-Forwarded-For": "10." + ".".join(
            str(int(uuid.uuid4().int >> (i * 8)) & 0xFF) for i in range(3)
        )
    }


def _post(path: str, *, json_body: dict | None = None, extra_headers: dict | None = None,
          data: bytes | None = None, timeout: int = 20):
    h = {"Content-Type": "application/json", **_uxff()}
    if extra_headers:
        h.update(extra_headers)
    if data is not None:
        return requests.post(f"{API}{path}", data=data, headers=h, timeout=timeout)
    return requests.post(f"{API}{path}", json=json_body, headers=h, timeout=timeout)


def _get(path: str, *, extra_headers: dict | None = None, timeout: int = 15):
    h = {**_uxff()}
    if extra_headers:
        h.update(extra_headers)
    return requests.get(f"{API}{path}", headers=h, timeout=timeout)


def _register(email: str, password: str = "testpass123") -> dict[str, Any]:
    return _post("/auth/register",
                 json_body={"email": email, "password": password,
                            "display_name": "TEST"}).json()


def _mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


# =====================================================================
# P3-1 / P3-2 — Rate-limit tests. Run FIRST (backend just restarted).
# NOTE: no X-Forwarded-For set here so all attempts share the same bucket.
# =====================================================================
class TestP3RateLimits:
    def test_p3_2_register_rate_limit(self):
        """5 registrations per minute allowed; 6th blocked with 429."""
        codes = []
        for i in range(8):
            email = f"TEST_rl_reg_{uuid.uuid4().hex[:8]}@gmail.com"
            r = requests.post(
                f"{API}/auth/register",
                json={"email": email, "password": "testpass123"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            codes.append(r.status_code)
            if r.status_code == 429:
                assert "too many requests" in r.text.lower(), r.text
                break
        assert 429 in codes, f"Register rate-limit never triggered. Codes: {codes}"

    def test_p3_1_login_rate_limit(self):
        """10 login attempts per minute allowed; 11th blocked with 429."""
        codes = []
        for i in range(15):
            r = requests.post(
                f"{API}/auth/login",
                json={"email": SUPER_EMAIL, "password": "definitely-wrong"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            codes.append(r.status_code)
            if r.status_code == 429:
                assert "too many requests" in r.text.lower(), r.text
                break
        assert 429 in codes, f"Login rate-limit never triggered. Codes: {codes}"


# =====================================================================
# P3-3 — CORS lockdown (verified against the app directly on port 8001,
# because the K8s preview ingress rewrites CORS headers on the public host).
# =====================================================================
class TestP3Cors:
    def test_evil_origin_not_echoed_by_app(self):
        r = requests.options(
            f"{INTERNAL_API}/auth/login",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=10,
        )
        allow = r.headers.get("access-control-allow-origin", "")
        assert allow not in ("*", "https://evil.example.com"), (
            f"App leaked CORS to evil origin: {allow!r}"
        )

    def test_allowed_origin_echoed_by_app(self):
        r = requests.options(
            f"{INTERNAL_API}/auth/login",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=10,
        )
        assert r.headers.get("access-control-allow-origin", "") == \
            "http://localhost:8081"
        assert r.headers.get("access-control-allow-credentials", "").lower() == "true"


# =====================================================================
# P3-4 — Neutral registration error / P3-5 — no "Ziina rejected"
# =====================================================================
class TestP3Neutral:
    def test_p3_4_neutral_register_duplicate_email(self):
        r = _post("/auth/register",
                  json_body={"email": SUPER_EMAIL, "password": "whatever"})
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "").lower()
        assert "already registered" not in detail, (
            f"Leaks account existence: {detail!r}"
        )
        assert "could not be completed" in detail or "try again" in detail, (
            f"Not neutral: {detail!r}"
        )

    def test_p3_5_no_ziina_rejected_in_source(self):
        with open(SERVER_PY, "r") as f:
            src = f.read()
        assert "Ziina rejected" not in src, "server.py still leaks 'Ziina rejected'"
        assert "Checkout provider is unavailable" in src
        assert "Webhook provider is unavailable" in src


# =====================================================================
# CCAD auto-Plus
# =====================================================================
class TestCcadAutoPlus:
    def test_ccad_1_register_ccad_ae(self):
        email = f"TEST_ccad_{uuid.uuid4().hex[:8]}@ccad.ae"
        d = _register(email)
        assert d.get("access_token"), d
        u = d["user"]
        assert u["plan"] == "plus", u
        assert u["plan_source"] == "ccad", u

    def test_ccad_2_register_clevelandclinicabudhabi_ae(self):
        email = f"TEST_ccad_{uuid.uuid4().hex[:8]}@clevelandclinicabudhabi.ae"
        d = _register(email)
        u = d["user"]
        assert u["plan"] == "plus", u
        assert u["plan_source"] == "ccad", u

    def test_ccad_3_non_ccad_stays_free(self):
        email = f"TEST_free_{uuid.uuid4().hex[:8]}@gmail.com"
        d = _register(email)
        u = d["user"]
        assert u["plan"] == "free", u
        assert u["plan_source"] == "free", u

    def test_ccad_4_ccad_user_can_export_xlsx(self):
        email = f"TEST_ccad_{uuid.uuid4().hex[:8]}@ccad.ae"
        tok = _register(email)["access_token"]
        r = _post("/export/xlsx",
                  json_body={"month": "2026-04"},
                  extra_headers={"Authorization": f"Bearer {tok}"},
                  timeout=30)
        assert r.status_code == 200, r.text
        assert "base64" in r.json()

    def test_ccad_5_ccad_user_can_add_future_month_shift(self):
        email = f"TEST_ccad_{uuid.uuid4().hex[:8]}@ccad.ae"
        tok = _register(email)["access_token"]
        r = _post("/shifts",
                  json_body={"date": "2099-12-15", "type": "day"},
                  extra_headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["date"] == "2099-12-15"

    def test_ccad_6_non_ccad_free_still_402(self):
        email = f"TEST_free_{uuid.uuid4().hex[:8]}@gmail.com"
        tok = _register(email)["access_token"]
        r = _post("/export/xlsx",
                  json_body={"month": "2026-04"},
                  extra_headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 402, r.text
        assert r.json()["detail"]["code"] == "plus_required"

    def test_ccad_7_me_returns_plus_ccad(self):
        email = f"TEST_ccad_{uuid.uuid4().hex[:8]}@ccad.ae"
        tok = _register(email)["access_token"]
        r = _get("/auth/me",
                 extra_headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        me = r.json()
        assert me["plan"] == "plus"
        assert me["plan_source"] == "ccad"

    def test_ccad_8_login_idempotently_upgrades_existing_free_ccad(self):
        """Insert directly into Mongo as plan=free + plan_source=free + CCAD
        email, then login and verify auto-upgrade."""
        from datetime import datetime, timezone
        import bcrypt

        db = _mongo()
        email = f"TEST_ccad_direct_{uuid.uuid4().hex[:8]}@ccad.ae"
        pw = "testpass123"
        now = datetime.now(timezone.utc)
        user_doc = {
            "id": str(uuid.uuid4()),
            "email": email.lower(),
            "hashed_password": bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode(),
            "display_name": "TEST direct",
            "plan": "free",
            "plan_source": "free",
            "plus_activated_at": None,
            "plus_expires_at": None,
            "is_superuser": False,
            "created_at": now,
            "updated_at": now,
        }
        db.users.insert_one(user_doc)
        try:
            # Insert stored email as lower-case; login queries by exact string.
            r = _post("/auth/login",
                      json_body={"email": email.lower(), "password": pw})
            assert r.status_code == 200, r.text
            u = r.json()["user"]
            assert u["plan"] == "plus", u
            assert u["plan_source"] == "ccad", u

            fresh = db.users.find_one({"email": email.lower()})
            assert fresh["plan"] == "plus"
            assert fresh["plan_source"] == "ccad"
        finally:
            db.users.delete_one({"email": email.lower()})


# =====================================================================
# Regression 2 — live Ziina checkout still works for non-CCAD free user
# Regression 3 — webhook HMAC verify + Plus activation
# =====================================================================
class TestRegressionBilling:
    def test_reg2_non_ccad_free_gets_real_ziina_redirect(self):
        email = f"TEST_free_{uuid.uuid4().hex[:8]}@gmail.com"
        tok = _register(email)["access_token"]
        r = _post("/billing/checkout",
                  json_body={},
                  extra_headers={"Authorization": f"Bearer {tok}"},
                  timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["redirect_url"].startswith("http"), d
        assert d.get("payment_intent_id")

    def test_reg3_webhook_bad_signature_401(self):
        raw = json.dumps({
            "event_type": "payment_intent.status.updated",
            "data": {"id": "pi_fake", "status": "completed"},
        }).encode()
        r = _post("/billing/webhook",
                  data=raw,
                  extra_headers={"X-Hmac-Signature": "deadbeef"})
        assert r.status_code == 401, r.text

    def test_reg3_webhook_valid_signature_activates_plus_for_paid_user(self):
        email = f"TEST_paid_{uuid.uuid4().hex[:8]}@gmail.com"
        reg = _register(email)
        tok = reg["access_token"]
        user_id = reg["user"]["id"]
        assert reg["user"]["plan"] == "free"
        assert reg["user"]["plan_source"] == "free"

        co = _post("/billing/checkout",
                   json_body={},
                   extra_headers={"Authorization": f"Bearer {tok}"},
                   timeout=30)
        assert co.status_code == 200, co.text
        intent_id = co.json()["payment_intent_id"]
        assert intent_id

        raw = json.dumps({
            "event_type": "payment_intent.status.updated",
            "data": {"id": intent_id, "status": "completed"},
        }).encode()
        sig = hmac.new(ZIINA_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        r = _post("/billing/webhook",
                  data=raw,
                  extra_headers={"X-Hmac-Signature": sig},
                  timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["received"] is True
        assert d["activated"] is True, d

        me = _get("/auth/me",
                  extra_headers={"Authorization": f"Bearer {tok}"}).json()
        assert me["plan"] == "plus", me
        assert me["plan_source"] == "paid", me
        assert me["id"] == user_id

        r2 = _post("/billing/webhook",
                   data=raw,
                   extra_headers={"X-Hmac-Signature": sig},
                   timeout=20)
        assert r2.status_code == 200
        assert r2.json()["activated"] is False
