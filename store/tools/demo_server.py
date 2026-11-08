"""Run the real Foxory backend on an in-memory database seeded with
synthetic demo data, for store screenshots.

    pip install -r backend/requirements.txt mongomock-motor uvicorn
    python store/tools/demo_server.py            # http://127.0.0.1:8001

Nothing touches a real database: the demo account and shifts exist only in
memory and are fictional (no real people or schedules).
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "foxory_store_demo")
os.environ.setdefault("JWT_SECRET", "store-demo-" + "x" * 40)
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081")
sys.path.insert(0, str(ROOT / "backend"))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402

DEMO_PASSWORD = "DemoPass!2026"
DEMO_NAME = "Alex Morgan"
# (email, plan, with sample shifts?) - free features are shown on a free
# account; only paid features (Excel export) use the Plus account.
ACCOUNTS = [
    ("alex.morgan@example.com", "free", True),
    ("alex.plus@example.com", "plus", True),
    ("alex.new@example.com", "free", False),
]

# One rotating pattern: two days, two nights, three off, with an on-call.
PATTERN = [
    ("day", "07:00", "19:00"),
    ("day", "07:00", "19:00"),
    ("night", "19:00", "07:00"),
    ("night", "19:00", "07:00"),
    ("off", None, None),
    ("off", None, None),
    ("on_call", "09:00", "17:00"),
]
LOCATIONS = {"day": "Ward 4B", "night": "Ward 4B", "on_call": "On-call rota"}


async def seed(db) -> None:
    for email, plan, with_shifts in ACCOUNTS:
        await seed_account(db, email, plan, with_shifts)


async def seed_account(db, email: str, plan: str, with_shifts: bool) -> None:
    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    await db.users.insert_one(
        {
            "id": user_id,
            "email": email,
            "display_name": DEMO_NAME,
            "hashed_password": server.hash_password(DEMO_PASSWORD),
            "is_superuser": False,
            "plan": plan,
            "plan_source": "store-demo",
            "plus_activated_at": now if plan == "plus" else None,
            "plus_expires_at": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    if not with_shifts:
        return
    today = date.today()
    first = today.replace(day=1)
    next_month = (first + timedelta(days=32)).replace(day=1)
    day = first
    i = 0
    while day < next_month:
        kind, start, end = PATTERN[i % len(PATTERN)]
        # Confirmed up to today, drafts after: a plan still being finalised.
        is_draft = day > today
        await db.shifts.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "date": day.isoformat(),
                "type": kind,
                "start_time": start,
                "end_time": end,
                "location": LOCATIONS.get(kind),
                "note": "Handover 06:45" if kind == "night" and i % 14 == 2 else None,
                "is_draft": is_draft,
                "created_at": now,
                "updated_at": now,
            }
        )
        day += timedelta(days=1)
        i += 1


def main() -> None:
    import uvicorn

    server.db = AsyncMongoMockClient()["foxory_store_demo"]
    asyncio.run(seed(server.db))
    uvicorn.run(server.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), log_level="warning")


if __name__ == "__main__":
    main()
