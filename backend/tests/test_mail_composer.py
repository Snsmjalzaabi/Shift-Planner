"""MC-1 .. MC-7 + SU-1 + Regression tests for mail-composer migration."""
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://nurse-planner-5.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SUPER_EMAIL = "Sultan942002@yahoo.com"
SUPER_PASS = "S.nsmjalzaabi1"
MONTH = "2026-03"

SERVER_PY = Path("/app/backend/server.py")
BACKEND_ENV = Path("/app/backend/.env")

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def super_token():
    r = session.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fresh_free_user():
    email = f"TEST_{uuid.uuid4().hex[:10]}@example.com"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "testpass123", "display_name": "TEST Free"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def fresh_ccad_user():
    email = f"nurse{uuid.uuid4().hex[:6]}@ccad.ae"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "testpass123", "display_name": "TEST CCAD"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user": d["user"]}


# --------------------------------------------------------------------------
# MC-1 / MC-3 / MC-4 : new /api/export/email shape
# --------------------------------------------------------------------------
def test_mc1_export_email_shape(super_token):
    r = session.post(
        f"{API}/export/email",
        json={"month": MONTH, "include_confirmed": True},
        headers=_auth(super_token), timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    expected_keys = {"to", "subject", "body", "html", "shift_count", "signature"}
    assert set(d.keys()) == expected_keys, f"Unexpected keys: {set(d.keys()) ^ expected_keys}"
    forbidden = {"delivered", "provider", "message_id", "delivery_error",
                 "sendgrid_configured", "html_body"}
    assert not (set(d.keys()) & forbidden), f"Forbidden keys present: {set(d.keys()) & forbidden}"
    assert d["to"] == SUPER_EMAIL
    assert isinstance(d["shift_count"], int)


def test_mc3_body_ends_with_signature(super_token):
    r = session.post(
        f"{API}/export/email",
        json={"month": MONTH, "include_confirmed": True},
        headers=_auth(super_token), timeout=15,
    )
    assert r.status_code == 200
    body = r.json()["body"]
    assert body.rstrip().endswith(
        "This draft shift plan was created using Foxory Shift Calendar — created by Foxory.net."
    ), f"Body tail: {body[-200:]!r}"


def test_mc4_html_contains_created_by_and_link(super_token):
    r = session.post(
        f"{API}/export/email",
        json={"month": MONTH, "include_confirmed": True},
        headers=_auth(super_token), timeout=15,
    )
    assert r.status_code == 200
    html = r.json()["html"]
    assert "created by" in html.lower()
    assert "https://foxory.net" in html


# --------------------------------------------------------------------------
# MC-2 : legacy client fields must not break the endpoint
# --------------------------------------------------------------------------
def test_mc2_legacy_fields_ignored_or_422(super_token):
    r = session.post(
        f"{API}/export/email",
        json={
            "month": MONTH, "include_confirmed": True,
            "send": True, "attach_xlsx": True, "email_to": "foo@bar.com",
        },
        headers=_auth(super_token), timeout=15,
    )
    assert r.status_code in (200, 422), r.text
    if r.status_code == 200:
        d = r.json()
        # No email leaked to third party — 'to' must still be current user's
        assert d["to"] == SUPER_EMAIL
        # No delivery fields in response
        forbidden = {"delivered", "provider", "message_id", "delivery_error",
                     "sendgrid_configured", "html_body"}
        assert not (set(d.keys()) & forbidden)


# --------------------------------------------------------------------------
# MC-5 : CCAD user works
# --------------------------------------------------------------------------
def test_mc5_ccad_user_export_email(fresh_ccad_user):
    assert fresh_ccad_user["user"]["plan"] == "plus"
    assert fresh_ccad_user["user"]["plan_source"] == "ccad"
    r = session.post(
        f"{API}/export/email",
        json={"month": MONTH, "include_confirmed": True},
        headers=_auth(fresh_ccad_user["token"]), timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["to"] == fresh_ccad_user["email"]
    assert d["signature"] == "Created by Foxory.net"


# --------------------------------------------------------------------------
# MC-6 : grep code + env for banned tokens
# --------------------------------------------------------------------------
def test_mc6_no_sendgrid_or_delivered_in_source():
    text = SERVER_PY.read_text()
    forbidden = ["sendgrid", "SendGrid", "SENDGRID", "delivered", "sendgrid_configured"]
    hits = {}
    for kw in forbidden:
        matches = [
            (i + 1, ln.rstrip())
            for i, ln in enumerate(text.splitlines())
            if kw.lower() in ln.lower()
        ]
        if matches:
            hits[kw] = matches
    assert not hits, f"Forbidden tokens present in server.py: {hits}"


def test_mc6_no_sendgrid_in_env():
    envtxt = BACKEND_ENV.read_text()
    assert "SENDGRID" not in envtxt.upper(), \
        f"SENDGRID key found in /app/backend/.env: {envtxt}"


# --------------------------------------------------------------------------
# MC-7 : sendgrid module never imported in backend python
# --------------------------------------------------------------------------
def test_mc7_no_sendgrid_import():
    backend_dir = Path("/app/backend")
    offenders = []
    for py in backend_dir.rglob("*.py"):
        # skip site-packages / venv
        s = str(py)
        if "/.venv/" in s or "/site-packages/" in s or "/node_modules/" in s:
            continue
        content = py.read_text(errors="ignore")
        if re.search(r"^\s*(from\s+sendgrid|import\s+sendgrid)", content, re.M):
            offenders.append(str(py))
    assert not offenders, f"sendgrid imported in: {offenders}"


# --------------------------------------------------------------------------
# SU-1 : superuser has plan_source='paid'
# --------------------------------------------------------------------------
def test_su1_superuser_plan_source_paid(super_token):
    r = session.get(f"{API}/auth/me", headers=_auth(super_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["email"] == SUPER_EMAIL
    assert d["plan"] == "plus"
    assert d["plan_source"] == "paid", f"plan_source={d.get('plan_source')!r}"
    assert d["is_superuser"] is True


# --------------------------------------------------------------------------
# Regression 2: /api/billing/checkout returns real Ziina redirect_url
# --------------------------------------------------------------------------
def test_reg2_billing_checkout_returns_redirect(fresh_free_user):
    r = session.post(
        f"{API}/billing/checkout",
        json={},
        headers=_auth(fresh_free_user["token"]), timeout=30,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["payment_intent_id"]
    url = d["redirect_url"]
    assert url.startswith("https://"), f"redirect_url not https: {url}"
    assert "ziina" in url.lower(), f"redirect_url doesn't look like ziina: {url}"


# --------------------------------------------------------------------------
# Regression 3: Ziina webhook HMAC verify + idempotent plus activation
# --------------------------------------------------------------------------
def _load_webhook_secret() -> str:
    txt = BACKEND_ENV.read_text()
    for ln in txt.splitlines():
        if ln.startswith("ZIINA_WEBHOOK_SECRET"):
            v = ln.split("=", 1)[1].strip().strip('"').strip("'")
            return v
    raise RuntimeError("ZIINA_WEBHOOK_SECRET not found in .env")


def test_reg3_webhook_bad_signature_401():
    body = json.dumps({"event_type": "payment_intent.status.updated",
                       "data": {"id": "pi_fake_bad", "status": "completed"}}).encode()
    r = session.post(
        f"{API}/billing/webhook", data=body,
        headers={"Content-Type": "application/json",
                 "X-Hmac-Signature": "deadbeef"}, timeout=15,
    )
    assert r.status_code == 401, r.text


def test_reg3_webhook_valid_hmac_and_plus_activation(fresh_free_user):
    # Create a real payment intent for this user so the webhook has something
    # to update. Ziina must be reachable in the container.
    r = session.post(
        f"{API}/billing/checkout", json={},
        headers=_auth(fresh_free_user["token"]), timeout=30,
    )
    assert r.status_code == 200, r.text
    intent_id = r.json()["payment_intent_id"]

    secret = _load_webhook_secret()
    payload = {
        "event_type": "payment_intent.status.updated",
        "data": {"id": intent_id, "status": "completed"},
    }
    raw = json.dumps(payload).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()

    # First webhook call — should activate Plus
    r1 = session.post(
        f"{API}/billing/webhook", data=raw,
        headers={"Content-Type": "application/json", "X-Hmac-Signature": sig},
        timeout=15,
    )
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["received"] is True
    assert d1["intent_id"] == intent_id
    assert d1["activated"] is True

    # Idempotent — replay must not re-activate
    r2 = session.post(
        f"{API}/billing/webhook", data=raw,
        headers={"Content-Type": "application/json", "X-Hmac-Signature": sig},
        timeout=15,
    )
    assert r2.status_code == 200
    assert r2.json()["activated"] is False

    # /auth/me now reflects plus + paid
    me = session.get(f"{API}/auth/me",
                     headers=_auth(fresh_free_user["token"]), timeout=15)
    assert me.status_code == 200
    md = me.json()
    assert md["plan"] == "plus"
    assert md["plan_source"] == "paid"


# --------------------------------------------------------------------------
# Regression 4: Free user gets 402 on /api/export/xlsx
# --------------------------------------------------------------------------
def test_reg4_free_user_xlsx_402():
    email = f"TEST_{uuid.uuid4().hex[:10]}@example.com"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "testpass123"},
        timeout=30,
    )
    assert r.status_code == 200
    tok = r.json()["access_token"]
    r = session.post(
        f"{API}/export/xlsx", json={"month": MONTH},
        headers=_auth(tok), timeout=15,
    )
    assert r.status_code == 402, r.text
    detail = r.json().get("detail", {})
    assert isinstance(detail, dict) and detail.get("code") == "plus_required"


# --------------------------------------------------------------------------
# Regression 5: CCAD auto-plus + plan_source='ccad'
# --------------------------------------------------------------------------
def test_reg5_ccad_auto_upgrade(fresh_ccad_user):
    u = fresh_ccad_user["user"]
    assert u["plan"] == "plus"
    assert u["plan_source"] == "ccad"
    # Also verify via /me
    r = session.get(f"{API}/auth/me",
                    headers=_auth(fresh_ccad_user["token"]), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["plan"] == "plus"
    assert d["plan_source"] == "ccad"


def test_reg5_ccad_second_domain():
    email = f"nurse{uuid.uuid4().hex[:6]}@clevelandclinicabudhabi.ae"
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "testpass123"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["plan"] == "plus"
    assert u["plan_source"] == "ccad"


# --------------------------------------------------------------------------
# Regression 6: Login rate-limit 10/minute → 11th = 429
# NOTE: Backend was restarted at test session start to empty buckets.
# --------------------------------------------------------------------------
def test_reg6_login_rate_limit():
    # Use a non-existent email so we don't burn a real login and get 401s
    # (rate-limit dep runs before the endpoint body, so 401s still count).
    email = f"TEST_RL_{uuid.uuid4().hex[:8]}@example.com"
    codes = []
    for i in range(12):
        r = session.post(
            f"{API}/auth/login",
            json={"email": email, "password": "wrong"},
            timeout=10,
        )
        codes.append(r.status_code)
        if r.status_code == 429:
            break
    assert 429 in codes, f"Expected a 429 within 12 attempts, got: {codes}"
    # NOTE: the super_token fixture already consumed 1 login slot from this
    # same IP earlier in the session; so we expect ~9 non-429s here (10 total
    # counting the fixture call) before the 11th request returns 429.
    non_429 = [c for c in codes if c != 429]
    assert len(non_429) >= 8, f"429 fired way too early: {codes}"
