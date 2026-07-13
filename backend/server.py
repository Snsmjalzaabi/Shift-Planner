from __future__ import annotations

import base64
import html as html_escape
import io
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import bcrypt
import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel, EmailStr, Field
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Attachment,
    Disposition,
    FileContent,
    FileName,
    FileType,
    Mail,
)
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "foxory-shift-calendar-dev-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_HOURS = 24 * 7  # 7 days

SUPERUSER_EMAIL = os.environ.get("SUPERUSER_EMAIL", "Sultan942002@yahoo.com")
SUPERUSER_PASSWORD = os.environ.get("SUPERUSER_PASSWORD", "S.nsmjalzaabi1")

SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "").strip()
SENDGRID_FROM_EMAIL = os.environ.get(
    "SENDGRID_FROM_EMAIL",
    "Foxory Shift Calendar <no-reply@foxory.net>",
).strip()

ZIINA_API_KEY = os.environ.get("ZIINA_API_KEY", "").strip()
ZIINA_API_BASE = os.environ.get("ZIINA_API_BASE", "https://api-v2.ziina.com/api").rstrip("/")
ZIINA_TEST_MODE = os.environ.get("ZIINA_TEST_MODE", "true").strip().lower() == "true"
ZIINA_PRICE_FILS = int(os.environ.get("ZIINA_PRICE_FILS", "1099"))  # 10.99 AED
ZIINA_CURRENCY = os.environ.get("ZIINA_CURRENCY", "AED").strip().upper()
PLUS_PLAN_ID = "plus_yearly"
PLUS_DURATION_DAYS = 365

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("foxory")


# ---------------------------------------------------------------------------
# Security helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(sub: str, extra: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_HOURS),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict[str, Any]:
    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "hashed_password": 0})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=64)
    display_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, Any]


SHIFT_TYPES = {"day", "night", "on_call", "off"}


class ShiftCreate(BaseModel):
    date: str  # YYYY-MM-DD
    type: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    is_draft: bool = True


class ShiftUpdate(BaseModel):
    type: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    is_draft: Optional[bool] = None


class ExportRequest(BaseModel):
    month: str  # "YYYY-MM"
    include_confirmed: bool = False
    email_to: Optional[EmailStr] = None
    send: bool = False  # if True, attempt real delivery via SendGrid
    attach_xlsx: bool = False  # attach the .xlsx workbook when sending


# ---------------------------------------------------------------------------
# Lifespan + seed
# ---------------------------------------------------------------------------
async def seed_superuser() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.shifts.create_index([("user_id", 1), ("date", 1)])

    existing = await db.users.find_one({"email": SUPERUSER_EMAIL})
    now = datetime.now(timezone.utc)
    if existing is None:
        user_doc = {
            "id": str(uuid.uuid4()),
            "email": SUPERUSER_EMAIL,
            "display_name": "Sultan",
            "hashed_password": hash_password(SUPERUSER_PASSWORD),
            "is_superuser": True,
            "plan": "plus",
            "created_at": now,
            "updated_at": now,
        }
        await db.users.insert_one(user_doc)
        logger.info("Seeded superuser %s", SUPERUSER_EMAIL)
    else:
        await db.users.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "is_superuser": True,
                    "plan": existing.get("plan", "plus"),
                    "hashed_password": hash_password(SUPERUSER_PASSWORD),
                    "updated_at": now,
                }
            },
        )
        logger.info("Refreshed superuser %s", SUPERUSER_EMAIL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_superuser()
    yield
    client.close()


app = FastAPI(title="Foxory Shift Calendar API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Routes: Health & Branding
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {
        "app": "Foxory Shift Calendar",
        "created_by": "Foxory.net",
        "status": "ok",
    }


@api_router.get("/branding")
async def get_branding():
    return {
        "app_name": "Foxory Shift Calendar",
        "subtitle": "Smart shift planning for nurses and caregivers.",
        "created_by": "Foxory.net",
        "created_by_url": "https://foxory.net",
        "creator_signature": "Created by Foxory.net",
    }


# ---------------------------------------------------------------------------
# Routes: Auth
# ---------------------------------------------------------------------------
def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user.get("display_name"),
        "is_superuser": user.get("is_superuser", False),
        "plan": user.get("plan", "free"),
        "created_at": user["created_at"].isoformat()
        if isinstance(user["created_at"], datetime)
        else user["created_at"],
    }


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(body: RegisterRequest):
    existing = await db.users.find_one({"email": body.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    now = datetime.now(timezone.utc)
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": body.email,
        "display_name": body.display_name or body.email.split("@")[0],
        "hashed_password": hash_password(body.password),
        "is_superuser": False,
        "plan": "free",
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_doc["id"], {"email": user_doc["email"]})
    return {"access_token": token, "token_type": "bearer", "user": _public_user(user_doc)}


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(body: LoginRequest):
    user = await db.users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], {"email": user["email"]})
    return {"access_token": token, "token_type": "bearer", "user": _public_user(user)}


@api_router.get("/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _public_user(current_user)


def _require_plus(user: dict[str, Any]) -> None:
    if user.get("plan") != "plus" and not user.get("is_superuser"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "plus_required",
                "message": "This feature is available on the Plus $2.99/year plan.",
            },
        )


def _current_month_str() -> str:
    d = datetime.now(timezone.utc)
    return f"{d.year:04d}-{d.month:02d}"


def _require_current_month_or_plus(user: dict[str, Any], iso_date: str) -> None:
    """Free users can only touch shifts in the current calendar month."""
    if user.get("plan") == "plus" or user.get("is_superuser"):
        return
    if not iso_date.startswith(_current_month_str() + "-"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "plus_required",
                "message": (
                    "Multi-month planning is a Plus feature. "
                    "Upgrade to plan shifts outside the current month."
                ),
            },
        )


class PlanUpdate(BaseModel):
    plan: str = Field(pattern="^(free|plus)$")


@api_router.post("/auth/plan")
async def update_plan(
    body: PlanUpdate, current_user: dict = Depends(get_current_user)
):
    """Admin-only plan flip (used by superuser for testing).
    Regular users must go through /billing/checkout + /billing/verify."""
    if not current_user.get("is_superuser"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers may change plans directly. Use /billing/checkout.",
        )
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"plan": body.plan, "updated_at": now}},
    )
    fresh = await db.users.find_one(
        {"id": current_user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    return _public_user(fresh)


# ---------------------------------------------------------------------------
# Billing: Ziina hosted checkout for the Plus plan
# ---------------------------------------------------------------------------
def _price_display() -> str:
    whole = ZIINA_PRICE_FILS // 100
    fract = ZIINA_PRICE_FILS % 100
    return f"{ZIINA_CURRENCY} {whole}.{fract:02d}/year"


@api_router.get("/billing/config")
async def billing_config():
    return {
        "provider": "ziina",
        "test_mode": ZIINA_TEST_MODE,
        "configured": bool(ZIINA_API_KEY),
        "currency": ZIINA_CURRENCY,
        "price_fils": ZIINA_PRICE_FILS,
        "price_display": _price_display(),
        "plans": [
            {
                "id": PLUS_PLAN_ID,
                "name": "Foxory Plus",
                "price_display": _price_display(),
                "badge_display": "Plus $2.99/year",
                "period": "year",
                "features": [
                    "XLSX export with Plan Summary + Shift Details",
                    "Attach XLSX to email exports",
                    "Send real emails via SendGrid",
                    "Multi-month planning (any past/future month)",
                    "Priority support",
                ],
            }
        ],
    }


class CheckoutRequest(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


DEFAULT_SUCCESS_URL = "foxory://billing/success"
DEFAULT_CANCEL_URL = "foxory://billing/cancel"


@api_router.post("/billing/checkout")
async def create_checkout(
    body: CheckoutRequest, current_user: dict = Depends(get_current_user)
):
    if not ZIINA_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Ziina API key not configured on the backend.",
        )
    if current_user.get("plan") == "plus":
        raise HTTPException(status_code=400, detail="Already on Plus plan.")

    success_url = body.success_url or DEFAULT_SUCCESS_URL
    cancel_url = body.cancel_url or DEFAULT_CANCEL_URL

    payload = {
        "amount": ZIINA_PRICE_FILS,
        "currency_code": ZIINA_CURRENCY,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "message": f"Foxory Plus — {_price_display()}",
        "test": ZIINA_TEST_MODE,
    }
    headers = {
        "Authorization": f"Bearer {ZIINA_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            resp = await http.post(
                f"{ZIINA_API_BASE}/payment_intent", json=payload, headers=headers
            )
    except httpx.HTTPError as exc:
        logger.exception("Ziina checkout network error")
        raise HTTPException(status_code=502, detail=f"Ziina network error: {exc}")

    if resp.status_code >= 400:
        logger.error("Ziina checkout failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=502,
            detail=f"Ziina rejected the request ({resp.status_code}): {resp.text}",
        )

    data = resp.json()
    pi_id = data.get("id")
    redirect_url = data.get("redirect_url")
    pi_status = data.get("status")
    if not pi_id or not redirect_url:
        raise HTTPException(status_code=502, detail="Malformed Ziina response.")

    now = datetime.now(timezone.utc)
    await db.payments.insert_one(
        {
            "id": pi_id,
            "user_id": current_user["id"],
            "user_email": current_user["email"],
            "amount_fils": ZIINA_PRICE_FILS,
            "currency": ZIINA_CURRENCY,
            "test_mode": ZIINA_TEST_MODE,
            "status": pi_status or "pending",
            "plan_id": PLUS_PLAN_ID,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "redirect_url": redirect_url,
            "created_at": now,
            "updated_at": now,
        }
    )

    return {
        "payment_intent_id": pi_id,
        "redirect_url": redirect_url,
        "status": pi_status,
        "test_mode": ZIINA_TEST_MODE,
        "price_display": _price_display(),
    }


class VerifyRequest(BaseModel):
    payment_intent_id: str


async def _fetch_ziina_intent(intent_id: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {ZIINA_API_KEY}"}
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.get(f"{ZIINA_API_BASE}/payment_intent/{intent_id}", headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Ziina rejected the status check ({resp.status_code}): {resp.text}",
        )
    return resp.json()


@api_router.post("/billing/verify")
async def verify_checkout(
    body: VerifyRequest, current_user: dict = Depends(get_current_user)
):
    if not ZIINA_API_KEY:
        raise HTTPException(status_code=503, detail="Ziina API key not configured.")

    payment = await db.payments.find_one(
        {"id": body.payment_intent_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found for this user.")

    try:
        remote = await _fetch_ziina_intent(body.payment_intent_id)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ziina verify failed")
        raise HTTPException(status_code=502, detail=f"Ziina error: {exc}")

    new_status = remote.get("status") or payment.get("status", "pending")
    now = datetime.now(timezone.utc)
    activated = False
    expires_at: Optional[datetime] = None
    fresh_user = None

    update_doc: dict[str, Any] = {"status": new_status, "updated_at": now}

    if new_status == "completed":
        expires_at = now + timedelta(days=PLUS_DURATION_DAYS)
        update_doc.update({"completed_at": now, "plus_expires_at": expires_at})
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "plan": "plus",
                    "plus_expires_at": expires_at,
                    "plus_activated_at": now,
                    "updated_at": now,
                }
            },
        )
        activated = True

    await db.payments.update_one({"id": body.payment_intent_id}, {"$set": update_doc})

    if activated:
        fresh_user = await db.users.find_one(
            {"id": current_user["id"]}, {"_id": 0, "hashed_password": 0}
        )

    return {
        "payment_intent_id": body.payment_intent_id,
        "status": new_status,
        "activated": activated,
        "plus_expires_at": expires_at.isoformat() if expires_at else None,
        "user": _public_user(fresh_user) if fresh_user else None,
    }


# ---------------------------------------------------------------------------
# Routes: Shifts
# ---------------------------------------------------------------------------
def _validate_shift_type(t: str) -> None:
    if t not in SHIFT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid shift type. Must be one of {sorted(SHIFT_TYPES)}")


def _validate_date(d: str) -> None:
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")


def _serialize_shift(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("created_at", "updated_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    return out


@api_router.post("/shifts")
async def create_shift(body: ShiftCreate, current_user: dict = Depends(get_current_user)):
    _validate_shift_type(body.type)
    _validate_date(body.date)
    _require_current_month_or_plus(current_user, body.date)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "date": body.date,
        "type": body.type,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "location": body.location,
        "note": body.note,
        "is_draft": body.is_draft,
        "created_at": now,
        "updated_at": now,
    }
    await db.shifts.insert_one(dict(doc))
    return _serialize_shift(doc)


@api_router.get("/shifts")
async def list_shifts(
    month: Optional[str] = None,
    is_draft: Optional[bool] = None,
    current_user: dict = Depends(get_current_user),
):
    query: dict[str, Any] = {"user_id": current_user["id"]}
    if month:
        try:
            datetime.strptime(month, "%Y-%m")
        except ValueError:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
        query["date"] = {"$regex": f"^{month}-"}
    if is_draft is not None:
        query["is_draft"] = is_draft
    cursor = db.shifts.find(query, {"_id": 0}).sort("date", 1)
    items = await cursor.to_list(length=500)
    return [_serialize_shift(it) for it in items]


@api_router.patch("/shifts/{shift_id}")
async def update_shift(
    shift_id: str, body: ShiftUpdate, current_user: dict = Depends(get_current_user)
):
    if body.type is not None:
        _validate_shift_type(body.type)
    # Load existing shift to enforce plan gating on the ORIGINAL date.
    existing = await db.shifts.find_one(
        {"id": shift_id, "user_id": current_user["id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Shift not found")
    _require_current_month_or_plus(current_user, existing["date"])
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.shifts.find_one_and_update(
        {"id": shift_id, "user_id": current_user["id"]},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Shift not found")
    return _serialize_shift(result)


@api_router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.shifts.delete_one({"id": shift_id, "user_id": current_user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shift not found")
    return {"deleted": True, "id": shift_id}


@api_router.post("/shifts/{shift_id}/confirm")
async def confirm_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.shifts.find_one_and_update(
        {"id": shift_id, "user_id": current_user["id"]},
        {"$set": {"is_draft": False, "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Shift not found")
    return _serialize_shift(result)


# ---------------------------------------------------------------------------
# Routes: Export (XLSX + Email preview)
# ---------------------------------------------------------------------------
SHIFT_TYPE_LABELS = {
    "day": "Day Shift",
    "night": "Night Shift",
    "on_call": "On Call",
    "off": "Off",
}


async def _fetch_shifts_for_export(user_id: str, month: str, include_confirmed: bool) -> list[dict]:
    query: dict[str, Any] = {"user_id": user_id, "date": {"$regex": f"^{month}-"}}
    if not include_confirmed:
        query["is_draft"] = True
    cursor = db.shifts.find(query, {"_id": 0}).sort("date", 1)
    return await cursor.to_list(length=1000)


def _build_xlsx(user: dict, month: str, shifts: list[dict]) -> bytes:
    wb = Workbook()

    summary = wb.active
    summary.title = "Plan Summary"

    brand_fill = PatternFill(start_color="140C27", end_color="140C27", fill_type="solid")
    accent_font = Font(name="Calibri", size=14, bold=True, color="C084FC")
    header_font = Font(name="Calibri", size=11, bold=True, color="F8FAFC")
    body_font = Font(name="Calibri", size=11, color="F8FAFC")
    disclaimer_fill = PatternFill(start_color="1E143A", end_color="1E143A", fill_type="solid")
    disclaimer_font = Font(name="Calibri", size=10, italic=True, color="94A3B8")

    summary.column_dimensions["A"].width = 24
    summary.column_dimensions["B"].width = 60

    rows = [
        ("App Name", "Foxory Shift Calendar"),
        ("Created By", "Foxory.net"),
        ("Export Type", "Draft Planner Export"),
        ("Month", month),
        ("User", user.get("email", "")),
        ("Plan", str(user.get("plan", "free")).upper()),
        ("Generated At", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")),
        ("Total Shifts", str(len(shifts))),
    ]

    summary["A1"] = "Foxory Shift Calendar"
    summary["A1"].font = accent_font
    summary["A1"].fill = brand_fill
    summary["B1"] = "Draft Planner Export"
    summary["B1"].font = header_font
    summary["B1"].fill = brand_fill

    for idx, (label, value) in enumerate(rows, start=3):
        cell_a = summary.cell(row=idx, column=1, value=label)
        cell_b = summary.cell(row=idx, column=2, value=value)
        cell_a.font = header_font
        cell_a.fill = brand_fill
        cell_b.font = body_font
        cell_b.alignment = Alignment(horizontal="left")

    disclaimer_row = 3 + len(rows) + 1
    d_cell_a = summary.cell(row=disclaimer_row, column=1, value="Reminder")
    d_cell_b = summary.cell(
        row=disclaimer_row,
        column=2,
        value="This draft plan does not change the confirmed calendar.",
    )
    d_cell_a.font = header_font
    d_cell_a.fill = disclaimer_fill
    d_cell_b.font = disclaimer_font
    d_cell_b.fill = disclaimer_fill
    d_cell_b.alignment = Alignment(horizontal="left", wrap_text=True)

    signature_row = disclaimer_row + 2
    sig_cell = summary.cell(row=signature_row, column=1, value="Created by Foxory.net")
    sig_cell.font = Font(name="Calibri", size=9, italic=True, color="64748B")
    summary.merge_cells(
        start_row=signature_row,
        start_column=1,
        end_row=signature_row,
        end_column=2,
    )

    detail = wb.create_sheet("Shift Details")
    headers = ["Date", "Day", "Type", "Start", "End", "Location", "Note", "Status"]
    for col, h in enumerate(headers, start=1):
        c = detail.cell(row=1, column=col, value=h)
        c.font = header_font
        c.fill = brand_fill
        c.alignment = Alignment(horizontal="center")

    for width, letter in zip([12, 12, 14, 10, 10, 24, 40, 14], "ABCDEFGH"):
        detail.column_dimensions[letter].width = width

    for i, s in enumerate(shifts, start=2):
        try:
            d_obj = datetime.strptime(s["date"], "%Y-%m-%d").date()
            day_name = d_obj.strftime("%A")
        except Exception:
            day_name = ""
        row_vals = [
            s.get("date", ""),
            day_name,
            SHIFT_TYPE_LABELS.get(s.get("type", ""), s.get("type", "")),
            s.get("start_time") or "",
            s.get("end_time") or "",
            s.get("location") or "",
            s.get("note") or "",
            "Draft" if s.get("is_draft", True) else "Confirmed",
        ]
        for col, val in enumerate(row_vals, start=1):
            detail.cell(row=i, column=col, value=val).font = body_font

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_email_body(user: dict, month: str, shifts: list[dict]) -> str:
    lines = [
        f"Hi {user.get('display_name') or user.get('email', 'there')},",
        "",
        f"Here is your draft shift plan for {month}.",
        "",
        "─────────────────────────────",
    ]
    if not shifts:
        lines.append("No draft shifts have been added for this month yet.")
    else:
        for s in shifts:
            label = SHIFT_TYPE_LABELS.get(s.get("type", ""), s.get("type", ""))
            times = ""
            if s.get("start_time") and s.get("end_time"):
                times = f" · {s['start_time']}–{s['end_time']}"
            loc = f" @ {s['location']}" if s.get("location") else ""
            lines.append(f"• {s['date']}  {label}{times}{loc}")
    lines.extend(
        [
            "─────────────────────────────",
            "",
            "Reminder: This draft plan does not change the confirmed calendar.",
            "",
            "—",
            "This draft shift plan was created using Foxory Shift Calendar — created by Foxory.net.",
        ]
    )
    return "\n".join(lines)


def _build_email_html(user: dict, month: str, shifts: list[dict]) -> str:
    def _e(v: Any) -> str:
        return html_escape.escape(str(v or ""))

    rows_html = ""
    if not shifts:
        rows_html = (
            '<tr><td colspan="4" style="padding:16px;color:#94A3B8;'
            'font-style:italic;text-align:center;">'
            "No draft shifts have been added for this month yet.</td></tr>"
        )
    else:
        for s in shifts:
            label = SHIFT_TYPE_LABELS.get(s.get("type", ""), s.get("type", ""))
            time_str = ""
            if s.get("start_time") or s.get("end_time"):
                time_str = f"{_e(s.get('start_time') or '—')} → {_e(s.get('end_time') or '—')}"
            rows_html += (
                "<tr>"
                f'<td style="padding:10px 12px;border-bottom:1px solid #221641;color:#F8FAFC;font-weight:600;">{_e(s.get("date"))}</td>'
                f'<td style="padding:10px 12px;border-bottom:1px solid #221641;color:#C084FC;">{_e(label)}</td>'
                f'<td style="padding:10px 12px;border-bottom:1px solid #221641;color:#94A3B8;font-family:monospace;">{time_str}</td>'
                f'<td style="padding:10px 12px;border-bottom:1px solid #221641;color:#94A3B8;">{_e(s.get("location") or "")}</td>'
                "</tr>"
            )

    greet = _e(user.get("display_name") or user.get("email", "there"))

    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#090514;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#090514;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#140C27;border:1px solid #2D1B4E;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 8px;">
                <div style="color:#C084FC;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Foxory Shift Calendar</div>
                <div style="color:#F8FAFC;font-size:22px;font-weight:800;margin-top:4px;">Draft plan for {_e(month)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0;color:#94A3B8;font-size:14px;line-height:22px;">
                Hi {greet},<br/>
                Here is your draft shift plan.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0C0620;border:1px solid #221641;border-radius:12px;overflow:hidden;">
                  <thead>
                    <tr>
                      <th align="left" style="padding:10px 12px;color:#64748B;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;background:#0F0827;">Date</th>
                      <th align="left" style="padding:10px 12px;color:#64748B;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;background:#0F0827;">Type</th>
                      <th align="left" style="padding:10px 12px;color:#64748B;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;background:#0F0827;">Time</th>
                      <th align="left" style="padding:10px 12px;color:#64748B;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;background:#0F0827;">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows_html}
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 28px 16px;color:#94A3B8;font-size:12px;font-style:italic;">
                Reminder: This draft plan does not change the confirmed calendar.
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px;">
                <div style="border-top:1px solid #2D1B4E;padding-top:16px;color:#64748B;font-size:11px;">
                  This draft shift plan was created using
                  <span style="color:#94A3B8;font-weight:600;">Foxory Shift Calendar</span>
                  — created by
                  <a href="https://foxory.net" style="color:#C084FC;text-decoration:underline;">Foxory.net</a>.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _send_email_via_sendgrid(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
    attachment: Optional[tuple[str, bytes, str]] = None,
) -> tuple[bool, Optional[str], Optional[str]]:
    """Send email via SendGrid.

    Returns (delivered, message_id, error). If the API key is missing this
    returns (False, None, 'no_api_key') so callers can degrade to preview-only.
    """
    if not SENDGRID_API_KEY:
        return False, None, "no_api_key"

    message = Mail(
        from_email=SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        plain_text_content=text_body,
        html_content=html_body,
    )

    if attachment:
        filename, data, content_type = attachment
        message.attachment = Attachment(
            FileContent(base64.b64encode(data).decode("ascii")),
            FileName(filename),
            FileType(content_type),
            Disposition("attachment"),
        )

    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(message)
        message_id = None
        try:
            message_id = resp.headers.get("X-Message-Id")
        except Exception:  # noqa: BLE001
            message_id = None
        delivered = 200 <= int(getattr(resp, "status_code", 0)) < 300
        if not delivered:
            return False, message_id, f"http_{resp.status_code}"
        return True, message_id, None
    except Exception as exc:  # noqa: BLE001
        logger.exception("SendGrid delivery failed")
        return False, None, str(exc)


@api_router.post("/export/xlsx")
async def export_xlsx(body: ExportRequest, current_user: dict = Depends(get_current_user)):
    _require_plus(current_user)
    try:
        datetime.strptime(body.month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    shifts = await _fetch_shifts_for_export(current_user["id"], body.month, body.include_confirmed)
    data = _build_xlsx(current_user, body.month, shifts)
    b64 = base64.b64encode(data).decode("ascii")
    filename = f"foxory-shift-plan-{body.month}.xlsx"
    return {
        "filename": filename,
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "base64": b64,
        "size_bytes": len(data),
        "shift_count": len(shifts),
        "created_by": "Foxory.net",
    }


@api_router.post("/export/email")
async def export_email(body: ExportRequest, current_user: dict = Depends(get_current_user)):
    try:
        datetime.strptime(body.month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    shifts = await _fetch_shifts_for_export(current_user["id"], body.month, body.include_confirmed)
    to_email = body.email_to or current_user["email"]
    subject = f"Foxory Shift Calendar — Draft Plan for {body.month}"
    body_text = _build_email_body(current_user, body.month, shifts)
    body_html = _build_email_html(current_user, body.month, shifts)

    result: dict[str, Any] = {
        "to": to_email,
        "subject": subject,
        "body": body_text,
        "html": body_html,
        "shift_count": len(shifts),
        "signature": "Created by Foxory.net",
        "delivered": False,
        "provider": None,
        "message_id": None,
        "delivery_error": None,
        "sendgrid_configured": bool(SENDGRID_API_KEY),
    }

    if body.send:
        _require_plus(current_user)
        attachment = None
        if body.attach_xlsx:
            xlsx_bytes = _build_xlsx(current_user, body.month, shifts)
            attachment = (
                f"foxory-shift-plan-{body.month}.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        delivered, message_id, err = _send_email_via_sendgrid(
            to_email, subject, body_text, body_html, attachment
        )
        result["delivered"] = delivered
        result["provider"] = "sendgrid" if SENDGRID_API_KEY else None
        result["message_id"] = message_id
        result["delivery_error"] = err

    return result


app.include_router(api_router)
