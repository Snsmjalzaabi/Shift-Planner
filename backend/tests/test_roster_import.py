"""Roster import: codes are stored as written and imports are idempotent.

Runs in-process against an in-memory Mongo (mongomock-motor); no deployed
backend or credentials needed:

    pip install mongomock-motor pytest
    pytest backend/tests/test_roster_import.py
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

USER = {"id": "user-1", "email": "nurse@example.com", "plan": "plus", "is_superuser": False}


@pytest.fixture()
def api(monkeypatch):
    mock_db = AsyncMongoMockClient()["foxory_test"]
    monkeypatch.setattr(server, "db", mock_db)
    server.app.dependency_overrides[server.get_current_user] = lambda: USER
    with TestClient(server.app) as client:
        yield client, mock_db
    server.app.dependency_overrides.clear()


def _shift(date, code, key=None, type_="off"):
    body = {"date": date, "type": type_, "code": code, "is_draft": True, "source": "roster-image"}
    if key:
        body["import_key"] = key
    return body


def test_root_advertises_roster_features(api):
    client, _ = api
    assert set(client.get("/api/").json()["features"]) >= {"shift_code", "import_key"}


def test_codes_are_stored_exactly_as_written(api):
    client, _ = api
    for code in ["D", "N", "X", "XL", "AL"]:
        r = client.post("/api/shifts", json=_shift("2026-11-0" + str(["D", "N", "X", "XL", "AL"].index(code) + 1), code))
        assert r.status_code == 200, r.text
        assert r.json()["code"] == code
    stored = client.get("/api/shifts?month=2026-11").json()
    assert [s["code"] for s in stored] == ["D", "N", "X", "XL", "AL"]


def test_import_key_makes_create_idempotent(api):
    client, db = api
    key = "roster:aisha rahman:2026-11-02"
    first = client.post("/api/shifts", json=_shift("2026-11-02", "X", key)).json()
    second = client.post("/api/shifts", json=_shift("2026-11-02", "X", key)).json()
    assert second["id"] == first["id"]
    assert second.get("duplicate") is True
    assert len(client.get("/api/shifts?month=2026-11").json()) == 1


def test_shifts_without_roster_fields_are_unchanged(api):
    client, _ = api
    r = client.post("/api/shifts", json={"date": "2026-11-05", "type": "day", "start_time": "07:00", "end_time": "19:00"})
    body = r.json()
    assert r.status_code == 200
    assert "code" not in body and "import_key" not in body


def test_replace_updates_code_on_existing_shift(api):
    client, _ = api
    created = client.post("/api/shifts", json={"date": "2026-11-06", "type": "day"}).json()
    r = client.patch(
        f"/api/shifts/{created['id']}",
        json={"type": "off", "code": "XL", "import_key": "roster:aisha rahman:2026-11-06"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "XL"
    assert len(client.get("/api/shifts?month=2026-11").json()) == 1


def test_patch_cannot_create_duplicate_import_key(api):
    client, _ = api
    key = "roster:aisha rahman:2026-11-07"
    client.post("/api/shifts", json=_shift("2026-11-07", "N", key))
    other = client.post("/api/shifts", json={"date": "2026-11-07", "type": "day"}).json()
    r = client.patch(f"/api/shifts/{other['id']}", json={"import_key": key})
    assert r.status_code == 409


def test_rejects_malformed_code(api):
    client, _ = api
    assert client.post("/api/shifts", json=_shift("2026-11-08", "X;drop")).status_code == 400


def test_exports_show_the_roster_code(api):
    assert server.shift_label({"type": "off", "code": "X"}) == "X"
    assert server.shift_label({"type": "off", "code": "AL"}) == "AL"
    assert server.shift_label({"type": "day"}) == "Day Shift"


def test_reviewer_password_follows_env(monkeypatch):
    """App Review signs in with the env credentials even after they change."""
    import asyncio

    mock_db = AsyncMongoMockClient()["foxory_test"]
    monkeypatch.setattr(server, "db", mock_db)
    monkeypatch.setattr(server, "REVIEWER_EMAIL", "review@example.com")
    monkeypatch.setattr(server, "REVIEWER_PASSWORD", "first-password-123")
    asyncio.run(server.seed_reviewer())
    monkeypatch.setattr(server, "REVIEWER_PASSWORD", "second-password-456")
    asyncio.run(server.seed_reviewer())
    user = asyncio.run(mock_db.users.find_one({"email": "review@example.com"}))
    assert server.verify_password("second-password-456", user["hashed_password"])
    assert user["plan"] == "plus"
