from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import secrets
import asyncio
import hmac
import base64
import re
import io
import ipaddress
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated

import bcrypt
import jwt
import httpx
import stripe
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from bson import ObjectId
from pymongo import ReturnDocument
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, BeforeValidator, ConfigDict

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_emergent"
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=60), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("suspended"):
            raise HTTPException(status_code=403, detail="Your portal access has been suspended. Please contact DBG Signs.")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_staff(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("admin", "salesman"):
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_worker(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("admin", "salesman", "installer"):
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


async def verify_admin_password(user: dict, password: str) -> None:
    u = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not u or not verify_password(password or "", u.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Incorrect admin password")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
PyObjectId = Annotated[str, BeforeValidator(str)]


class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    company: Optional[str] = None
    phone: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class LineItem(BaseModel):
    description: str = ""
    details: Optional[str] = ""
    category: Optional[str] = None
    material_id: Optional[str] = None
    width_in: float = 0.0
    height_in: float = 0.0
    quantity: float = 1
    price_per_sqft: float = 0.0
    cost_per_sqft: float = 0.0
    unit_price: Optional[float] = None
    line_total_override: Optional[float] = None
    extra_labor_hours: float = 0.0


class CustomerInput(BaseModel):
    name: str
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tier: Optional[int] = None  # 1=35%, 2=25%, 3=15% discount
    title: Optional[str] = None
    net_terms: Optional[str] = "Net 15"  # COD, 50/50, Net 10, Net 15
    tax_exempt: bool = False
    tax_exempt_number: Optional[str] = None
    portal_enabled: bool = False


class MaterialInput(BaseModel):
    name: str
    category: Optional[str] = None
    unit: str = "roll"  # roll / sheet / each
    buying_cost: float = 0.0        # cost per purchased unit (roll/sheet)
    conversion_factor: float = 1.0  # usable sqft per purchased unit
    markup: float = 0.0             # price multiplier on cost (price = cost x markup)
    stock: Optional[float] = None
    supplier: Optional[str] = None
    image_url: Optional[str] = None


class EstimateInput(BaseModel):
    customer_id: str
    contact_id: Optional[str] = None
    title: str
    customer_po: Optional[str] = None
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    tax_exempt: bool = False
    tax_exempt_number: Optional[str] = None
    order_date: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    status: str = "draft"  # draft, sent, approved, rejected
    commission_rate: float = 0.0
    salesman_id: Optional[str] = None
    salesman_name: Optional[str] = None


class InvoiceInput(BaseModel):
    customer_id: str
    contact_id: Optional[str] = None
    title: str
    customer_po: Optional[str] = None
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    tax_exempt: bool = False
    tax_exempt_number: Optional[str] = None
    order_date: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "unpaid"  # unpaid, paid, partial, overdue


class ContactInput(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None


class ContactPortalInput(BaseModel):
    password: str


class BillInput(BaseModel):
    vendor: str
    reference: Optional[str] = None
    description: Optional[str] = None
    amount: float = 0.0
    due_date: Optional[str] = None
    status: str = "unpaid"  # unpaid, paid


class ReorderInput(BaseModel):
    source_invoice_id: Optional[str] = None
    title: str
    notes: Optional[str] = None


class SettingsInput(BaseModel):
    shop_rate_per_hr: float = 65.0
    shop_sqft_per_hr: float = 150.0
    machine_rate_per_hr: float = 35.0
    machine_sqft_per_hr: float = 150.0
    laminator_rate_per_hr: float = 35.0
    laminator_sqft_per_hr: float = 150.0
    cnc_rate_per_min: float = 1.30
    default_markup: float = 2.0
    default_tax_rate: float = 0.0
    card_surcharge_enabled: bool = False
    card_surcharge_pct: float = 0.0
    low_margin_threshold: float = 0.0
    company_name: Optional[str] = "DBG Signs, Inc."
    company_address: Optional[str] = ""
    company_phone: Optional[str] = ""
    company_web: Optional[str] = ""
    company_email: Optional[str] = ""


class StaffInput(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    name: str
    role: str = "salesman"  # admin | salesman | installer
    commission_rate: float = 0.0


class WorkOrderInput(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    date: str
    work_performed: str = ""
    unit_vin: str = ""
    equipment_type: str = ""
    equipment_other: Optional[str] = ""
    mileage_start: Optional[float] = None
    mileage_end: Optional[float] = None
    worker_id: Optional[str] = None


class DeleteConfirm(BaseModel):
    password: str


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str


# ---------------------------------------------------------------------------
# Utils
# ---------------------------------------------------------------------------
def oid(id_str: str) -> ObjectId:
    if not ObjectId.is_valid(id_str):
        raise HTTPException(status_code=404, detail="Not found")
    return ObjectId(id_str)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


DEFAULT_SETTINGS = {"shop_rate_per_hr": 65.0, "shop_sqft_per_hr": 150.0, "machine_rate_per_hr": 35.0, "machine_sqft_per_hr": 150.0, "default_markup": 2.0,
                    "laminator_rate_per_hr": 35.0, "laminator_sqft_per_hr": 150.0, "cnc_rate_per_min": 1.30,
                    "default_tax_rate": 0.0, "card_surcharge_enabled": False, "card_surcharge_pct": 0.0, "low_margin_threshold": 0.0,
                    "company_name": "DBG Signs, Inc.", "company_address": "", "company_phone": "", "company_web": "", "company_email": ""}
_NUMERIC_SETTINGS = {"shop_rate_per_hr", "shop_sqft_per_hr", "machine_rate_per_hr", "machine_sqft_per_hr", "laminator_rate_per_hr", "laminator_sqft_per_hr", "cnc_rate_per_min", "default_markup", "default_tax_rate", "card_surcharge_pct", "low_margin_threshold"}

PRESET_CATEGORIES = ["Cut Vinyl", "Digital Vinyl", "Banner", "Substrates", "Laminates", "Marketing Materials", "CNC Router Time", "Installation", "Shipping"]


async def get_settings() -> dict:
    s = await db.settings.find_one({"key": "shop"})
    if not s:
        await db.settings.insert_one({"key": "shop", **DEFAULT_SETTINGS})
        return dict(DEFAULT_SETTINGS)
    return {k: (float(s.get(k, v)) if k in _NUMERIC_SETTINGS else (s.get(k, v) if s.get(k, v) is not None else v)) for k, v in DEFAULT_SETTINGS.items()}


def material_out(doc: dict) -> dict:
    d = clean(doc)
    bc = float(d.get("buying_cost") or 0)
    cf = float(d.get("conversion_factor") or 0)
    mk = float(d.get("markup") or 0)
    cost_per_sqft = round(bc / cf, 4) if cf else 0.0
    d["cost_per_sqft"] = cost_per_sqft
    d["price_per_sqft"] = round(cost_per_sqft * mk, 4) if mk > 0 else cost_per_sqft
    return d


def compute_line(li: dict, s: dict) -> dict:
    w = float(li.get("width_in") or 0)
    h = float(li.get("height_in") or 0)
    qty = float(li.get("quantity") or 0)
    # If width & height given, area = (W*H/144)*qty; otherwise qty acts as sqft
    area = round((w * h / 144.0) * qty, 4) if (w > 0 and h > 0) else round(qty, 4)
    pps = float(li.get("price_per_sqft") or 0)
    material_cost = round(pps * area, 2)
    cps = float(li.get("cost_per_sqft") or 0)
    material_buying_cost = round(cps * area, 2)
    # Machine + shop time derived from throughput (sqft/hr); round currency not hours
    m_sqft = float(s.get("machine_sqft_per_hr") or 0)
    machine_hours_raw = area / m_sqft if m_sqft else 0.0
    machine_cost = round(machine_hours_raw * float(s.get("machine_rate_per_hr") or 0), 2)
    sh_sqft = float(s.get("shop_sqft_per_hr") or 0)
    labor_hours_raw = (area / sh_sqft if sh_sqft else 0.0) + float(li.get("extra_labor_hours") or 0)
    labor_cost = round(labor_hours_raw * float(s.get("shop_rate_per_hr") or 0), 2)
    # Shipping, Installation & CNC Router Time are flat charges — no shop/machine labor applied
    if str(li.get("category") or "").strip().lower() in ("shipping", "installation", "cnc router time"):
        labor_cost = 0.0
        machine_cost = 0.0
    computed_total = round(material_cost + labor_cost + machine_cost, 2)
    ov = li.get("line_total_override")
    up = li.get("unit_price")
    if ov is not None and str(ov) != "" and float(ov) > 0:
        line_total = round(float(ov), 2)
    elif up is not None and str(up) != "" and float(up) > 0:
        line_total = round(float(up) * (qty if qty > 0 else 1), 2)
    else:
        line_total = computed_total
    # Gross profit = sale - material cost - shop - machine (labor/machine billed at cost)
    material_margin = round(line_total - material_buying_cost - labor_cost - machine_cost, 2)
    item = dict(li)
    item.update({
        "area_sqft": area,
        "machine_hours": round(machine_hours_raw, 4),
        "labor_hours": round(labor_hours_raw, 4),
        "material_cost": material_cost,
        "labor_cost": labor_cost,
        "machine_cost": machine_cost,
        "line_total": line_total,
        "cost_per_sqft": cps,
        "material_buying_cost": material_buying_cost,
        "material_margin": material_margin,
    })
    return item


TIER_DISCOUNT = {1: 35.0, 2: 25.0, 3: 15.0}


async def customer_discount(customer_id: Optional[str]) -> float:
    if not customer_id or not ObjectId.is_valid(customer_id):
        return 0.0
    c = await db.customers.find_one({"_id": ObjectId(customer_id)})
    if not c or not c.get("tier"):
        return 0.0
    try:
        return TIER_DISCOUNT.get(int(c["tier"]), 0.0)
    except (ValueError, TypeError):
        return 0.0


async def compute_totals(line_items: List[dict], tax_rate: float, discount_rate: float = 0.0) -> dict:
    s = await get_settings()
    # Resolve material buying cost/sqft from the material record (never trust client for cost)
    mat_ids = [li.get("material_id") for li in line_items if li.get("material_id") and ObjectId.is_valid(li.get("material_id"))]
    cost_map = {}
    if mat_ids:
        async for m in db.materials.find({"_id": {"$in": [ObjectId(x) for x in set(mat_ids)]}}):
            bc = float(m.get("buying_cost") or 0)
            cf = float(m.get("conversion_factor") or 0)
            cost_map[str(m["_id"])] = round(bc / cf, 4) if cf else 0.0
    items = []
    for li in line_items:
        li2 = dict(li)
        client_cost = float(li.get("cost_per_sqft") or 0)
        li2["cost_per_sqft"] = client_cost or cost_map.get(li2.get("material_id"), 0.0)
        items.append(compute_line(li2, s))
    subtotal = round(sum(i["line_total"] for i in items), 2)
    discount_amount = round(subtotal * (discount_rate / 100.0), 2)
    discounted = round(subtotal - discount_amount, 2)
    tax_amount = round(discounted * (tax_rate / 100.0), 2)
    total = round(discounted + tax_amount, 2)
    material_margin = round(sum(i["material_margin"] for i in items), 2)
    material_margin_pct = round(material_margin / subtotal * 100, 1) if subtotal else 0.0
    return {
        "line_items": items, "subtotal": subtotal,
        "discount_rate": discount_rate, "discount_amount": discount_amount,
        "tax_amount": tax_amount, "total": total,
        "material_margin": material_margin, "material_margin_pct": material_margin_pct,
    }


# Fields carrying internal cost/margin data that customers must never see
_MARGIN_LINE_FIELDS = ("cost_per_sqft", "material_buying_cost", "material_margin")
_MARGIN_DOC_FIELDS = ("material_margin", "material_margin_pct")


def strip_margins(doc: dict) -> dict:
    d = dict(doc)
    for f in _MARGIN_DOC_FIELDS:
        d.pop(f, None)
    if isinstance(d.get("line_items"), list):
        d["line_items"] = [{k: v for k, v in li.items() if k not in _MARGIN_LINE_FIELDS} for li in d["line_items"]]
    return d


def renumber(source_number: Optional[str], new_prefix: str) -> Optional[str]:
    """Carry a document's numeric id across conversions (EST-29500 -> SO-29500 -> INV-29500)."""
    if source_number and "-" in str(source_number):
        return f"{new_prefix}-{str(source_number).split('-', 1)[1]}"
    return None



def _apply_doc_margin(row: dict) -> dict:
    """Derive doc-level material_margin from line items so list rows are always accurate."""
    items = row.get("line_items") or []
    revenue = round(sum(float(li.get("line_total") or 0) for li in items), 2)
    margin = round(sum(float(li.get("material_margin") or 0) for li in items), 2)
    row["material_margin"] = margin
    row["material_margin_pct"] = round(margin / revenue * 100, 1) if revenue else 0.0
    row["has_cost_data"] = any("cost_per_sqft" in li for li in items)
    return row


async def next_number(prefix: str, key: str, collection, start: int = 1) -> str:
    ctr = await db.counters.find_one({"_id": key})
    if not ctr:
        base = start - 1
        cursor = collection.find({"number": {"$regex": f"^{prefix}-"}}, {"number": 1})
        async for d in cursor:
            try:
                base = max(base, int(str(d["number"]).split("-")[1]))
            except (IndexError, ValueError):
                pass
        await db.counters.insert_one({"_id": key, "seq": base})
    elif int(ctr.get("seq", 0)) < start - 1:
        await db.counters.update_one({"_id": key}, {"$set": {"seq": start - 1}})
    r = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER
    )
    return f"{prefix}-{r['seq']:04d}"


async def next_po_number() -> str:
    if not await db.counters.find_one({"_id": "PO"}):
        base = 1599  # so the first PO is PO-1600
        cursor = db.purchase_orders.find({"number": {"$regex": "^PO-"}}, {"number": 1})
        async for d in cursor:
            try:
                base = max(base, int(str(d["number"]).split("-")[1]))
            except (IndexError, ValueError):
                pass
        await db.counters.insert_one({"_id": "PO", "seq": base})
    r = await db.counters.find_one_and_update(
        {"_id": "PO"}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER
    )
    return f"PO-{r['seq']:04d}"


async def get_or_404(collection, id_str: str, name: str = "Resource") -> dict:
    doc = await collection.find_one({"_id": oid(id_str)})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{name} not found")
    return doc


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(payload: RegisterInput, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "company": payload.company,
        "phone": payload.phone,
        "role": "customer",
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    # auto-create a linked customer record
    await db.customers.insert_one({
        "name": payload.name, "company": payload.company, "email": email,
        "phone": payload.phone, "address": None, "notes": None,
        "user_id": uid, "portal_enabled": True, "net_terms": "Net 15",
        "created_at": now_iso(),
    })
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": payload.name, "role": "customer"}


@api_router.post("/auth/login")
async def login(payload: LoginInput, response: Response, request: Request):
    email = payload.email.lower()
    identifier = email
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    if user.get("suspended"):
        raise HTTPException(status_code=403, detail="Your portal access has been suspended. Please contact DBG Signs.")
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user.get("name"), "role": user.get("role"),
            "must_change_password": bool(user.get("must_change_password"))}


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePasswordInput, user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not u or not verify_password(payload.current_password or "", u.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    if len(payload.new_password or "") < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    if verify_password(payload.new_password, u.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="New password must be different from the current one")
    await db.users.update_one({"_id": u["_id"]}, {"$set": {"password_hash": hash_password(payload.new_password)},
                                                  "$unset": {"must_change_password": ""}})
    return {"message": "Password updated"}


@api_router.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api_router.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(str(user["_id"]), user["email"])
        response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=3600, path="/")
        return {"message": "refreshed"}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
@api_router.get("/customers")
async def list_customers(user: dict = Depends(require_worker)):
    docs = await db.customers.find().to_list(2000)
    docs.sort(key=lambda d: (d.get("company") or d.get("name") or "").strip().lower())
    return [clean(d) for d in docs]


@api_router.post("/customers")
async def create_customer(payload: CustomerInput, user: dict = Depends(require_worker)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    res = await db.customers.insert_one(doc)
    return clean(await db.customers.find_one({"_id": res.inserted_id}))


class CustomerImportInput(BaseModel):
    csv: str


@api_router.post("/customers/import")
async def import_customers(payload: CustomerImportInput, user: dict = Depends(require_worker)):
    import csv as _csv
    text = (payload.csv or "").lstrip("\ufeff")
    if not text.strip():
        raise HTTPException(status_code=400, detail="The CSV file is empty")
    try:
        reader = _csv.DictReader(io.StringIO(text))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse the CSV file")
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    created, skipped, errors = 0, 0, []
    valid_terms = {"COD", "50/50", "Net 10", "Net 15", "Net 30", "Net 45", "Net 60"}
    for i, raw in enumerate(reader, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k is not None}
        name = r.get("name") or r.get("contact") or r.get("contact name") or ""
        company = r.get("company") or r.get("company name") or ""
        if not name and not company:
            skipped += 1
            errors.append(f"Row {i}: missing both name and company")
            continue
        name = name or company
        tier_raw = r.get("tier") or ""
        tier = int(tier_raw) if tier_raw.isdigit() and int(tier_raw) in (1, 2, 3) else None
        terms = r.get("net_terms") or r.get("terms") or "Net 15"
        if terms not in valid_terms:
            terms = "Net 15"
        email = (r.get("email") or "").lower() or None
        if email and await db.customers.find_one({"email": email}):
            skipped += 1
            errors.append(f"Row {i}: a customer with email {email} already exists")
            continue
        await db.customers.insert_one({
            "name": name, "company": company or None, "email": email,
            "phone": r.get("phone") or None, "address": r.get("address") or None,
            "notes": r.get("notes") or None, "title": r.get("title") or None,
            "tier": tier, "net_terms": terms, "portal_enabled": False, "created_at": now_iso(),
        })
        created += 1
    return {"created": created, "skipped": skipped, "errors": errors[:25]}


class BulkDeleteInput(BaseModel):
    ids: List[str] = []
    password: str


@api_router.post("/customers/bulk-delete")
async def bulk_delete_customers(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    id_list = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not id_list:
        raise HTTPException(status_code=400, detail="No customers selected")
    res = await db.customers.delete_many({"_id": {"$in": [oid(i) for i in id_list]}})
    await db.contacts.delete_many({"customer_id": {"$in": id_list}})
    return {"deleted": res.deleted_count}


@api_router.post("/estimates/bulk-delete")
async def bulk_delete_estimates(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No estimates selected")
    res = await db.estimates.delete_many({"_id": {"$in": [oid(i) for i in ids]}})
    return {"deleted": res.deleted_count}


@api_router.post("/sales-orders/bulk-delete")
async def bulk_delete_sales_orders(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No sales orders selected")
    sos = await db.sales_orders.find({"_id": {"$in": [oid(i) for i in ids]}}).to_list(1000)
    est_ids = [oid(s["estimate_id"]) for s in sos if s.get("estimate_id") and ObjectId.is_valid(s["estimate_id"])]
    if est_ids:
        await db.estimates.update_many({"_id": {"$in": est_ids}}, {"$set": {"status": "sent"}, "$unset": {"sales_order_id": ""}})
    res = await db.sales_orders.delete_many({"_id": {"$in": [oid(i) for i in ids]}})
    return {"deleted": res.deleted_count}


@api_router.post("/invoices/bulk-delete")
async def bulk_delete_invoices(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No invoices selected")
    res = await db.invoices.delete_many({"_id": {"$in": [oid(i) for i in ids]}})
    return {"deleted": res.deleted_count}


@api_router.post("/reorders/bulk-delete")
async def bulk_delete_reorders(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No reorders selected")
    res = await db.reorders.delete_many({"_id": {"$in": [oid(i) for i in ids]}})
    return {"deleted": res.deleted_count}


@api_router.post("/contacts/import")
async def import_contacts(payload: CustomerImportInput, user: dict = Depends(require_worker)):
    import csv as _csv
    text = (payload.csv or "").lstrip("\ufeff")
    if not text.strip():
        raise HTTPException(status_code=400, detail="The CSV file is empty")
    reader = _csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    created, skipped, errors = 0, 0, []
    for i, raw in enumerate(reader, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k is not None}
        name = r.get("name") or r.get("contact") or r.get("contact name") or ""
        company = r.get("customer") or r.get("company") or r.get("company name") or ""
        if not name:
            skipped += 1; errors.append(f"Row {i}: missing contact name"); continue
        if not company:
            skipped += 1; errors.append(f"Row {i}: missing customer/company to attach '{name}' to"); continue
        cust = await db.customers.find_one({"company": {"$regex": f"^{re.escape(company)}$", "$options": "i"}})
        if not cust:
            cust = await db.customers.find_one({"name": {"$regex": f"^{re.escape(company)}$", "$options": "i"}})
        if not cust:
            skipped += 1; errors.append(f"Row {i}: no customer matching '{company}'"); continue
        await db.contacts.insert_one({
            "customer_id": str(cust["_id"]), "name": name,
            "email": (r.get("email") or "").lower() or None,
            "phone": r.get("phone") or None, "title": r.get("title") or None,
            "created_at": now_iso(),
        })
        created += 1
    return {"created": created, "skipped": skipped, "errors": errors[:25]}


@api_router.put("/customers/{cid}")
async def update_customer(cid: str, payload: CustomerInput, user: dict = Depends(require_staff)):
    await get_or_404(db.customers, cid, "Customer")
    await db.customers.update_one({"_id": oid(cid)}, {"$set": payload.model_dump()})
    return clean(await db.customers.find_one({"_id": oid(cid)}))


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.customers.delete_one({"_id": oid(cid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.contacts.delete_many({"customer_id": cid})
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Customer contacts (multiple people per company; optional portal logins)
# ---------------------------------------------------------------------------
async def _contact_out(d: dict) -> dict:
    d = clean(d)
    d["has_portal"] = bool(await db.users.find_one({"contact_id": d["id"]}))
    return d


@api_router.get("/customers/{cid}/contacts")
async def list_contacts(cid: str, user: dict = Depends(require_worker)):
    docs = await db.contacts.find({"customer_id": cid}).sort("created_at", 1).to_list(500)
    return [await _contact_out(d) for d in docs]


@api_router.post("/customers/{cid}/contacts")
async def create_contact(cid: str, payload: ContactInput, user: dict = Depends(require_worker)):
    await get_or_404(db.customers, cid, "Customer")
    doc = payload.model_dump()
    doc["customer_id"] = cid
    doc["created_at"] = now_iso()
    res = await db.contacts.insert_one(doc)
    return await _contact_out(await db.contacts.find_one({"_id": res.inserted_id}))


@api_router.put("/contacts/{ctid}")
async def update_contact(ctid: str, payload: ContactInput, user: dict = Depends(require_staff)):
    await get_or_404(db.contacts, ctid, "Contact")
    await db.contacts.update_one({"_id": oid(ctid)}, {"$set": payload.model_dump()})
    await db.users.update_one({"contact_id": ctid}, {"$set": {"name": payload.name}})
    return await _contact_out(await db.contacts.find_one({"_id": oid(ctid)}))


@api_router.delete("/contacts/{ctid}")
async def delete_contact(ctid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.contacts.delete_one({"_id": oid(ctid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.users.delete_many({"contact_id": ctid})
    return {"message": "deleted"}


@api_router.post("/contacts/{ctid}/portal")
async def enable_contact_portal(ctid: str, payload: ContactPortalInput, user: dict = Depends(require_admin)):
    ct = await get_or_404(db.contacts, ctid, "Contact")
    if not ct.get("email"):
        raise HTTPException(status_code=400, detail="Add an email to this contact first")
    email = ct["email"].lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="That email already has a login")
    res = await db.users.insert_one({
        "email": email, "password_hash": hash_password(payload.password), "name": ct.get("name"),
        "role": "customer", "suspended": False, "customer_id": ct["customer_id"], "contact_id": ctid,
        "created_at": now_iso(),
    })
    await db.customers.update_one({"_id": oid(ct["customer_id"])}, {"$set": {"portal_enabled": True}})
    return {"id": str(res.inserted_id), "email": email}


@api_router.delete("/contacts/{ctid}/portal")
async def disable_contact_portal(ctid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    await db.users.delete_many({"contact_id": ctid})
    return {"message": "portal disabled"}


# ---------------------------------------------------------------------------
# Work orders (service / installer daily logs)
# ---------------------------------------------------------------------------
async def enrich_work_order(d: dict) -> dict:
    d = clean(d)
    if d.get("customer_name"):
        return d
    if d.get("customer_id"):
        c = await db.customers.find_one({"_id": oid(d["customer_id"])})
        d["customer_name"] = (c.get("company") or c.get("name")) if c else None
    return d


@api_router.get("/installers")
async def list_installers(user: dict = Depends(require_worker)):
    docs = await db.users.find({"role": {"$in": ["installer", "admin"]}}).sort("name", 1).to_list(1000)
    return [{"id": str(d["_id"]), "name": d.get("name"), "role": d.get("role")} for d in docs]


async def _resolve_worker(payload: WorkOrderInput, fallback: dict) -> tuple:
    """Return (worker_id, worker_name) from the selected installer, or the fallback user."""
    if payload.worker_id and ObjectId.is_valid(payload.worker_id):
        u = await db.users.find_one({"_id": oid(payload.worker_id)})
        if u:
            return str(u["_id"]), u.get("name")
    return fallback.get("id"), fallback.get("name")


@api_router.get("/work-orders")
async def list_work_orders(user: dict = Depends(require_worker)):
    q = {} if user["role"] == "admin" else {"worker_id": user["id"]}
    docs = await db.work_orders.find(q).sort("created_at", -1).to_list(2000)
    return [await enrich_work_order(d) for d in docs]


@api_router.post("/work-orders")
async def create_work_order(payload: WorkOrderInput, user: dict = Depends(require_worker)):
    doc = payload.model_dump()
    doc.pop("worker_id", None)
    doc["worker_id"], doc["worker_name"] = await _resolve_worker(payload, user)
    doc["number"] = await next_number("WO", "work_orders", db.work_orders)
    doc["created_at"] = now_iso()
    res = await db.work_orders.insert_one(doc)
    return await enrich_work_order(await db.work_orders.find_one({"_id": res.inserted_id}))


@api_router.put("/work-orders/{wid}")
async def update_work_order(wid: str, payload: WorkOrderInput, user: dict = Depends(require_worker)):
    wo = await get_or_404(db.work_orders, wid, "Work order")
    if user["role"] != "admin" and wo.get("worker_id") != user["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own work orders")
    doc = payload.model_dump()
    doc.pop("worker_id", None)
    doc["worker_id"], doc["worker_name"] = await _resolve_worker(payload, {"id": wo.get("worker_id"), "name": wo.get("worker_name")})
    await db.work_orders.update_one({"_id": oid(wid)}, {"$set": doc})
    return await enrich_work_order(await db.work_orders.find_one({"_id": oid(wid)}))


@api_router.delete("/work-orders/{wid}")
async def delete_work_order(wid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    await get_or_404(db.work_orders, wid, "Work order")
    await db.work_orders.delete_one({"_id": oid(wid)})
    return {"message": "deleted"}


@api_router.post("/work-orders/bulk-delete")
async def bulk_delete_work_orders(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No work orders selected")
    res = await db.work_orders.delete_many({"_id": {"$in": [oid(i) for i in ids]}})
    return {"deleted": res.deleted_count}


@api_router.get("/work-orders/{wid}/pdf")
async def work_order_pdf(wid: str, user: dict = Depends(require_worker)):
    wo = await get_or_404(db.work_orders, wid, "Work order")
    if user["role"] != "admin" and wo.get("worker_id") != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own work orders")
    pdf = build_work_order_pdf(clean(wo), await get_settings(), await get_logo_bytes())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{wo.get("number", "work-order")}.pdf"'})


# ---------------------------------------------------------------------------
# Time clock (installers + salesmen clock in/out; admins manage everyone)
# ---------------------------------------------------------------------------
class TimeEntryInput(BaseModel):
    user_id: str
    clock_in: str
    clock_out: Optional[str] = None
    commission_note: Optional[str] = ""


class TimeEntryEdit(BaseModel):
    clock_in: Optional[str] = None
    clock_out: Optional[str] = None
    commission_note: Optional[str] = None


def _entry_hours(clock_in: Optional[str], clock_out: Optional[str]) -> Optional[float]:
    if not clock_in or not clock_out:
        return None
    try:
        a = datetime.fromisoformat(str(clock_in).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(clock_out).replace("Z", "+00:00"))
        return round(max(0.0, (b - a).total_seconds() / 3600.0), 2)
    except ValueError:
        return None


def time_entry_out(d: dict) -> dict:
    return {
        "id": str(d["_id"]), "user_id": d.get("user_id"), "user_name": d.get("user_name"),
        "user_role": d.get("user_role"), "clock_in": d.get("clock_in"), "clock_out": d.get("clock_out"),
        "date": d.get("date"), "hours": _entry_hours(d.get("clock_in"), d.get("clock_out")),
        "commission_note": d.get("commission_note") or "", "manual": bool(d.get("manual")),
    }


@api_router.get("/timeclock/status")
async def timeclock_status(user: dict = Depends(get_current_user)):
    open_entry = await db.time_entries.find_one({"user_id": user["id"], "clock_out": None})
    return {"clocked_in": bool(open_entry), "entry": time_entry_out(open_entry) if open_entry else None}


@api_router.post("/timeclock/clock-in")
async def timeclock_clock_in(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("installer", "salesman"):
        raise HTTPException(status_code=403, detail="Only installers and salesmen can clock in")
    existing = await db.time_entries.find_one({"user_id": user["id"], "clock_out": None})
    if existing:
        raise HTTPException(status_code=400, detail="You are already clocked in")
    now = now_iso()
    doc = {"user_id": user["id"], "user_name": user.get("name"), "user_role": user.get("role"),
           "clock_in": now, "clock_out": None, "date": now[:10], "commission_note": "", "manual": False,
           "created_at": now}
    res = await db.time_entries.insert_one(doc)
    return time_entry_out(await db.time_entries.find_one({"_id": res.inserted_id}))


@api_router.post("/timeclock/clock-out")
async def timeclock_clock_out(user: dict = Depends(get_current_user)):
    entry = await db.time_entries.find_one({"user_id": user["id"], "clock_out": None})
    if not entry:
        raise HTTPException(status_code=400, detail="You are not clocked in")
    await db.time_entries.update_one({"_id": entry["_id"]}, {"$set": {"clock_out": now_iso()}})
    return time_entry_out(await db.time_entries.find_one({"_id": entry["_id"]}))


@api_router.get("/timeclock/entries")
async def timeclock_entries(user_id: Optional[str] = None, start: Optional[str] = None,
                            end: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {}
    if user.get("role") == "admin":
        if user_id:
            q["user_id"] = user_id
    else:
        q["user_id"] = user["id"]
    if start:
        q["date"] = {"$gte": start}
    if end:
        q.setdefault("date", {})["$lte"] = end
    docs = await db.time_entries.find(q).sort("clock_in", -1).to_list(5000)
    return [time_entry_out(d) for d in docs]


@api_router.post("/timeclock/entries")
async def timeclock_add_entry(payload: TimeEntryInput, user: dict = Depends(require_admin)):
    u = await db.users.find_one({"_id": oid(payload.user_id)})
    if not u:
        raise HTTPException(status_code=404, detail="Team member not found")
    doc = {"user_id": str(u["_id"]), "user_name": u.get("name"), "user_role": u.get("role"),
           "clock_in": payload.clock_in, "clock_out": payload.clock_out, "date": str(payload.clock_in)[:10],
           "commission_note": payload.commission_note or "", "manual": True, "created_at": now_iso()}
    res = await db.time_entries.insert_one(doc)
    return time_entry_out(await db.time_entries.find_one({"_id": res.inserted_id}))


@api_router.put("/timeclock/entries/{eid}")
async def timeclock_edit_entry(eid: str, payload: TimeEntryEdit, user: dict = Depends(require_admin)):
    entry = await get_or_404(db.time_entries, eid, "Time entry")
    upd = {}
    if payload.clock_in is not None:
        upd["clock_in"] = payload.clock_in; upd["date"] = str(payload.clock_in)[:10]
    if payload.clock_out is not None:
        upd["clock_out"] = payload.clock_out or None
    if payload.commission_note is not None:
        upd["commission_note"] = payload.commission_note
    await db.time_entries.update_one({"_id": oid(eid)}, {"$set": upd})
    return time_entry_out(await db.time_entries.find_one({"_id": oid(eid)}))


@api_router.delete("/timeclock/entries/{eid}")
async def timeclock_delete_entry(eid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    await get_or_404(db.time_entries, eid, "Time entry")
    await db.time_entries.delete_one({"_id": oid(eid)})
    return {"message": "deleted"}


@api_router.get("/timeclock/export")
async def timeclock_export(start: Optional[str] = None, end: Optional[str] = None,
                           user_id: Optional[str] = None, user: dict = Depends(require_admin)):
    q: dict = {}
    if user_id:
        q["user_id"] = user_id
    if start:
        q["date"] = {"$gte": start}
    if end:
        q.setdefault("date", {})["$lte"] = end
    docs = await db.time_entries.find(q).sort("clock_in", 1).to_list(10000)
    rows = [["Employee", "Role", "Date", "Clock in", "Clock out", "Hours", "Commission note"]]
    for d in docs:
        e = time_entry_out(d)
        rows.append([e["user_name"] or "", e["user_role"] or "", e["date"] or "",
                     str(e["clock_in"] or "")[:19].replace("T", " "), str(e["clock_out"] or "")[:19].replace("T", " "),
                     "" if e["hours"] is None else f'{e["hours"]:.2f}', e["commission_note"]])
    return csv_response(rows, "timeclock.csv")


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
@api_router.get("/materials")
async def list_materials(user: dict = Depends(require_staff)):
    docs = await db.materials.find().sort("name", 1).to_list(1000)
    return [material_out(d) for d in docs]


@api_router.post("/materials")
async def create_material(payload: MaterialInput, user: dict = Depends(require_admin)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    res = await db.materials.insert_one(doc)
    return material_out(await db.materials.find_one({"_id": res.inserted_id}))


@api_router.put("/materials/{mid}")
async def update_material(mid: str, payload: MaterialInput, user: dict = Depends(require_admin)):
    await get_or_404(db.materials, mid, "Material")
    await db.materials.update_one({"_id": oid(mid)}, {"$set": payload.model_dump()})
    return material_out(await db.materials.find_one({"_id": oid(mid)}))


@api_router.delete("/materials/{mid}")
async def delete_material(mid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.materials.delete_one({"_id": oid(mid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Material not found")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Material categories (presets + admin-managed custom)
# ---------------------------------------------------------------------------
class CategoryInput(BaseModel):
    name: str


@api_router.get("/material-categories")
async def list_categories(user: dict = Depends(require_staff)):
    custom = await db.material_categories.find().sort("name", 1).to_list(500)
    return {
        "presets": PRESET_CATEGORIES,
        "custom": [{"id": str(c["_id"]), "name": c["name"]} for c in custom],
        "all": PRESET_CATEGORIES + [c["name"] for c in custom],
    }


@api_router.post("/material-categories")
async def create_category(payload: CategoryInput, user: dict = Depends(require_admin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    existing_lower = {c.lower() for c in PRESET_CATEGORIES}
    async for c in db.material_categories.find():
        existing_lower.add(c["name"].lower())
    if name.lower() in existing_lower:
        raise HTTPException(status_code=400, detail="That category already exists")
    res = await db.material_categories.insert_one({"name": name, "created_at": now_iso()})
    return {"id": str(res.inserted_id), "name": name}


@api_router.put("/material-categories/{cid}")
async def update_category(cid: str, payload: CategoryInput, user: dict = Depends(require_admin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    cat = await get_or_404(db.material_categories, cid, "Category")
    existing_lower = {c.lower() for c in PRESET_CATEGORIES}
    async for c in db.material_categories.find({"_id": {"$ne": oid(cid)}}):
        existing_lower.add(c["name"].lower())
    if name.lower() in existing_lower:
        raise HTTPException(status_code=400, detail="That category already exists")
    old = cat["name"]
    await db.material_categories.update_one({"_id": oid(cid)}, {"$set": {"name": name}})
    if old != name:
        await db.materials.update_many({"category": old}, {"$set": {"category": name}})
    return {"id": cid, "name": name}


@api_router.delete("/material-categories/{cid}")
async def delete_category(cid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.material_categories.delete_one({"_id": oid(cid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Shop settings (global rates) - admin only
# ---------------------------------------------------------------------------
@api_router.get("/settings")
async def read_settings(user: dict = Depends(require_staff)):
    return await get_settings()


@api_router.put("/settings")
async def write_settings(payload: SettingsInput, user: dict = Depends(require_admin)):
    await db.settings.update_one({"key": "shop"}, {"$set": payload.model_dump()}, upsert=True)
    return await get_settings()


@api_router.post("/settings/logo")
async def upload_logo(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 5MB")
    await db.settings.update_one({"key": "shop"}, {"$set": {
        "logo_b64": base64.b64encode(data).decode(), "logo_mime": file.content_type,
    }}, upsert=True)
    return {"status": "uploaded", "has_custom_logo": True}


@api_router.delete("/settings/logo")
async def reset_logo(user: dict = Depends(require_admin)):
    await db.settings.update_one({"key": "shop"}, {"$unset": {"logo_b64": "", "logo_mime": ""}})
    return {"status": "reset", "has_custom_logo": False}


@api_router.get("/pub/logo")
async def public_logo():
    s = await db.settings.find_one({"key": "shop"})
    mime = (s or {}).get("logo_mime") or "image/jpeg"
    return Response(content=await get_logo_bytes(), media_type=mime, headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------
async def enrich_customer(doc: dict) -> dict:
    cust = await db.customers.find_one({"_id": ObjectId(doc["customer_id"])}) if doc.get("customer_id") else None
    doc["customer_name"] = cust.get("company") or cust.get("name") if cust else "Unknown"
    if doc.get("contact_id") and ObjectId.is_valid(doc["contact_id"]):
        ct = await db.contacts.find_one({"_id": ObjectId(doc["contact_id"])})
        doc["contact_name"] = ct.get("name") if ct else None
        doc["contact_email"] = ct.get("email") if ct else None
    return doc


async def _attach_contact_name(doc: dict) -> dict:
    if doc.get("contact_id") and ObjectId.is_valid(str(doc["contact_id"])):
        ct = await db.contacts.find_one({"_id": ObjectId(doc["contact_id"])})
        if ct:
            doc["contact_name"] = ct.get("name")
    return doc


@api_router.get("/estimates")
async def list_estimates(user: dict = Depends(require_staff)):
    docs = await db.estimates.find().sort("created_at", -1).to_list(1000)
    return [_apply_doc_margin(await enrich_customer(clean(d))) for d in docs]


async def apply_commission(doc: dict, user: dict) -> dict:
    if user["role"] == "salesman":
        doc["salesman_id"] = user["id"]
        doc["salesman_name"] = user.get("name")
    elif doc.get("salesman_id"):
        su = await db.users.find_one({"_id": oid(doc["salesman_id"])})
        if su:
            doc["salesman_name"] = su.get("name")
    rate = float(doc.get("commission_rate") or 0)
    if rate == 0 and doc.get("salesman_id"):
        su = await db.users.find_one({"_id": oid(doc["salesman_id"])})
        if su:
            rate = float(su.get("commission_rate") or 0)
    # Commission base = gross profit = sale − material cost − shop − machine.
    # Labor & machine are billed at cost, so this equals the sum of material margins.
    # Installation lines are excluded — installation labor does not earn sales commission.
    base = 0.0
    for li in doc.get("line_items", []):
        if str(li.get("category") or "").strip().lower() == "installation":
            continue
        base += float(li.get("material_margin") or 0)
    base = round(base, 2)
    doc["commission_rate"] = rate
    doc["commission_base"] = base
    doc["commission_amount"] = round(base * rate / 100.0, 2)
    return doc


@api_router.post("/estimates")
async def create_estimate(payload: EstimateInput, user: dict = Depends(require_staff)):
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await apply_commission(doc, user)
    doc["number"] = await next_number("EST", "estimates", db.estimates, start=29500)
    doc["created_at"] = now_iso()
    res = await db.estimates.insert_one(doc)
    return await enrich_customer(clean(await db.estimates.find_one({"_id": res.inserted_id})))


@api_router.put("/estimates/{eid}")
async def update_estimate(eid: str, payload: EstimateInput, user: dict = Depends(require_staff)):
    existing = await get_or_404(db.estimates, eid, "Estimate")
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await apply_commission(doc, user)
    # don't let an edit desync an already-approved estimate from its sales order
    if existing.get("sales_order_id"):
        doc["status"] = existing.get("status", "approved")
        doc["sales_order_id"] = existing["sales_order_id"]
    await db.estimates.update_one({"_id": oid(eid)}, {"$set": doc})
    return await enrich_customer(clean(await db.estimates.find_one({"_id": oid(eid)})))


@api_router.delete("/estimates/{eid}")
async def delete_estimate(eid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.estimates.delete_one({"_id": oid(eid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"message": "deleted"}


@api_router.post("/estimates/{eid}/approve")
async def approve_estimate(eid: str, user: dict = Depends(require_staff)):
    est = await get_or_404(db.estimates, eid, "Estimate")
    if est.get("sales_order_id"):
        raise HTTPException(status_code=400, detail="Estimate already approved into a sales order")
    doc = {
        "customer_id": est["customer_id"],
        "contact_id": est.get("contact_id"),
        "title": est["title"],
        "customer_po": est.get("customer_po"),
        "tax_exempt": est.get("tax_exempt", False),
        "tax_exempt_number": est.get("tax_exempt_number"),
        "line_items": est.get("line_items", []),
        "tax_rate": est.get("tax_rate", 0),
        "subtotal": est.get("subtotal", 0),
        "discount_rate": est.get("discount_rate", 0),
        "discount_amount": est.get("discount_amount", 0),
        "tax_amount": est.get("tax_amount", 0),
        "total": est.get("total", 0),
        "notes": est.get("notes"),
        "commission_rate": est.get("commission_rate", 0),
        "commission_amount": est.get("commission_amount", 0),
        "salesman_id": est.get("salesman_id"),
        "salesman_name": est.get("salesman_name"),
        "status": "open",  # open / in_production / fulfilled
        "number": renumber(est.get("number"), "SO") or await next_number("SO", "sales_orders", db.sales_orders, start=29500),
        "from_estimate": est.get("number"),
        "estimate_id": str(est["_id"]),
        "order_date": est.get("order_date"),
        "due_date": est.get("due_date"),
        "created_at": now_iso(),
    }
    res = await db.sales_orders.insert_one(doc)
    await db.estimates.update_one({"_id": oid(eid)}, {"$set": {"status": "approved", "sales_order_id": str(res.inserted_id)}})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": res.inserted_id})))


# ---------------------------------------------------------------------------
# Sales Orders
# ---------------------------------------------------------------------------
@api_router.get("/sales-orders")
async def list_sales_orders(user: dict = Depends(require_staff)):
    docs = await db.sales_orders.find().sort("created_at", -1).to_list(1000)
    return [_apply_doc_margin(await enrich_customer(clean(d))) for d in docs]


_SO_STATUSES = ("open", "in_production", "fulfilled")


@api_router.post("/sales-orders")
async def create_sales_order(payload: EstimateInput, user: dict = Depends(require_staff)):
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await apply_commission(doc, user)
    doc["status"] = payload.status if payload.status in _SO_STATUSES else "open"
    doc["number"] = await next_number("SO", "sales_orders", db.sales_orders, start=29500)
    doc["created_at"] = now_iso()
    res = await db.sales_orders.insert_one(doc)
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": res.inserted_id})))


@api_router.put("/sales-orders/{sid}")
async def update_sales_order(sid: str, payload: EstimateInput, user: dict = Depends(require_staff)):
    existing = await get_or_404(db.sales_orders, sid, "Sales order")
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await apply_commission(doc, user)
    doc["status"] = payload.status if payload.status in _SO_STATUSES else existing.get("status", "open")
    for k in ("estimate_id", "from_estimate", "invoice_id"):
        if existing.get(k):
            doc[k] = existing[k]
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": doc})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": oid(sid)})))


@api_router.patch("/sales-orders/{sid}/status")
async def set_so_status(sid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("open", "in_production", "fulfilled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.sales_orders, sid, "Sales order")
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": {"status": status}})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": oid(sid)})))


@api_router.patch("/sales-orders/{sid}/void")
async def void_sales_order(sid: str, voided: bool, user: dict = Depends(require_admin)):
    await get_or_404(db.sales_orders, sid, "Sales order")
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": {"voided": voided}})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": oid(sid)})))


@api_router.delete("/sales-orders/{sid}")
async def delete_sales_order(sid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    so = await get_or_404(db.sales_orders, sid, "Sales order")
    if so.get("estimate_id"):
        await db.estimates.update_one({"_id": oid(so["estimate_id"])}, {"$set": {"status": "sent"}, "$unset": {"sales_order_id": ""}})
    await db.sales_orders.delete_one({"_id": oid(sid)})
    return {"message": "deleted"}


@api_router.post("/sales-orders/{sid}/convert")
async def convert_sales_order(sid: str, user: dict = Depends(require_staff)):
    so = await get_or_404(db.sales_orders, sid, "Sales order")
    if so.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Sales order already invoiced")
    doc = {
        "customer_id": so["customer_id"],
        "contact_id": so.get("contact_id"),
        "title": so["title"],
        "customer_po": so.get("customer_po"),
        "tax_exempt": so.get("tax_exempt", False),
        "tax_exempt_number": so.get("tax_exempt_number"),
        "order_date": so.get("order_date"),
        "line_items": so.get("line_items", []),
        "tax_rate": so.get("tax_rate", 0),
        "subtotal": so.get("subtotal", 0),
        "discount_rate": so.get("discount_rate", 0),
        "discount_amount": so.get("discount_amount", 0),
        "tax_amount": so.get("tax_amount", 0),
        "total": so.get("total", 0),
        "notes": so.get("notes"),
        "commission_rate": so.get("commission_rate", 0),
        "commission_amount": so.get("commission_amount", 0),
        "salesman_id": so.get("salesman_id"),
        "salesman_name": so.get("salesman_name"),
        "status": "unpaid",
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat(),
        "number": renumber(so.get("number"), "INV") or await next_number("INV", "invoices", db.invoices, start=29500),
        "from_sales_order": so.get("number"),
        "sales_order_id": str(so["_id"]),
        "created_at": now_iso(),
    }
    res = await db.invoices.insert_one(doc)
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": {"status": "fulfilled", "invoice_id": str(res.inserted_id)}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": res.inserted_id})))


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------
@api_router.get("/invoices")
async def list_invoices(user: dict = Depends(require_staff)):
    docs = await db.invoices.find().sort("created_at", -1).to_list(1000)
    out = []
    for d in docs:
        row = await enrich_customer(clean(d))
        _apply_doc_margin(row)
        if row.get("status") == "paid":
            rec = await db.payment_transactions.find_one(
                {"payment_status": "paid", "$or": [{"invoice_id": row["id"]}, {"allocations.invoice_id": row["id"]}]},
                sort=[("updated_at", -1)])
            if rec:
                if not row.get("paid_at"):
                    row["paid_at"] = rec.get("updated_at") or rec.get("created_at")
                row["payment_notes"] = rec.get("notes")
                method = rec.get("method") or "Card (Stripe)"
                if rec.get("reference"):
                    method = f"{method} #{rec['reference']}"
                row["payment_method"] = method
            else:
                row["payment_method"] = row.get("paid_via") or row.get("last_payment_method")
        out.append(row)
    return out


@api_router.post("/invoices")
async def create_invoice(payload: InvoiceInput, user: dict = Depends(require_staff)):
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    doc["number"] = await next_number("INV", "invoices", db.invoices, start=29500)
    doc["created_at"] = now_iso()
    res = await db.invoices.insert_one(doc)
    return await enrich_customer(clean(await db.invoices.find_one({"_id": res.inserted_id})))


@api_router.put("/invoices/{iid}")
async def update_invoice(iid: str, payload: InvoiceInput, user: dict = Depends(require_staff)):
    await get_or_404(db.invoices, iid, "Invoice")
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": doc})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


_DUP_STRIP = {
    "_id", "id", "number", "created_at", "updated_at",
    "email_status", "email_to", "email_sent_at", "email_opened_at", "email_token", "email_id",
    "sales_order_id", "estimate_id", "invoice_id", "converted_invoice_id", "from_estimate",
    "paid_at", "amount_paid", "balance_due", "payments", "stripe_payment_intent_id", "stripe_session_id",
    "commission_po", "commission_po_number", "commission_paid_at", "commission_paid",
    "voided", "voided_at", "voided_by", "voided_reason", "fulfilled_at",
    "customer_name", "salesman_name", "contact_name", "internal_notes",
}


async def _duplicate_document(collection, source_id: str, kind: str, prefix: str, counter_key: str, status: str):
    src = await get_or_404(collection, source_id, kind)
    doc = {k: v for k, v in src.items() if k not in _DUP_STRIP}
    doc["title"] = ((src.get("title") or "").strip() + " (Copy)").strip()
    doc["status"] = status
    doc["number"] = await next_number(prefix, counter_key, collection, start=29500)
    doc["created_at"] = now_iso()
    res = await collection.insert_one(doc)
    return await enrich_customer(clean(await collection.find_one({"_id": res.inserted_id})))


@api_router.post("/estimates/{eid}/duplicate")
async def duplicate_estimate(eid: str, user: dict = Depends(require_staff)):
    return await _duplicate_document(db.estimates, eid, "Estimate", "EST", "estimates", "draft")


@api_router.post("/sales-orders/{sid}/duplicate")
async def duplicate_sales_order(sid: str, user: dict = Depends(require_staff)):
    return await _duplicate_document(db.sales_orders, sid, "Sales order", "SO", "sales_orders", "open")


@api_router.post("/invoices/{iid}/duplicate")
async def duplicate_invoice(iid: str, user: dict = Depends(require_staff)):
    return await _duplicate_document(db.invoices, iid, "Invoice", "INV", "invoices", "unpaid")


class InternalNotesInput(BaseModel):
    notes: Optional[str] = None


@api_router.patch("/invoices/{iid}/internal-notes")
async def set_invoice_internal_notes(iid: str, payload: InternalNotesInput, user: dict = Depends(require_admin)):
    await get_or_404(db.invoices, iid, "Invoice")
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": {"internal_notes": (payload.notes or "").strip() or None}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.patch("/estimates/{eid}/internal-notes")
async def set_estimate_internal_notes(eid: str, payload: InternalNotesInput, user: dict = Depends(require_admin)):
    await get_or_404(db.estimates, eid, "Estimate")
    await db.estimates.update_one({"_id": oid(eid)}, {"$set": {"internal_notes": (payload.notes or "").strip() or None}})
    return await enrich_customer(clean(await db.estimates.find_one({"_id": oid(eid)})))


@api_router.patch("/sales-orders/{sid}/internal-notes")
async def set_so_internal_notes(sid: str, payload: InternalNotesInput, user: dict = Depends(require_admin)):
    await get_or_404(db.sales_orders, sid, "Sales order")
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": {"internal_notes": (payload.notes or "").strip() or None}})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": oid(sid)})))


@api_router.get("/invoices/{iid}/lineage")
async def invoice_lineage(iid: str, user: dict = Depends(require_staff)):
    inv = await get_or_404(db.invoices, iid, "Invoice")
    out = {
        "invoice": {"number": inv.get("number"), "id": iid, "status": inv.get("status"),
                    "created_at": inv.get("created_at"), "paid_at": inv.get("paid_at")},
        "sales_order": None, "estimate": None,
    }
    so = None
    if inv.get("sales_order_id") and ObjectId.is_valid(inv["sales_order_id"]):
        so = await db.sales_orders.find_one({"_id": oid(inv["sales_order_id"])})
    if so:
        out["sales_order"] = {"number": so.get("number"), "id": str(so["_id"]),
                              "status": so.get("status"), "created_at": so.get("created_at")}
        if so.get("estimate_id") and ObjectId.is_valid(so["estimate_id"]):
            est = await db.estimates.find_one({"_id": oid(so["estimate_id"])})
            if est:
                out["estimate"] = {"number": est.get("number"), "id": str(est["_id"]),
                                   "status": est.get("status"), "created_at": est.get("created_at")}
    return out


@api_router.post("/invoices/{iid}/commission-po")
async def generate_commission_po(iid: str, user: dict = Depends(require_admin)):
    inv = await get_or_404(db.invoices, iid, "Invoice")
    amount = float(inv.get("commission_amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="This invoice has no commission to generate a PO for")
    existing = await db.purchase_orders.find_one({"invoice_id": iid})
    if existing:
        raise HTTPException(status_code=400, detail=f"A PO already exists for this invoice ({existing.get('number')})")
    inv = await enrich_customer(clean(inv))
    number = await next_po_number()
    doc = {
        "number": number, "invoice_id": iid, "invoice_number": inv.get("number"),
        "salesman_id": inv.get("salesman_id"), "salesman_name": inv.get("salesman_name") or "Unassigned",
        "customer_name": inv.get("customer_name"), "commission_amount": round(amount, 2),
        "commission_rate": float(inv.get("commission_rate") or 0),
        "created_at": now_iso(), "created_by": user.get("name"),
    }
    res = await db.purchase_orders.insert_one(doc)
    return clean(await db.purchase_orders.find_one({"_id": res.inserted_id}))


@api_router.get("/purchase-orders")
async def list_purchase_orders(user: dict = Depends(require_admin)):
    docs = await db.purchase_orders.find().sort("created_at", -1).to_list(2000)
    return [clean(d) for d in docs]


@api_router.get("/purchase-orders/{pid}/pdf")
async def purchase_order_pdf(pid: str, inline: bool = False, user: dict = Depends(require_admin)):
    po = await get_or_404(db.purchase_orders, pid, "Purchase order")
    pdf = build_po_pdf(clean(po), await get_settings(), await get_logo_bytes())
    disp = "inline" if inline else "attachment"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disp}; filename="{po.get("number")}.pdf"', "Cache-Control": "no-store"})


@api_router.delete("/purchase-orders/{pid}")
async def delete_purchase_order(pid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.purchase_orders.delete_one({"_id": oid(pid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return {"message": "deleted"}


class POUpdate(BaseModel):
    number: Optional[str] = None
    salesman_name: Optional[str] = None
    customer_name: Optional[str] = None
    invoice_number: Optional[str] = None
    commission_amount: Optional[float] = None
    commission_rate: Optional[float] = None
    notes: Optional[str] = None
    date: Optional[str] = None


@api_router.patch("/purchase-orders/{pid}")
async def update_purchase_order(pid: str, payload: POUpdate, user: dict = Depends(require_admin)):
    await get_or_404(db.purchase_orders, pid, "Purchase order")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "commission_amount" in update:
        update["commission_amount"] = round(float(update["commission_amount"]), 2)
    if update:
        await db.purchase_orders.update_one({"_id": oid(pid)}, {"$set": update})
    return clean(await db.purchase_orders.find_one({"_id": oid(pid)}))


@api_router.post("/purchase-orders/{pid}/email")
async def email_purchase_order(pid: str, user: dict = Depends(require_admin)):
    po = await get_or_404(db.purchase_orders, pid, "Purchase order")
    su = None
    if po.get("salesman_id") and ObjectId.is_valid(po["salesman_id"]):
        su = await db.users.find_one({"_id": oid(po["salesman_id"])})
    if not su and po.get("salesman_name"):
        su = await db.users.find_one({"name": po["salesman_name"], "role": {"$in": ["salesman", "admin"]}})
    if not su or not su.get("email"):
        raise HTTPException(status_code=400, detail="No email on file for this salesman")
    token = secrets.token_urlsafe(16)
    await db.po_pdf_tokens.insert_one({"token": token, "po_id": pid, "created_at": now_iso()})
    link = f"{PUBLIC_BASE_URL}/api/pub/po/{token}"
    html = render_po_email(su.get("name") or "there", po.get("number"), float(po.get("commission_amount") or 0),
                           po.get("invoice_number"), link, await get_settings())
    await send_email(to=su["email"], subject=f"Purchase Order {po.get('number')} · DBG Signs, Inc.", html=html)
    return {"sent": True, "to": su["email"]}


@api_router.get("/pub/po/{token}")
async def public_po_pdf(token: str):
    rec = await db.po_pdf_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Link is invalid or has expired")
    po = await db.purchase_orders.find_one({"_id": oid(rec["po_id"])})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    pdf = build_po_pdf(clean(po), await get_settings(), await get_logo_bytes())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{po.get("number")}.pdf"', "Cache-Control": "no-store"})


async def _invoice_pdf_link(iid: str) -> str:
    """Mint a tokenized first-party link to download an invoice PDF (used in emails,
    since the managed email provider does not support file attachments)."""
    token = secrets.token_urlsafe(24)
    await db.invoice_pdf_tokens.insert_one({"token": token, "invoice_id": str(iid), "created_at": now_iso()})
    return f"{PUBLIC_BASE_URL}/api/pub/invoice-pdf/{token}"


@api_router.get("/pub/invoice-pdf/{token}")
async def public_invoice_pdf(token: str):
    rec = await db.invoice_pdf_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Link is invalid or has expired")
    try:
        created = datetime.fromisoformat(str(rec.get("created_at")).replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - created).days > 90:
            raise HTTPException(status_code=404, detail="This link has expired")
    except (ValueError, TypeError):
        pass
    inv = await db.invoices.find_one({"_id": oid(rec["invoice_id"])})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    cust = await db.customers.find_one({"_id": oid(inv["customer_id"])}) if inv.get("customer_id") else None
    s = await get_settings()
    pdf = build_doc_pdf("Invoice", clean(inv), clean(cust) if cust else None, await get_logo_bytes(), s)
    date_str = (str(inv.get("paid_at"))[:10] if inv.get("paid_at") else now_iso()[:10])
    fname = f"{date_str}.{inv.get('number', 'invoice')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"', "Cache-Control": "no-store"})




@api_router.patch("/invoices/{iid}/status")
async def set_invoice_status(iid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("unpaid", "partial", "paid", "overdue"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.invoices, iid, "Invoice")
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": {"status": status, "paid_at": now_iso() if status == "paid" else None}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.patch("/invoices/{iid}/void")
async def void_invoice(iid: str, voided: bool, user: dict = Depends(require_admin)):
    await get_or_404(db.invoices, iid, "Invoice")
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": {"voided": voided}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.delete("/invoices/{iid}")
async def delete_invoice(iid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.invoices.delete_one({"_id": oid(iid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Stripe payments (embedded card / PaymentIntent)
# ---------------------------------------------------------------------------
class PayIntentInput(BaseModel):
    invoice_id: str
    amount: Optional[float] = None


async def _invoice_for_payment(invoice_id: str, user: dict) -> dict:
    inv = await get_or_404(db.invoices, invoice_id, "Invoice")
    if user.get("role") == "customer":
        cust = await current_customer(user)
        if not cust or str(cust["_id"]) != inv.get("customer_id"):
            raise HTTPException(status_code=403, detail="You are not allowed to pay this invoice.")
    return inv


async def _apply_amount_to_invoice(invoice_id: str, amount: float) -> None:
    inv = await db.invoices.find_one({"_id": oid(invoice_id)})
    if not inv:
        return
    total = float(inv.get("total") or 0)
    paid = round(float(inv.get("amount_paid") or 0) + float(amount or 0), 2)
    fully = paid >= total - 0.005
    upd = {"amount_paid": paid, "status": "paid" if fully else "partial"}
    if fully:
        upd["paid_at"] = now_iso()
        upd["paid_via"] = "stripe"
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": upd})
    try:
        await _send_payment_receipt({**inv, **upd}, float(amount or 0))
    except Exception as e:  # never let a receipt failure break payment
        logger.error(f"Payment receipt email failed: {e}")


async def _apply_amount_to_so(so_id: str, amount: float) -> None:
    so = await db.sales_orders.find_one({"_id": oid(so_id)})
    if not so:
        return
    total = float(so.get("total") or 0)
    paid = round(float(so.get("amount_paid") or 0) + float(amount or 0), 2)
    fully = paid >= total - 0.005
    upd = {"amount_paid": paid, "payment_status": "paid" if fully else "partial"}
    if fully:
        upd["paid_at"] = now_iso()
        upd["paid_via"] = "stripe"
    await db.sales_orders.update_one({"_id": so["_id"]}, {"$set": upd})


async def _apply_payment(payment_intent_id: str) -> None:
    # Idempotent: only the first flip pending->paid applies the amount(s)
    res = await db.payment_transactions.update_one(
        {"payment_intent_id": payment_intent_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}},
    )
    if res.modified_count != 1:
        return
    rec = await db.payment_transactions.find_one({"payment_intent_id": payment_intent_id})
    allocations = rec.get("allocations")
    if allocations:
        for a in allocations:
            await _apply_amount_to_invoice(a["invoice_id"], a["amount"])
    elif rec.get("collection") == "sales_orders" and rec.get("doc_id"):
        await _apply_amount_to_so(rec["doc_id"], rec.get("amount"))
    elif rec.get("invoice_id"):
        await _apply_amount_to_invoice(rec["invoice_id"], rec.get("amount"))


@api_router.post("/payments/create-intent")
async def create_payment_intent(payload: PayIntentInput, user: dict = Depends(get_current_user)):
    inv = await _invoice_for_payment(payload.invoice_id, user)
    if inv.get("voided"):
        raise HTTPException(status_code=400, detail="This invoice has been voided.")
    total = float(inv.get("total") or 0)
    balance = round(total - float(inv.get("amount_paid") or 0), 2)
    if inv.get("status") == "paid" or balance <= 0:
        raise HTTPException(status_code=400, detail="This invoice is already paid in full.")
    amount = round(float(payload.amount), 2) if payload.amount is not None else balance
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    if amount > balance + 0.005:
        raise HTTPException(status_code=400, detail=f"Payment can't exceed the balance due of ${balance:,.2f}.")
    s = await get_settings()
    surcharge = round(amount * float(s.get("card_surcharge_pct") or 0) / 100.0, 2) if s.get("card_surcharge_enabled") else 0.0
    charged = round(amount + surcharge, 2)
    intent = stripe.PaymentIntent.create(
        amount=int(round(charged * 100)),
        currency="usd",
        payment_method_types=["card"],
        description=f"Invoice {inv.get('number', '')} - DBG Signs, Inc.",
        metadata={"invoice_id": str(inv["_id"]), "invoice_number": inv.get("number", "")},
    )
    await db.payment_transactions.insert_one({
        "payment_intent_id": intent.id, "invoice_id": str(inv["_id"]),
        "invoice_number": inv.get("number"), "amount": amount, "surcharge": surcharge, "charged": charged,
        "currency": "usd", "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"client_secret": intent.client_secret, "publishable_key": STRIPE_PUBLISHABLE_KEY,
            "amount": amount, "balance": balance, "surcharge": surcharge, "charged": charged}


@api_router.post("/payments/create-intent-all")
async def create_payment_intent_all(user: dict = Depends(get_current_user)):
    if user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Pay-all is available to portal customers only.")
    cust = await current_customer(user)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    cid = str(cust["_id"])
    invs = await db.invoices.find({"customer_id": cid, "voided": {"$ne": True}, "status": {"$ne": "paid"}}).to_list(1000)
    allocations, total = [], 0.0
    for inv in invs:
        bal = round(float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0), 2)
        if bal > 0:
            allocations.append({"invoice_id": str(inv["_id"]), "amount": bal})
            total = round(total + bal, 2)
    if total <= 0:
        raise HTTPException(status_code=400, detail="You have no outstanding balance.")
    s = await get_settings()
    surcharge = round(total * float(s.get("card_surcharge_pct") or 0) / 100.0, 2) if s.get("card_surcharge_enabled") else 0.0
    charged = round(total + surcharge, 2)
    intent = stripe.PaymentIntent.create(
        amount=int(round(charged * 100)), currency="usd", payment_method_types=["card"],
        description="Pay all outstanding invoices - DBG Signs, Inc.",
        metadata={"customer_id": cid, "bulk": "true", "invoices": str(len(allocations))},
    )
    await db.payment_transactions.insert_one({
        "payment_intent_id": intent.id, "invoice_id": None, "allocations": allocations,
        "amount": total, "surcharge": surcharge, "charged": charged,
        "currency": "usd", "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"client_secret": intent.client_secret, "publishable_key": STRIPE_PUBLISHABLE_KEY,
            "amount": total, "count": len(allocations), "surcharge": surcharge, "charged": charged}


class PaySelectedInput(BaseModel):
    invoice_ids: List[str] = []


@api_router.post("/payments/create-intent-selected")
async def create_payment_intent_selected(payload: PaySelectedInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Selecting invoices to pay is available to portal customers only.")
    cust = await current_customer(user)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    cid = str(cust["_id"])
    ids = [i for i in payload.invoice_ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="No invoices selected.")
    invs = await db.invoices.find({"_id": {"$in": [ObjectId(i) for i in ids]}, "customer_id": cid, "voided": {"$ne": True}}).to_list(1000)
    allocations, total = [], 0.0
    for inv in invs:
        bal = round(float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0), 2)
        if bal > 0:
            allocations.append({"invoice_id": str(inv["_id"]), "amount": bal})
            total = round(total + bal, 2)
    if total <= 0:
        raise HTTPException(status_code=400, detail="The selected invoices have no outstanding balance.")
    s = await get_settings()
    surcharge = round(total * float(s.get("card_surcharge_pct") or 0) / 100.0, 2) if s.get("card_surcharge_enabled") else 0.0
    charged = round(total + surcharge, 2)
    intent = stripe.PaymentIntent.create(
        amount=int(round(charged * 100)), currency="usd", payment_method_types=["card"],
        description="Pay selected invoices - DBG Signs, Inc.",
        metadata={"customer_id": cid, "bulk": "true", "invoices": str(len(allocations))},
    )
    await db.payment_transactions.insert_one({
        "payment_intent_id": intent.id, "invoice_id": None, "allocations": allocations,
        "amount": total, "surcharge": surcharge, "charged": charged,
        "currency": "usd", "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"client_secret": intent.client_secret, "publishable_key": STRIPE_PUBLISHABLE_KEY,
            "amount": total, "count": len(allocations), "surcharge": surcharge, "charged": charged}


@api_router.get("/invoices/{iid}/payments")
async def invoice_payments(iid: str, user: dict = Depends(get_current_user)):
    await _invoice_for_payment(iid, user)  # enforces customer-owns-invoice
    out = []
    recs = await db.payment_transactions.find({"payment_status": "paid"}).sort("updated_at", -1).to_list(2000)
    for rec in recs:
        when = rec.get("updated_at") or rec.get("created_at")
        method = rec.get("method") or "Card (Stripe)"
        if rec.get("reference"):
            method = f"{method} #{rec['reference']}"
        if rec.get("invoice_id") == iid:
            out.append({"amount": rec.get("amount"), "date": when, "method": method, "notes": rec.get("notes")})
        for a in (rec.get("allocations") or []):
            if a.get("invoice_id") == iid:
                out.append({"amount": a.get("amount"), "date": when, "method": method, "notes": rec.get("notes")})
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out


class ManualPaymentInput(BaseModel):
    amount: Optional[float] = None
    method: str = "Check"  # Check, ACH, Wire, Cash, Card, Other
    reference: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None


@api_router.post("/invoices/{iid}/manual-payment")
async def record_manual_payment(iid: str, payload: ManualPaymentInput, user: dict = Depends(require_staff)):
    inv = await get_or_404(db.invoices, iid, "Invoice")
    if inv.get("voided"):
        raise HTTPException(status_code=400, detail="This invoice has been voided.")
    total = float(inv.get("total") or 0)
    balance = round(total - float(inv.get("amount_paid") or 0), 2)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="This invoice is already paid in full.")
    amount = round(float(payload.amount), 2) if payload.amount is not None else balance
    if amount <= 0 or amount > balance + 0.005:
        raise HTTPException(status_code=400, detail=f"Payment must be between $0 and the balance of ${balance:,.2f}.")
    when = payload.date or now_iso()
    await db.payment_transactions.insert_one({
        "payment_intent_id": None, "invoice_id": iid, "invoice_number": inv.get("number"),
        "amount": amount, "method": payload.method, "reference": (payload.reference or "").strip() or None,
        "notes": (payload.notes or "").strip() or None,
        "manual": True, "recorded_by": user.get("name"), "currency": "usd",
        "status": "completed", "payment_status": "paid", "created_at": when, "updated_at": when,
    })
    new_paid = round(float(inv.get("amount_paid") or 0) + amount, 2)
    fully = new_paid >= total - 0.005
    upd = {"amount_paid": new_paid, "status": "paid" if fully else "partial",
           "last_payment_method": payload.method, "last_payment_reference": (payload.reference or "").strip() or None}
    if fully:
        upd["paid_at"] = when
        upd["paid_via"] = payload.method
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": upd})
    fresh = await db.invoices.find_one({"_id": oid(iid)})
    try:
        await _send_payment_receipt(fresh, amount)
    except Exception as e:
        logger.error(f"Manual payment receipt email failed: {e}")
    return await enrich_customer(clean(fresh))


@api_router.get("/payments/status/{payment_intent_id}")
async def payment_status(payment_intent_id: str, user: dict = Depends(get_current_user)):
    rec = await db.payment_transactions.find_one({"payment_intent_id": payment_intent_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Payment not found")
    if rec.get("payment_status") != "paid":
        try:
            pi = stripe.PaymentIntent.retrieve(payment_intent_id)
            if pi.status == "succeeded":
                await _apply_payment(payment_intent_id)
                rec = await db.payment_transactions.find_one({"payment_intent_id": payment_intent_id})
        except stripe.error.StripeError as e:
            logger.error(f"Stripe status retrieve failed for {payment_intent_id}: {e}")
    return {"payment_intent_id": payment_intent_id, "status": rec["status"], "payment_status": rec["payment_status"]}


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid signature")
    obj, t = event["data"]["object"], event["type"]
    if t == "payment_intent.succeeded":
        rec = await db.payment_transactions.find_one({"payment_intent_id": obj["id"]})
        if rec:
            await _apply_payment(obj["id"])
    elif t == "payment_intent.payment_failed":
        await db.payment_transactions.update_one(
            {"payment_intent_id": obj["id"]},
            {"$set": {"status": "failed", "payment_status": "failed", "updated_at": now_iso()}},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Public (no-login) card payment via secure email link
# ---------------------------------------------------------------------------
class PubPayInput(BaseModel):
    amount: Optional[float] = None


async def _pub_doc_from_token(token: str):
    tr = await db.email_tracking.find_one({"token": token})
    if not tr:
        raise HTTPException(status_code=404, detail="This payment link is invalid or has expired.")
    coll = tr.get("collection")
    doc_id = tr.get("doc_id")
    if coll == "invoices":
        doc = await db.invoices.find_one({"_id": oid(doc_id)})
    elif coll == "sales_orders":
        doc = await db.sales_orders.find_one({"_id": oid(doc_id)})
    else:
        raise HTTPException(status_code=400, detail="This link is not payable.")
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return coll, doc


@api_router.get("/reports/salespeople")
async def salespeople_report(start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(require_admin)):
    now = datetime.now(timezone.utc)
    # Default range: current year to date
    try:
        start_dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc) if start else datetime(now.year, 1, 1, tzinfo=timezone.utc)
    except ValueError:
        start_dt = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    try:
        end_dt = (datetime.fromisoformat(end).replace(tzinfo=timezone.utc) + timedelta(days=1)) if end else None
    except ValueError:
        end_dt = None
    agg: dict = {}

    def _row(name):
        return agg.setdefault(name, {
            "salesman_name": name, "invoice_count": 0,
            "ytd_sales": 0.0, "ytd_collected": 0.0, "ytd_commission": 0.0,
            "prev_year_sales": 0.0,
        })

    async for inv in db.invoices.find({"voided": {"$ne": True}}):
        raw = inv.get("created_at") or inv.get("issued_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt < start_dt or (end_dt and dt >= end_dt):
            continue
        name = inv.get("salesman_name") or "Unassigned"
        r = _row(name)
        r["invoice_count"] += 1
        r["ytd_sales"] += float(inv.get("total") or 0)
        r["ytd_collected"] += float(inv.get("amount_paid") or 0)
        r["ytd_commission"] += float(inv.get("commission_amount") or 0)

    rows = []
    for r in agg.values():
        for kk in ("ytd_sales", "ytd_collected", "ytd_commission", "prev_year_sales"):
            r[kk] = round(r[kk], 2)
        rows.append(r)
    rows.sort(key=lambda x: x["ytd_sales"], reverse=True)
    totals = {
        "sales": round(sum(r["ytd_sales"] for r in rows), 2),
        "collected": round(sum(r["ytd_collected"] for r in rows), 2),
        "commission": round(sum(r["ytd_commission"] for r in rows), 2),
        "invoice_count": sum(r["invoice_count"] for r in rows),
    }
    period_label = f"{start_dt.date()} → {(end_dt - timedelta(days=1)).date()}" if end_dt else f"{start_dt.date()} → {now.date()}"
    return {"salespeople": rows, "totals": totals, "period_label": period_label,
            "start": start_dt.date().isoformat(), "end": (end_dt - timedelta(days=1)).date().isoformat() if end_dt else now.date().isoformat()}


@api_router.get("/reports/sales")
async def sales_report(user: dict = Depends(require_admin)):
    now = datetime.now(timezone.utc)
    cy, py = now.year, now.year - 1
    cur = [0.0] * 12
    prev = [0.0] * 12
    cur_paid = [0.0] * 12
    cur_cnt = [0] * 12
    async for inv in db.invoices.find({"voided": {"$ne": True}}):
        raw = inv.get("created_at") or inv.get("issued_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        total = float(inv.get("total") or 0)
        paid = float(inv.get("amount_paid") or 0)
        m = dt.month - 1
        if dt.year == cy:
            cur[m] += total
            cur_paid[m] += paid
            cur_cnt[m] += 1
        elif dt.year == py:
            prev[m] += total
    rnd = lambda arr: [round(x, 2) for x in arr]
    mi = now.month - 1
    ytd = round(sum(cur[: mi + 1]), 2)
    prev_ytd = round(sum(prev[: mi + 1]), 2)
    prev_full = round(sum(prev), 2)
    this_month = round(cur[mi], 2)
    last_month = round(cur[mi - 1], 2) if mi > 0 else round(prev[11], 2)
    this_month_ly = round(prev[mi], 2)
    pct = lambda a, b: round((a - b) / b * 100, 1) if b else (100.0 if a else 0.0)
    return {
        "year": cy, "prev_year": py,
        "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        "current_year_sales": rnd(cur), "prev_year_sales": rnd(prev), "current_year_paid": rnd(cur_paid),
        "current_year_counts": cur_cnt,
        "kpis": {
            "this_month_label": now.strftime("%b %Y"),
            "ytd": ytd, "prev_ytd": prev_ytd, "ytd_change_pct": pct(ytd, prev_ytd),
            "prev_year_full": prev_full, "current_year_total": round(sum(cur), 2),
            "this_month": this_month, "last_month": last_month, "mom_change_pct": pct(this_month, last_month),
            "this_month_ly": this_month_ly, "yoy_month_change_pct": pct(this_month, this_month_ly),
            "invoice_count_ytd": sum(cur_cnt[: mi + 1]),
        },
    }


@api_router.get("/pub/pay/{token}")
async def pub_pay_info(token: str):
    coll, doc = await _pub_doc_from_token(token)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
    total = float(doc.get("total") or 0)
    balance = round(total - float(doc.get("amount_paid") or 0), 2)
    s = await get_settings()
    return {
        "kind": "Invoice" if coll == "invoices" else "Sales Order",
        "number": doc.get("number"), "customer_name": cname,
        "total": total, "amount_paid": float(doc.get("amount_paid") or 0), "balance": balance,
        "voided": bool(doc.get("voided")),
        "paid": doc.get("status") == "paid" or doc.get("payment_status") == "paid" or balance <= 0,
        "company_name": s.get("company_name") or "DBG Signs, Inc.",
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
    }


@api_router.post("/pub/pay/{token}/intent")
async def pub_pay_intent(token: str, payload: PubPayInput = PubPayInput()):
    coll, doc = await _pub_doc_from_token(token)
    if doc.get("voided"):
        raise HTTPException(status_code=400, detail="This document has been voided.")
    total = float(doc.get("total") or 0)
    balance = round(total - float(doc.get("amount_paid") or 0), 2)
    if doc.get("status") == "paid" or doc.get("payment_status") == "paid" or balance <= 0:
        raise HTTPException(status_code=400, detail="This is already paid in full.")
    amount = round(float(payload.amount), 2) if payload.amount is not None else balance
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    if amount > balance + 0.005:
        raise HTTPException(status_code=400, detail=f"Payment can't exceed the balance due of ${balance:,.2f}.")
    s = await get_settings()
    surcharge = round(amount * float(s.get("card_surcharge_pct") or 0) / 100.0, 2) if s.get("card_surcharge_enabled") else 0.0
    charged = round(amount + surcharge, 2)
    label = "Invoice" if coll == "invoices" else "Sales Order"
    intent = stripe.PaymentIntent.create(
        amount=int(round(charged * 100)), currency="usd", payment_method_types=["card"],
        description=f"{label} {doc.get('number', '')} - DBG Signs, Inc.",
        metadata={"collection": coll, "doc_id": str(doc["_id"]), "number": doc.get("number", "")},
    )
    await db.payment_transactions.insert_one({
        "payment_intent_id": intent.id, "collection": coll, "doc_id": str(doc["_id"]),
        "invoice_id": str(doc["_id"]) if coll == "invoices" else None,
        "invoice_number": doc.get("number"), "amount": amount, "surcharge": surcharge, "charged": charged,
        "currency": "usd", "status": "initiated", "payment_status": "pending", "public": True,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"client_secret": intent.client_secret, "publishable_key": STRIPE_PUBLISHABLE_KEY,
            "amount": amount, "balance": balance, "surcharge": surcharge, "charged": charged}


@api_router.get("/pub/pay/status/{payment_intent_id}")
async def pub_payment_status(payment_intent_id: str):
    rec = await db.payment_transactions.find_one({"payment_intent_id": payment_intent_id, "public": True})
    if not rec:
        raise HTTPException(status_code=404, detail="Payment not found")
    if rec.get("payment_status") != "paid":
        try:
            pi = stripe.PaymentIntent.retrieve(payment_intent_id)
            if pi.status == "succeeded":
                await _apply_payment(payment_intent_id)
                rec = await db.payment_transactions.find_one({"payment_intent_id": payment_intent_id})
        except stripe.error.StripeError as e:
            logger.error(f"pub status retrieve failed for {payment_intent_id}: {e}")
    return {"payment_status": rec["payment_status"]}


# ---------------------------------------------------------------------------
# Bills (Accounts Payable)
# ---------------------------------------------------------------------------
@api_router.get("/bills")
async def list_bills(user: dict = Depends(require_admin)):
    docs = await db.bills.find().sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@api_router.post("/bills")
async def create_bill(payload: BillInput, user: dict = Depends(require_admin)):
    doc = payload.model_dump()
    doc["number"] = await next_number("BILL", "bills", db.bills)
    doc["created_at"] = now_iso()
    res = await db.bills.insert_one(doc)
    return clean(await db.bills.find_one({"_id": res.inserted_id}))


@api_router.put("/bills/{bid}")
async def update_bill(bid: str, payload: BillInput, user: dict = Depends(require_admin)):
    await get_or_404(db.bills, bid, "Bill")
    await db.bills.update_one({"_id": oid(bid)}, {"$set": payload.model_dump()})
    return clean(await db.bills.find_one({"_id": oid(bid)}))


@api_router.patch("/bills/{bid}/status")
async def set_bill_status(bid: str, status: str, user: dict = Depends(require_admin)):
    if status not in ("unpaid", "paid"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.bills, bid, "Bill")
    await db.bills.update_one({"_id": oid(bid)}, {"$set": {"status": status, "paid_at": now_iso() if status == "paid" else None}})
    return clean(await db.bills.find_one({"_id": oid(bid)}))


@api_router.delete("/bills/{bid}")
async def delete_bill(bid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.bills.delete_one({"_id": oid(bid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bill not found")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Staff / Users (admin only) + Commissions
# ---------------------------------------------------------------------------
def user_out(u: dict) -> dict:
    d = clean(u)
    d.pop("password_hash", None)
    return d


@api_router.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    docs = await db.users.find({"role": {"$in": ["admin", "salesman", "installer"]}}).sort("name", 1).to_list(1000)
    return [user_out(d) for d in docs]


@api_router.post("/users")
async def create_user(payload: StaffInput, user: dict = Depends(require_admin)):
    email = payload.email.lower()
    if payload.role not in ("admin", "salesman", "installer"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password required")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "commission_rate": float(payload.commission_rate or 0),
        "must_change_password": True,
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    try:
        await _send_welcome_email(name=payload.name, email=email, temp_password=payload.password, role=payload.role)
    except Exception as e:  # never block account creation on email failure
        logger.error(f"Welcome email failed for {email}: {e}")
    return user_out(await db.users.find_one({"_id": res.inserted_id}))


@api_router.put("/users/{uid}")
async def update_user(uid: str, payload: StaffInput, user: dict = Depends(require_admin)):
    await get_or_404(db.users, uid, "User")
    update = {"name": payload.name, "role": payload.role, "commission_rate": float(payload.commission_rate or 0)}
    if payload.password:
        update["password_hash"] = hash_password(payload.password)
        if uid != user["id"]:
            update["must_change_password"] = True
    await db.users.update_one({"_id": oid(uid)}, {"$set": update})
    return user_out(await db.users.find_one({"_id": oid(uid)}))


@api_router.delete("/users/{uid}")
async def delete_user(uid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    res = await db.users.delete_one({"_id": oid(uid), "role": {"$in": ["admin", "salesman", "installer"]}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "deleted"}


@api_router.post("/users/bulk-delete")
async def bulk_delete_users(payload: BulkDeleteInput, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    ids = [i for i in payload.ids if ObjectId.is_valid(i) and i != user["id"]]
    if not ids:
        raise HTTPException(status_code=400, detail="No team members selected")
    res = await db.users.delete_many({"_id": {"$in": [oid(i) for i in ids]}, "role": {"$in": ["admin", "salesman", "installer"]}})
    return {"deleted": res.deleted_count}


# ---------------------------------------------------------------------------
# Customer portal accounts (admin: add / suspend / delete)
# ---------------------------------------------------------------------------
class PortalAccountInput(BaseModel):
    name: str
    email: EmailStr
    password: str
    company: Optional[str] = None
    phone: Optional[str] = None
    tier: Optional[int] = None
    net_terms: Optional[str] = "Net 15"


async def _portal_account_out(u: dict) -> dict:
    uid = str(u["_id"])
    cust = await db.customers.find_one({"user_id": uid}) or await db.customers.find_one({"email": u.get("email")})
    return {
        "id": uid, "name": u.get("name"), "email": u.get("email"),
        "company": u.get("company"), "phone": u.get("phone"),
        "suspended": bool(u.get("suspended")), "created_at": u.get("created_at"),
        "customer_id": str(cust["_id"]) if cust else None,
        "portal_enabled": bool(cust.get("portal_enabled")) if cust else False,
        "tier": (cust or {}).get("tier"), "net_terms": (cust or {}).get("net_terms"),
    }


@api_router.get("/portal-accounts")
async def list_portal_accounts(user: dict = Depends(require_admin)):
    docs = await db.users.find({"role": "customer"}).sort("created_at", -1).to_list(2000)
    return [await _portal_account_out(d) for d in docs]


@api_router.post("/portal-accounts")
async def create_portal_account(payload: PortalAccountInput, user: dict = Depends(require_admin)):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    ures = await db.users.insert_one({
        "email": email, "password_hash": hash_password(payload.password),
        "name": payload.name, "company": payload.company, "phone": payload.phone,
        "role": "customer", "suspended": False, "created_at": now_iso(),
    })
    uid = str(ures.inserted_id)
    existing = await db.customers.find_one({"email": email})
    if existing:
        await db.customers.update_one({"_id": existing["_id"]}, {"$set": {"user_id": uid, "portal_enabled": True}})
    else:
        await db.customers.insert_one({
            "name": payload.name, "company": payload.company, "email": email, "phone": payload.phone,
            "address": None, "notes": None, "user_id": uid, "portal_enabled": True,
            "tier": payload.tier, "net_terms": payload.net_terms or "Net 15", "created_at": now_iso(),
        })
    return await _portal_account_out(await db.users.find_one({"_id": ures.inserted_id}))


@api_router.patch("/portal-accounts/{uid}/status")
async def set_portal_account_status(uid: str, suspended: bool, user: dict = Depends(require_admin)):
    u = await db.users.find_one({"_id": oid(uid), "role": "customer"})
    if not u:
        raise HTTPException(status_code=404, detail="Portal account not found")
    await db.users.update_one({"_id": u["_id"]}, {"$set": {"suspended": suspended}})
    await db.customers.update_one({"user_id": uid}, {"$set": {"portal_enabled": not suspended}})
    return await _portal_account_out(await db.users.find_one({"_id": u["_id"]}))


@api_router.delete("/portal-accounts/{uid}")
async def delete_portal_account(uid: str, payload: DeleteConfirm, user: dict = Depends(require_admin)):
    await verify_admin_password(user, payload.password)
    res = await db.users.delete_one({"_id": oid(uid), "role": "customer"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Portal account not found")
    # keep the business/customer record, just disable portal + unlink login
    await db.customers.update_one({"user_id": uid}, {"$set": {"portal_enabled": False}, "$unset": {"user_id": ""}})
    return {"message": "deleted"}


@api_router.get("/commissions")
async def commissions(user: dict = Depends(require_staff)):
    q = {}
    if user["role"] == "salesman":
        q = {"salesman_id": user["id"]}
    ests = await db.estimates.find(q).sort("created_at", -1).to_list(2000)
    rows = []
    by_salesman = {}
    total_pending = 0.0
    total_earned = 0.0
    total_paid = 0.0
    for e in ests:
        e = await enrich_customer(clean(e))
        base = float(e.get("commission_base") if e.get("commission_base") is not None else (e.get("subtotal") or 0))
        rate = float(e.get("commission_rate") or 0)
        amt = float(e.get("commission_amount") or round(base * rate / 100.0, 2))
        earned = e.get("status") == "approved" or bool(e.get("sales_order_id"))
        paid = bool(e.get("commission_paid"))
        name = e.get("salesman_name") or "Unassigned"
        sid = e.get("salesman_id")
        rows.append({
            "id": e["id"], "number": e.get("number"), "title": e.get("title"),
            "customer_name": e.get("customer_name"), "salesman_name": name,
            "status": e.get("status"), "base": round(base, 2), "commission_rate": rate,
            "commission_amount": round(amt, 2), "earned": earned,
            "paid": paid, "po_number": e.get("commission_po"), "paid_at": e.get("commission_paid_at"),
        })
        agg = by_salesman.setdefault(name, {"salesman_name": name, "salesman_id": None, "earned": 0.0, "pending": 0.0, "paid": 0.0, "count": 0})
        if sid and not agg["salesman_id"]:
            agg["salesman_id"] = sid
        agg["count"] += 1
        if paid:
            agg["paid"] += amt
            total_paid += amt
        elif earned:
            agg["earned"] += amt
            total_earned += amt
        else:
            agg["pending"] += amt
            total_pending += amt
    for a in by_salesman.values():
        a["earned"] = round(a["earned"], 2)
        a["pending"] = round(a["pending"], 2)
        a["paid"] = round(a["paid"], 2)
    return {
        "rows": rows,
        "by_salesman": sorted(by_salesman.values(), key=lambda x: x["earned"] + x["pending"] + x["paid"], reverse=True),
        "total_earned": round(total_earned, 2),
        "total_pending": round(total_pending, 2),
        "total_paid": round(total_paid, 2),
    }


class CommissionPayItem(BaseModel):
    estimate_id: str
    po_number: str = ""


class CommissionPayInput(BaseModel):
    items: List[CommissionPayItem] = []


class CommissionUnpayInput(BaseModel):
    estimate_ids: List[str] = []


@api_router.post("/commissions/pay")
async def pay_commissions(payload: CommissionPayInput, user: dict = Depends(require_admin)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Select at least one commission")
    if any(not (it.po_number or "").strip() for it in payload.items):
        raise HTTPException(status_code=400, detail="A PO number is required for every selected commission")
    when = now_iso()
    updated = 0
    for it in payload.items:
        if not ObjectId.is_valid(it.estimate_id):
            continue
        res = await db.estimates.update_one(
            {"_id": oid(it.estimate_id)},
            {"$set": {"commission_paid": True, "commission_po": it.po_number.strip(), "commission_paid_at": when}},
        )
        updated += res.modified_count
    return {"updated": updated}


@api_router.post("/commissions/unpay")
async def unpay_commissions(payload: CommissionUnpayInput, user: dict = Depends(require_admin)):
    ids = [oid(i) for i in payload.estimate_ids if ObjectId.is_valid(i)]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one commission")
    res = await db.estimates.update_many(
        {"_id": {"$in": ids}},
        {"$unset": {"commission_paid": "", "commission_po": "", "commission_paid_at": ""}},
    )
    return {"updated": res.modified_count}


async def _paid_commission_rows(salesman_name: Optional[str], salesman_id: Optional[str],
                                date_from: Optional[str], date_to: Optional[str]) -> list:
    q = {"commission_paid": True}
    if salesman_id and salesman_name and salesman_name != "Unassigned":
        q["$or"] = [{"salesman_id": salesman_id}, {"salesman_name": salesman_name}]
    elif salesman_id:
        q["salesman_id"] = salesman_id
    elif salesman_name and salesman_name != "Unassigned":
        q["salesman_name"] = salesman_name
    elif salesman_name == "Unassigned":
        q["$or"] = [{"salesman_name": None}, {"salesman_name": ""}, {"salesman_name": {"$exists": False}}]
    ests = await db.estimates.find(q).sort("commission_paid_at", -1).to_list(5000)
    rows = []
    for e in ests:
        pa = (e.get("commission_paid_at") or "")[:10]
        if date_from and pa and pa < date_from:
            continue
        if date_to and pa and pa > date_to:
            continue
        e = await enrich_customer(clean(e))
        base = float(e.get("commission_base") if e.get("commission_base") is not None else (e.get("subtotal") or 0))
        rate = float(e.get("commission_rate") or 0)
        rows.append({
            "number": e.get("number"), "customer_name": e.get("customer_name"),
            "salesman_name": e.get("salesman_name") or "Unassigned",
            "po_number": e.get("commission_po"), "paid_at": e.get("commission_paid_at"),
            "commission_amount": float(e.get("commission_amount") or round(base * rate / 100.0, 2)),
        })
    return rows


def _scope_label(base_label: str, date_from: Optional[str], date_to: Optional[str]) -> str:
    if date_from or date_to:
        rng = f"{date_from or '…'} → {date_to or '…'}"
        return f"{base_label} · {rng}" if base_label else rng
    return base_label


def render_po_email(name: str, number: str, amount: float, invoice_number: Optional[str], link: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    inv_line = f" for Invoice {escape(str(invoice_number))}" if invoice_number else ""
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">PURCHASE ORDER</div>'
        f'<div style="color:#A21CAF;font-size:14px;font-weight:bold">{escape(str(number or ""))}</div></td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:15px;font-weight:bold">Hi {escape(name)},</div>'
        f'<p style="margin:12px 0 0">A purchase order for your sales commission{inv_line} has been issued for <b>{_money(amount)}</b>.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:22px 32px 0" align="left">'
        f'<a href="{link}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:12px 28px;font-weight:bold;letter-spacing:1px">View Purchase Order (PDF)</a>'
        f'</td></tr>'
        f'<tr><td style="padding:22px 32px 28px">'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )



def render_commission_email(name: str, count: int, total: float, link: str, scope_label: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    contact_bits = [co.get("company_address"), co.get("company_phone"), co.get("company_web"), co.get("company_email")]
    contact = " &nbsp;·&nbsp; ".join([escape(str(x)) for x in contact_bits if x])
    contact_html = f'<div style="color:#6B7280;font-size:11px;margin-top:6px">{contact}</div>' if contact else ""
    period = f' ({escape(scope_label)})' if scope_label else ""
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">COMMISSION</div>'
        f'<div style="color:#6B7280;font-size:13px">Paid statement</div></td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#A21CAF"></div></td></tr>'
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:15px;font-weight:bold">Hi {escape(name)},</div>'
        f'<p style="margin:12px 0 0">Here is your paid-commission statement{period}. '
        f'It covers <b>{count}</b> paid commission(s) totaling <b>{_money(total)}</b>.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:22px 32px 0" align="left">'
        f'<a href="{link}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:12px 28px;font-weight:bold;letter-spacing:1px">Download Your Statement (PDF)</a>'
        f'</td></tr>'
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px;color:#6B7280;font-size:12px">Questions about your commissions? Just reply to this email.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'{contact_html}'
        f'</div></td></tr>'
        f'</table></div>'
    )


@api_router.get("/commissions/paid/pdf")
async def paid_commissions_pdf(salesman_name: Optional[str] = None, date_from: Optional[str] = None,
                               date_to: Optional[str] = None, user: dict = Depends(require_staff)):
    if user["role"] == "salesman":
        rows = await _paid_commission_rows(None, user["id"], date_from, date_to)
        label = _scope_label(user.get("name") or "", date_from, date_to)
    else:
        rows = await _paid_commission_rows(salesman_name, None, date_from, date_to)
        label = _scope_label(salesman_name or "", date_from, date_to)
    pdf = build_commissions_pdf(rows, await get_settings(), await get_logo_bytes(), label)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="paid-commissions.pdf"'})


@api_router.get("/pub/commissions/{token}")
async def public_commissions_pdf(token: str):
    rec = await db.commission_pdf_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Statement link is invalid or has expired")
    rows = await _paid_commission_rows(rec.get("salesman_name"), rec.get("salesman_id"), rec.get("date_from"), rec.get("date_to"))
    pdf = build_commissions_pdf(rows, await get_settings(), await get_logo_bytes(), rec.get("scope_label", ""))
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="paid-commissions.pdf"', "Cache-Control": "no-store"})


class CommissionEmailInput(BaseModel):
    salesman_id: Optional[str] = None
    salesman_name: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


@api_router.post("/commissions/email")
async def email_commission_statement(payload: CommissionEmailInput, user: dict = Depends(require_admin)):
    su = None
    if payload.salesman_id and ObjectId.is_valid(payload.salesman_id):
        su = await db.users.find_one({"_id": oid(payload.salesman_id)})
    if not su and payload.salesman_name:
        su = await db.users.find_one({"name": payload.salesman_name, "role": {"$in": ["salesman", "admin"]}})
    if not su:
        raise HTTPException(status_code=404, detail="No staff account found for that salesman")
    to = su.get("email")
    if not to:
        raise HTTPException(status_code=400, detail="That salesman has no email on file")
    sid = str(su["_id"])
    rows = await _paid_commission_rows(su.get("name"), sid, payload.date_from, payload.date_to)
    if not rows:
        raise HTTPException(status_code=400, detail="No paid commissions to send for this period")
    total = round(sum(float(r.get("commission_amount") or 0) for r in rows), 2)
    label = _scope_label(su.get("name") or "", payload.date_from, payload.date_to)
    token = secrets.token_urlsafe(16)
    await db.commission_pdf_tokens.insert_one({
        "token": token, "salesman_id": sid, "salesman_name": su.get("name"),
        "date_from": payload.date_from, "date_to": payload.date_to, "scope_label": label,
        "created_at": now_iso(),
    })
    link = f"{PUBLIC_BASE_URL}/api/pub/commissions/{token}"
    html = render_commission_email(su.get("name") or "there", len(rows), total, link, label, await get_settings())
    await send_email(to=to, subject="Your paid-commission statement · DBG Signs, Inc.", html=html)
    return {"sent": True, "to": to, "count": len(rows), "total": total}




# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard")
async def dashboard(user: dict = Depends(require_admin)):
    invoices = await db.invoices.find().to_list(2000)
    bills = await db.bills.find().to_list(2000)
    invoices = [i for i in invoices if not i.get("voided")]
    receivable = sum(i.get("total", 0) for i in invoices if i.get("status") != "paid")
    collected = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    payable = sum(b.get("amount", 0) for b in bills if b.get("status") != "paid")
    est_count = await db.estimates.count_documents({"status": {"$in": ["draft", "sent"]}})
    open_so = await db.sales_orders.count_documents({"status": {"$in": ["open", "in_production"]}})
    return {
        "receivable": round(receivable, 2),
        "collected": round(collected, 2),
        "payable": round(payable, 2),
        "net_cash": round(collected - sum(b.get("amount", 0) for b in bills if b.get("status") == "paid"), 2),
        "open_estimates": est_count,
        "open_sales_orders": open_so,
        "invoice_count": len(invoices),
        "customer_count": await db.customers.count_documents({}),
        "material_count": await db.materials.count_documents({}),
    }


# ---------------------------------------------------------------------------
# Xero CSV export
# ---------------------------------------------------------------------------
def csv_response(rows: List[List[str]], filename: str) -> Response:
    import csv
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/export/xero/invoices")
async def export_xero_invoices(user: dict = Depends(require_staff)):
    header = ["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Description",
              "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType"]
    rows = [header]
    invoices = await db.invoices.find().sort("created_at", -1).to_list(2000)
    for inv in invoices:
        inv = await enrich_customer(clean(inv))
        inv_date = inv.get("created_at", "")[:10]
        due = inv.get("due_date") or inv_date
        items = inv.get("line_items") or [{"description": inv.get("title"), "line_total": inv.get("total", 0)}]
        for li in items:
            rows.append([
                inv.get("customer_name", ""), inv.get("number", ""), inv_date, due,
                li.get("description", "") or inv.get("title", ""), 1,
                li.get("line_total", li.get("unit_price", 0)),
                "200", "Tax on Sales" if inv.get("tax_rate", 0) else "Tax Exempt",
            ])
        if inv.get("discount_amount", 0):
            rows.append([
                inv.get("customer_name", ""), inv.get("number", ""), inv_date, due,
                f"Tier discount ({inv.get('discount_rate', 0)}%)", 1,
                -abs(inv.get("discount_amount", 0)),
                "200", "Tax on Sales" if inv.get("tax_rate", 0) else "Tax Exempt",
            ])
    return csv_response(rows, "xero_invoices.csv")


@api_router.get("/export/xero/bills")
async def export_xero_bills(user: dict = Depends(require_staff)):
    header = ["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Description",
              "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType"]
    rows = [header]
    bills = await db.bills.find().sort("created_at", -1).to_list(2000)
    for b in bills:
        b = clean(b)
        bill_date = b.get("created_at", "")[:10]
        rows.append([
            b.get("vendor", ""), b.get("number", ""), bill_date, b.get("due_date") or bill_date,
            b.get("description") or b.get("reference") or "Bill", 1, b.get("amount", 0),
            "400", "Tax on Purchases",
        ])
    return csv_response(rows, "xero_bills.csv")


@api_router.get("/export/customers")
async def export_customers(user: dict = Depends(require_staff)):
    header = ["Type", "Company", "Name", "Title", "Email", "Phone", "Address", "Tier", "Net Terms", "Portal", "Notes"]
    rows = [header]
    customers = await db.customers.find().sort("company", 1).to_list(5000)
    all_contacts = await db.contacts.find().to_list(20000)
    by_cust: dict = {}
    for ct in all_contacts:
        by_cust.setdefault(str(ct.get("customer_id")), []).append(ct)
    for c in customers:
        c = clean(c)
        rows.append(["Customer", c.get("company") or "", c.get("name") or "", c.get("title") or "",
                     c.get("email") or "", c.get("phone") or "", c.get("address") or "",
                     "" if c.get("tier") is None else c.get("tier"), c.get("net_terms") or "",
                     "Yes" if c.get("portal_enabled") else "No", c.get("notes") or ""])
        for ct in by_cust.get(c.get("id"), []):
            ct = clean(ct)
            rows.append(["Contact", c.get("company") or c.get("name") or "", ct.get("name") or "",
                         ct.get("title") or "", ct.get("email") or "", ct.get("phone") or "", "", "", "", "", ""])
    return csv_response(rows, "customers_contacts.csv")


@api_router.get("/export/contacts")
async def export_contacts(user: dict = Depends(require_staff)):
    header = ["Name", "Title", "Email", "Phone", "Company"]
    rows = [header]
    customers = await db.customers.find().to_list(5000)
    cust_name = {str(c["_id"]): (c.get("company") or c.get("name") or "") for c in customers}
    contacts = await db.contacts.find().to_list(20000)
    contacts.sort(key=lambda c: (cust_name.get(str(c.get("customer_id")), ""), c.get("name") or ""))
    for ct in contacts:
        rows.append([ct.get("name") or "", ct.get("title") or "", ct.get("email") or "",
                     ct.get("phone") or "", cust_name.get(str(ct.get("customer_id")), "")])
    return csv_response(rows, "contacts.csv")


@api_router.get("/export/accounting-pdf")
async def export_accounting_month_pdf(month: str, user: dict = Depends(require_staff)):
    """Combined PDF of accounting records for every invoice PAID in the given month (YYYY-MM)."""
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    items = []
    invs = await db.invoices.find({"status": "paid", "voided": {"$ne": True}}).sort("paid_at", 1).to_list(5000)
    for inv in invs:
        raw = inv.get("paid_at") or inv.get("updated_at") or inv.get("created_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if not (start <= dt < end):
            continue
        cust = await db.customers.find_one({"_id": oid(inv["customer_id"])}) if inv.get("customer_id") else None
        payments = await _accounting_payments_for_invoice(str(inv["_id"]))
        items.append((clean(inv), clean(cust) if cust else None, payments))
    if not items:
        raise HTTPException(status_code=404, detail=f"No invoices were paid in {month}.")
    pdf = build_accounting_bulk_pdf(items, await get_settings(), await get_logo_bytes())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Accounting-{month}.pdf"', "Cache-Control": "no-store"})


async def _invoices_for_month(month: str) -> list:
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    out = []
    invs = await db.invoices.find().sort("created_at", 1).to_list(10000)
    for inv in invs:
        raw = inv.get("created_at") or inv.get("issued_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if start <= dt < end:
            out.append(await enrich_customer(clean(inv)))
    return out


@api_router.get("/export/invoices-pdf")
async def export_invoices_month_pdf(month: str, user: dict = Depends(require_staff)):
    """One-line-per-invoice summary PDF for every invoice created in the given month (YYYY-MM)."""
    out = await _invoices_for_month(month)
    if not out:
        raise HTTPException(status_code=404, detail=f"No invoices found for {month}.")
    label = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    pdf = build_invoices_list_pdf(out, label, await get_settings(), await get_logo_bytes())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Invoices-{month}.pdf"', "Cache-Control": "no-store"})


@api_router.get("/export/invoices-csv")
async def export_invoices_month_csv(month: str, user: dict = Depends(require_staff)):
    """One-row-per-invoice CSV for every invoice created in the given month (YYYY-MM), for Xero import."""
    out = await _invoices_for_month(month)
    if not out:
        raise HTTPException(status_code=404, detail=f"No invoices found for {month}.")
    rows = [["Invoice", "Date", "Customer", "Total", "Paid", "Balance", "Status"]]
    for inv in out:
        total = float(inv.get("total") or 0); paid = float(inv.get("amount_paid") or 0)
        status = "VOID" if inv.get("voided") else ((inv.get("status") or "").upper() or "OPEN")
        rows.append([inv.get("number", ""), str(inv.get("created_at", ""))[:10], inv.get("customer_name", "") or "",
                     f"{total:.2f}", f"{paid:.2f}", f"{round(total - paid, 2):.2f}", status])
    return csv_response(rows, f"Invoices-{month}.csv")


# ---------------------------------------------------------------------------
# Customer portal
# ---------------------------------------------------------------------------
async def current_customer(user: dict) -> Optional[dict]:
    if user.get("customer_id") and ObjectId.is_valid(user["customer_id"]):
        c = await db.customers.find_one({"_id": ObjectId(user["customer_id"])})
        if c:
            return c
    cust = await db.customers.find_one({"user_id": user["id"]})
    if not cust:
        cust = await db.customers.find_one({"email": user.get("email")})
    return cust


@api_router.get("/portal/orders")
async def portal_orders(user: dict = Depends(get_current_user)):
    cust = await current_customer(user)
    if not cust:
        return {"customer": None, "invoices": [], "reorders": []}
    if cust.get("portal_enabled") is False:
        raise HTTPException(status_code=403, detail="Portal access is not enabled for your account. Please contact DBG Signs.")
    cid = str(cust["_id"])
    invoices = await db.invoices.find({"customer_id": cid, "voided": {"$ne": True}}).sort("created_at", -1).to_list(500)
    reorders = await db.reorders.find({"customer_id": cid}).sort("created_at", -1).to_list(500)
    return {
        "customer": clean(cust),
        "invoices": [strip_margins({k: v for k, v in clean(i).items() if k != "internal_notes"}) for i in invoices],
        "reorders": [clean(r) for r in reorders],
    }


@api_router.get("/portal/statement/pdf")
async def portal_statement_pdf(user: dict = Depends(get_current_user)):
    cust = await current_customer(user)
    if not cust:
        raise HTTPException(status_code=404, detail="No customer profile linked to your account")
    if cust.get("portal_enabled") is False:
        raise HTTPException(status_code=403, detail="Portal access is not enabled for your account.")
    cid = str(cust["_id"])
    invoices = await db.invoices.find({"customer_id": cid, "voided": {"$ne": True}, "status": {"$ne": "paid"}}).sort("created_at", 1).to_list(1000)
    pdf = build_statement_pdf(clean(cust), [clean(i) for i in invoices], await get_settings(), await get_logo_bytes())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="statement.pdf"'})


async def _statement_data(cid: str, month: str):
    """Return (customer_doc, [invoices for the month], 'Month YYYY' label) for a statement."""
    cust = await get_or_404(db.customers, cid, "Customer")
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    invs = await db.invoices.find({"customer_id": cid, "voided": {"$ne": True}}).sort("created_at", 1).to_list(5000)
    out = []
    for inv in invs:
        raw = inv.get("created_at") or inv.get("issued_at")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if start <= dt < end:
            out.append(clean(inv))
    return cust, out, start.strftime("%B %Y")


@api_router.get("/customers/{cid}/statement/pdf")
async def customer_statement_pdf(cid: str, month: str, user: dict = Depends(require_staff)):
    """Monthly statement PDF for a customer: their invoices and balances for the given month (YYYY-MM)."""
    cust, out, label = await _statement_data(cid, month)
    pdf = build_statement_pdf(clean(cust), out, await get_settings(), await get_logo_bytes(), period_label=label)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(cust.get("company") or cust.get("name") or "customer"))
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Statement-{safe}-{month}.pdf"', "Cache-Control": "no-store"})


@api_router.get("/pub/statement/{token}")
async def public_statement_pdf(token: str):
    rec = await db.statement_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Link is invalid or has expired")
    try:
        created = datetime.fromisoformat(str(rec.get("created_at")).replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - created).days > 90:
            raise HTTPException(status_code=404, detail="This link has expired")
    except (ValueError, TypeError):
        pass
    cust, out, label = await _statement_data(rec["customer_id"], rec["month"])
    pdf = build_statement_pdf(clean(cust), out, await get_settings(), await get_logo_bytes(), period_label=label)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="Statement-{rec["month"]}.pdf"', "Cache-Control": "no-store"})


@api_router.post("/customers/{cid}/statement/email")
async def email_customer_statement(cid: str, month: str, user: dict = Depends(require_staff)):
    """Email the monthly statement to the customer, with a blind copy to the shop."""
    cust, out, label = await _statement_data(cid, month)
    to = cust.get("email")
    if not to:
        ct = await db.contacts.find_one({"customer_id": cid, "email": {"$nin": [None, ""]}})
        if ct:
            to = ct.get("email")
    if not to:
        raise HTTPException(status_code=400, detail="No email on file for this customer")
    token = secrets.token_urlsafe(16)
    await db.statement_tokens.insert_one({"token": token, "customer_id": cid, "month": month, "created_at": now_iso()})
    pdf_url = f"{PUBLIC_BASE_URL}/api/pub/statement/{token}"
    company = await get_settings()
    cname = cust.get("company") or cust.get("name") or "Customer"
    total_due = round(sum(float(i.get("total") or 0) - float(i.get("amount_paid") or 0) for i in out), 2)
    html = render_statement_email(cname, label, out, total_due, pdf_url, company)
    await send_email(to=to, subject=f"Your statement from DBG Signs, Inc. — {label}", html=html)
    try:
        await send_email(to=BCC_COPY_EMAIL, subject=f"[Copy] Statement — {cname} — {label}", html=html)
    except Exception as e:
        logger.warning(f"BCC statement copy to {BCC_COPY_EMAIL} failed: {e}")
    return {"status": "sent", "to": to}


def render_reorder_processed_email(customer_name: str, item_title: str, doc_label: str, doc_number: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        f'<tr><td style="padding:22px 32px">'
        f'<div style="font-size:20px;font-weight:bold">Your reorder is being processed</div>'
        f'<p style="margin:14px 0 0">Hi {escape(customer_name)},</p>'
        f'<p style="margin:12px 0 0">Good news — your reorder request <strong>{escape(item_title)}</strong> has been received and processed. '
        f'We have created <strong>{escape(doc_label)} {escape(str(doc_number))}</strong> and our team is getting it underway.</p>'
        f'<p style="margin:12px 0 0">We will keep you posted as your order progresses.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:18px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )


async def _create_doc_from_reorder(reorder: dict, user: dict, target: str) -> dict:
    collection = db.sales_orders if target == "sales_order" else db.invoices
    prefix = "SO" if target == "sales_order" else "INV"
    key = "sales_orders" if target == "sales_order" else "invoices"
    status = "open" if target == "sales_order" else "unpaid"
    cid = reorder["customer_id"]
    src = None
    if reorder.get("source_invoice_id") and ObjectId.is_valid(reorder["source_invoice_id"]):
        src = await db.invoices.find_one({"_id": oid(reorder["source_invoice_id"])})
    if src and src.get("line_items"):
        line_items = [dict(li) for li in src["line_items"]]
        tax_rate = float(src.get("tax_rate") or 0)
        tax_exempt = bool(src.get("tax_exempt"))
        tax_exempt_number = src.get("tax_exempt_number")
    else:
        line_items = [{"description": reorder.get("title") or "Reorder", "quantity": 1, "category": None}]
        tax_rate, tax_exempt, tax_exempt_number = 0.0, False, None
    disc = await customer_discount(cid)
    totals = await compute_totals(line_items, tax_rate, disc)
    doc = {
        "customer_id": cid, "contact_id": None,
        "title": (reorder.get("title") or "Reorder") + " (Reorder)",
        "customer_po": None, "tax_rate": tax_rate,
        "tax_exempt": tax_exempt, "tax_exempt_number": tax_exempt_number,
        "line_items": line_items, "notes": reorder.get("notes") or "",
        "status": status, "reorder_id": str(reorder["_id"]),
        "source_invoice_id": reorder.get("source_invoice_id"),
    }
    doc.update(totals)
    await apply_commission(doc, user)
    doc["number"] = await next_number(prefix, key, collection, start=29500)
    doc["created_at"] = now_iso()
    res = await collection.insert_one(doc)
    return await collection.find_one({"_id": res.inserted_id})


@api_router.post("/portal/reorder")
async def portal_reorder(payload: ReorderInput, user: dict = Depends(get_current_user)):
    cust = await current_customer(user)
    if not cust:
        raise HTTPException(status_code=404, detail="No customer profile linked to your account")
    doc = payload.model_dump()
    doc["customer_id"] = str(cust["_id"])
    doc["customer_name"] = cust.get("company") or cust.get("name")
    doc["status"] = "requested"
    doc["created_at"] = now_iso()
    res = await db.reorders.insert_one(doc)
    return clean(await db.reorders.find_one({"_id": res.inserted_id}))


WORK_STATUS_LABELS = {
    "approved": "Approved",
    "in_production": "In Production",
    "in_finishing": "In Finishing",
    "ready": "Ready for Pickup / Shipping",
}


def render_work_status_email(customer_name: str, doc_label: str, number: str, status_label: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        f'<tr><td style="padding:22px 32px">'
        f'<div style="font-size:20px;font-weight:bold">Order status update</div>'
        f'<p style="margin:14px 0 0">Hi {escape(customer_name)},</p>'
        f'<p style="margin:12px 0 0">Your order <strong>{escape(doc_label)} {escape(str(number))}</strong> has a new status:</p>'
        f'<div style="margin:16px 0;padding:14px 18px;background:#0A0A0A;color:#ffffff;text-align:center;font-size:16px;font-weight:bold;letter-spacing:1px">{escape(status_label)}</div>'
        f'<p style="margin:12px 0 0">We will keep you posted as your order moves forward. Reply to this email with any questions.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:18px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )


async def _set_work_status(collection, doc_id: str, kind_label: str, status: str):
    if status not in WORK_STATUS_LABELS:
        raise HTTPException(status_code=400, detail="Invalid work status")
    doc = await get_or_404(collection, doc_id, kind_label)
    if doc.get("work_status") == status:
        return clean(doc)
    await collection.update_one({"_id": oid(doc_id)}, {"$set": {"work_status": status}})
    try:
        cid = str(doc.get("customer_id") or "")
        cust = await db.customers.find_one({"_id": oid(cid)}) if ObjectId.is_valid(cid) else None
        to = cust.get("email") if cust else None
        if not to and cid:
            ct = await db.contacts.find_one({"customer_id": cid, "email": {"$nin": [None, ""]}})
            to = ct.get("email") if ct else None
        if to:
            company = await get_settings()
            cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
            label = WORK_STATUS_LABELS[status]
            html = render_work_status_email(cname, kind_label, doc.get("number", ""), label, company)
            await send_email(to=to, subject=f"Order update — {doc.get('number', '')} is now {label}", html=html)
            try:
                await send_email(to=BCC_COPY_EMAIL, subject=f"[Copy] {kind_label} {doc.get('number', '')} — {label}", html=html)
            except Exception as e:
                logger.warning(f"BCC work-status copy failed: {e}")
    except Exception as e:
        logger.warning(f"Work status email failed: {e}")
    return clean(await collection.find_one({"_id": oid(doc_id)}))


@api_router.patch("/sales-orders/{sid}/work-status")
async def set_so_work_status(sid: str, status: str, user: dict = Depends(require_staff)):
    return await _set_work_status(db.sales_orders, sid, "Sales Order", status)


@api_router.patch("/invoices/{iid}/work-status")
async def set_invoice_work_status(iid: str, status: str, user: dict = Depends(require_staff)):
    return await _set_work_status(db.invoices, iid, "Invoice", status)


@api_router.get("/reorders")
async def list_reorders(user: dict = Depends(require_staff)):
    docs = await db.reorders.find().sort("created_at", -1).to_list(1000)
    out = []
    for d in docs:
        r = clean(d)
        if r.get("source_invoice_id") and ObjectId.is_valid(r["source_invoice_id"]):
            inv = await db.invoices.find_one({"_id": oid(r["source_invoice_id"])}, {"number": 1})
            r["source_invoice_number"] = inv.get("number") if inv else None
        out.append(r)
    return out


@api_router.patch("/reorders/{rid}/status")
async def set_reorder_status(rid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("requested", "processing", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.reorders, rid, "Reorder")
    await db.reorders.update_one({"_id": oid(rid)}, {"$set": {"status": status}})
    return clean(await db.reorders.find_one({"_id": oid(rid)}))


@api_router.post("/reorders/{rid}/convert")
async def convert_reorder(rid: str, target: str, user: dict = Depends(require_staff)):
    if target not in ("sales_order", "invoice"):
        raise HTTPException(status_code=400, detail="target must be 'sales_order' or 'invoice'")
    r = await get_or_404(db.reorders, rid, "Reorder")
    if r.get("converted_id"):
        raise HTTPException(status_code=400, detail=f"This reorder was already converted ({r.get('converted_number')})")
    doc = await _create_doc_from_reorder(r, user, target)
    label = "Sales Order" if target == "sales_order" else "Invoice"
    update = {"status": "processing", "converted_id": str(doc["_id"]), "converted_type": target, "converted_number": doc.get("number")}
    if target == "sales_order":
        update["sales_order_id"] = str(doc["_id"])
        update["sales_order_number"] = doc.get("number")
    try:
        cid = str(r.get("customer_id") or "")
        cust = await db.customers.find_one({"_id": oid(cid)}) if ObjectId.is_valid(cid) else None
        to = cust.get("email") if cust else None
        if not to and cid:
            ct = await db.contacts.find_one({"customer_id": cid, "email": {"$nin": [None, ""]}})
            to = ct.get("email") if ct else None
        if to:
            company = await get_settings()
            cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
            html = render_reorder_processed_email(cname, r.get("title") or "your order", label, doc.get("number"), company)
            await send_email(to=to, subject=f"Your reorder is being processed — {label} {doc.get('number')}", html=html)
            try:
                await send_email(to=BCC_COPY_EMAIL, subject=f"[Copy] Reorder → {label} {doc.get('number')} — {cname}", html=html)
            except Exception as e:
                logger.warning(f"BCC reorder convert copy failed: {e}")
    except Exception as e:
        logger.warning(f"Reorder convert email failed: {e}")
    await db.reorders.update_one({"_id": oid(rid)}, {"$set": update})
    return clean(await db.reorders.find_one({"_id": oid(rid)}))


# ---------------------------------------------------------------------------
# Email documents + read receipts (Emergent-managed Resend)
# ---------------------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "DBG Signs, Inc.")
BCC_COPY_EMAIL = "sales@dbgsigns.com"
PUBLIC_BASE_URL = os.environ.get("FRONTEND_URL", "")
LOGO_PATH = ROOT_DIR / "assets" / "dbg_logo.jpg"
LOGO_URL = f"{PUBLIC_BASE_URL}/api/pub/logo"


async def get_logo_bytes() -> bytes:
    s = await db.settings.find_one({"key": "shop"})
    if s and s.get("logo_b64"):
        try:
            return base64.b64decode(s["logo_b64"])
        except Exception:
            pass
    return LOGO_PATH.read_bytes()

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="Email rate limit reached, please try again shortly")
        raise HTTPException(status_code=502, detail="Failed to send email")
    except Exception as e:
        logger.error(f"Email send error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send email")


def _money(n) -> str:
    return "${:,.2f}".format(float(n or 0))


def _num(n) -> str:
    f = float(n or 0)
    return str(int(f)) if f == int(f) else f"{f:g}"


def _dims_label(li: dict) -> str:
    if str(li.get("category") or "").strip().lower() == "shipping":
        return ""
    w = float(li.get("width_in") or 0)
    h = float(li.get("height_in") or 0)
    area = li.get("area_sqft", 0)
    if w and h:
        q = float(li.get("quantity") or 1)
        qpart = f' × {_num(q)}' if q and q != 1 else ""
        return f'{_num(w)}" × {_num(h)}"{qpart} · {area} sqft'
    return f"{area} sqft"


def render_doc_email(kind_label: str, doc: dict, customer_name: str, token: str, company: Optional[dict] = None, pdf_url: Optional[str] = None, track: bool = True) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    contact_bits = [co.get("company_address"), co.get("company_phone"), co.get("company_web"), co.get("company_email")]
    contact = " &nbsp;·&nbsp; ".join([escape(str(x)) for x in contact_bits if x])
    contact_html = f'<div style="color:#6B7280;font-size:11px;margin-top:6px">{contact}</div>' if contact else ""
    sub_raw = float(doc.get("subtotal", 0))
    disc_amt = float(doc.get("discount_amount", 0))
    factor = (sub_raw - disc_amt) / sub_raw if sub_raw else 1.0
    rows = ""
    for i, li in enumerate(doc.get("line_items", [])):
        bg = "#F7F7F8" if i % 2 else "#ffffff"
        det = str(li.get("details", "") or "").strip()
        det_html = f'<div style="color:#9CA3AF;font-size:11px;margin-top:2px">{escape(det)}</div>' if det else ""
        rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:10px 14px;border-bottom:1px solid #eee">{escape(str(li.get("description", "")))}{det_html}</td>'
            f'<td align="right" style="padding:10px 14px;border-bottom:1px solid #eee;color:#6B7280">{escape(_dims_label(li))}</td>'
            f'<td align="right" style="padding:10px 14px;border-bottom:1px solid #eee">{_money(li.get("line_total", 0) * factor)}</td></tr>'
        )
    pixel = f'<img src="{PUBLIC_BASE_URL}/api/track/open/{token}" width="1" height="1" alt="" style="display:none" />' if track else ""
    net_subtotal = round(float(doc.get("subtotal", 0)) - float(doc.get("discount_amount", 0)), 2)
    label = "Amount Due" if kind_label == "Invoice" else "Total"
    due = f'<span style="color:#6B7280;font-size:12px">Due {escape(str(doc.get("due_date")))}</span>' if doc.get("due_date") else ""
    po_html = f'<div style="color:#6B7280;font-size:12px">Your PO: {escape(str(doc.get("customer_po")))}</div>' if doc.get("customer_po") else ""
    attn_html = f'<div style="font-size:13px;color:#374151;margin-top:2px">Attn: {escape(str(doc.get("contact_name")))}</div>' if doc.get("contact_name") else ""
    pay_btn = ""
    if kind_label in ("Invoice", "Sales Order") and not doc.get("voided"):
        pay_url = f"{PUBLIC_BASE_URL}/pay/{token}"
        pay_btn = (
            f'<tr><td style="padding:22px 32px 0" align="center">'
            f'<a href="{pay_url}" style="display:inline-block;background:#06B6D4;color:#0A0A0A;text-decoration:none;padding:14px 36px;font-weight:bold;letter-spacing:1px;font-size:14px">PAY WITH CREDIT CARD →</a>'
            f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">Click above to pay securely online by card. Powered by Stripe.</div>'
            f'</td></tr>'
        )
    dl_btn = ""
    if pdf_url:
        dl_btn = (
            f'<tr><td style="padding:20px 32px 0" align="center">'
            f'<a href="{pdf_url}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:13px 32px;font-weight:bold;letter-spacing:1px;font-size:13px">DOWNLOAD {escape(kind_label.upper())} (PDF) →</a>'
            f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">Download a PDF copy of your {escape(kind_label.lower())} for your records.</div>'
            f'</td></tr>'
        )
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        # Header
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">{escape(kind_label.upper())}</div>'
        f'<div style="color:#6B7280;font-size:13px">#{escape(str(doc.get("number", "")))}</div>{po_html}{due}</td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        # Greeting + bill to
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:10px;letter-spacing:2px;color:#6B7280;text-transform:uppercase">Bill To</div>'
        f'<div style="font-size:15px;font-weight:bold;margin-top:2px">{escape(customer_name)}</div>'
        f'{attn_html}'
        f'<p style="margin:16px 0 0">Please find your {escape(kind_label.lower())} for <strong>{escape(str(doc.get("title", "")))}</strong> below.</p>'
        f'</td></tr>'
        # Table
        f'<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" style="border-collapse:collapse">'
        f'<tr style="background:#0A0A0A;color:#fff">'
        f'<th align="left" style="padding:10px 14px;font-size:11px;letter-spacing:1px">DESCRIPTION</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">SIZE</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">AMOUNT</th></tr>'
        f'{rows}'
        f'<tr><td></td><td align="right" style="padding:10px 14px;color:#6B7280">Subtotal</td>'
        f'<td align="right" style="padding:10px 14px">{_money(net_subtotal)}</td></tr>'
        f'<tr><td></td><td align="right" style="padding:6px 14px;color:#6B7280">Tax ({doc.get("tax_rate", 0)}%)</td>'
        f'<td align="right" style="padding:6px 14px">{_money(doc.get("tax_amount", 0))}</td></tr>'
        f'<tr><td></td><td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold">{label}</td>'
        f'<td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold;font-size:16px">{_money(doc.get("total", 0))}</td></tr>'
        f'</table></td></tr>'
        f'{dl_btn}'
        f'{pay_btn}'
        # Footer
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px">Questions about this {escape(kind_label.lower())}? Please email sales@dbgsigns.com</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'{contact_html}'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">We never ask for your password or card details by email.</div>'
        f'</div></td></tr>'
        f'{_disclaimer_html()}'
        f'</table></div>{pixel}'
    )


def render_statement_email(customer_name: str, period_label: str, invoices: list, total_due: float, pdf_url: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    contact_bits = [co.get("company_address"), co.get("company_phone"), co.get("company_web"), co.get("company_email")]
    contact = " &nbsp;·&nbsp; ".join([escape(str(x)) for x in contact_bits if x])
    contact_html = f'<div style="color:#6B7280;font-size:11px;margin-top:6px">{contact}</div>' if contact else ""
    rows = ""
    for i, inv in enumerate(invoices):
        bal = round(float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0), 2)
        bg = "#F7F7F8" if i % 2 else "#ffffff"
        dt = str(inv.get("due_date") or str(inv.get("created_at", ""))[:10])
        rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:9px 14px;border-bottom:1px solid #eee">{escape(str(inv.get("number", "")))}</td>'
            f'<td style="padding:9px 14px;border-bottom:1px solid #eee;color:#6B7280">{escape(dt)}</td>'
            f'<td align="right" style="padding:9px 14px;border-bottom:1px solid #eee">{_money(inv.get("total", 0))}</td>'
            f'<td align="right" style="padding:9px 14px;border-bottom:1px solid #eee">{_money(bal)}</td></tr>'
        )
    if not invoices:
        rows = f'<tr><td colspan="4" style="padding:14px;color:#6B7280">No invoices for {escape(period_label)}.</td></tr>'
    dl_btn = (
        f'<tr><td style="padding:20px 32px 0" align="center">'
        f'<a href="{pdf_url}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:13px 32px;font-weight:bold;letter-spacing:1px;font-size:13px">DOWNLOAD STATEMENT (PDF) →</a>'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">Download a PDF copy of this statement for your records.</div>'
        f'</td></tr>'
    )
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">STATEMENT</div>'
        f'<div style="color:#6B7280;font-size:13px">{escape(period_label)}</div></td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:10px;letter-spacing:2px;color:#6B7280;text-transform:uppercase">Account</div>'
        f'<div style="font-size:15px;font-weight:bold;margin-top:2px">{escape(customer_name)}</div>'
        f'<p style="margin:16px 0 0">Please find your account statement for <strong>{escape(period_label)}</strong> below.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" style="border-collapse:collapse">'
        f'<tr style="background:#0A0A0A;color:#fff">'
        f'<th align="left" style="padding:10px 14px;font-size:11px;letter-spacing:1px">INVOICE</th>'
        f'<th align="left" style="padding:10px 14px;font-size:11px;letter-spacing:1px">DATE</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">TOTAL</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">BALANCE</th></tr>'
        f'{rows}'
        f'<tr><td></td><td></td><td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold">TOTAL DUE</td>'
        f'<td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold;font-size:16px">{_money(total_due)}</td></tr>'
        f'</table></td></tr>'
        f'{dl_btn}'
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px">Questions about this statement? Just reply to this email.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'{contact_html}'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">We never ask for your password or card details by email.</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )


async def _send_document(collection, doc_id: str, kind_label: str) -> dict:
    doc = await get_or_404(collection, doc_id, kind_label)
    await _attach_contact_name(doc)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    to = (cust or {}).get("email")
    if doc.get("contact_id") and ObjectId.is_valid(str(doc["contact_id"])):
        ct = await db.contacts.find_one({"_id": ObjectId(doc["contact_id"])})
        if ct and ct.get("email"):
            to = ct["email"]
    if not to:
        raise HTTPException(status_code=400, detail="No email on file for this customer or the selected contact")
    cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
    token = secrets.token_urlsafe(16)
    pdf_token = secrets.token_urlsafe(16)
    await db.pdf_tokens.insert_one({"token": pdf_token, "collection": collection.name, "doc_id": str(doc["_id"]), "created_at": now_iso()})
    pdf_url = f"{PUBLIC_BASE_URL}/api/pub/pdf/{pdf_token}"
    company = await get_settings()
    html = render_doc_email(kind_label, doc, cname, token, company, pdf_url=pdf_url)
    email_id = await send_email(to=to, subject=f"{kind_label} {doc.get('number', '')} from DBG Signs, Inc.", html=html)
    await db.email_tracking.insert_one({"token": token, "collection": collection.name, "doc_id": str(doc["_id"]), "created_at": now_iso()})
    # Blind copy to the shop so there is always an internal record of what was sent.
    try:
        copy_html = render_doc_email(kind_label, doc, cname, token, company, pdf_url=pdf_url, track=False)
        await send_email(to=BCC_COPY_EMAIL, subject=f"[Copy] {kind_label} {doc.get('number', '')} sent to {cname}", html=copy_html)
    except Exception as e:
        logger.warning(f"BCC copy to {BCC_COPY_EMAIL} failed: {e}")
    await collection.update_one({"_id": oid(doc_id)}, {"$set": {
        "email_status": "sent", "email_to": to, "email_sent_at": now_iso(),
        "email_opened_at": None, "email_token": token, "email_id": email_id,
    }})
    return {"status": "sent", "to": to}


def render_payment_receipt_email(inv: dict, amount_now: float, customer_name: str, company: Optional[dict] = None, pdf_link: Optional[str] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    contact_bits = [co.get("company_address"), co.get("company_phone"), co.get("company_web"), co.get("company_email")]
    contact = " &nbsp;·&nbsp; ".join([escape(str(x)) for x in contact_bits if x])
    contact_html = f'<div style="color:#6B7280;font-size:11px;margin-top:6px">{contact}</div>' if contact else ""
    total = float(inv.get("total") or 0)
    paid = float(inv.get("amount_paid") or 0)
    balance = round(total - paid, 2)
    fully = inv.get("status") == "paid"
    status_line = "Paid in full — thank you!" if fully else f"Partial payment received. Remaining balance: {_money(balance)}"
    balance_row = "" if fully else (
        f'<tr><td></td><td align="right" style="padding:6px 14px;color:#6B7280">Balance remaining</td>'
        f'<td align="right" style="padding:6px 14px">{_money(balance)}</td></tr>'
    )
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">RECEIPT</div>'
        f'<div style="color:#6B7280;font-size:13px">Invoice #{escape(str(inv.get("number", "")))}</div></td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#16A34A"></div></td></tr>'
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:10px;letter-spacing:2px;color:#6B7280;text-transform:uppercase">Billed To</div>'
        f'<div style="font-size:15px;font-weight:bold;margin-top:2px">{escape(customer_name)}</div>'
        f'<p style="margin:16px 0 0">We\'ve received your payment. {escape(status_line)}</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" style="border-collapse:collapse">'
        f'<tr><td></td><td align="right" style="padding:10px 14px;color:#6B7280">Invoice total</td>'
        f'<td align="right" style="padding:10px 14px">{_money(total)}</td></tr>'
        f'<tr><td></td><td align="right" style="padding:6px 14px;color:#6B7280">Total paid to date</td>'
        f'<td align="right" style="padding:6px 14px">{_money(paid)}</td></tr>'
        f'{balance_row}'
        f'<tr><td></td><td align="right" style="padding:12px 14px;background:#16A34A;color:#fff;font-weight:bold">Payment received</td>'
        f'<td align="right" style="padding:12px 14px;background:#16A34A;color:#fff;font-weight:bold;font-size:16px">{_money(amount_now)}</td></tr>'
        f'</table></td></tr>'
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px">Questions about this payment? Just reply to this email.</p>'
        + (f'<div style="margin:14px 0 4px"><a href="{pdf_link}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:13px;font-weight:bold">Download receipt (PDF)</a></div>' if pdf_link else "")
        +
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'{contact_html}'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">We never ask for your password or card details by email.</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )


async def _send_payment_receipt(inv: dict, amount_now: float) -> None:
    cust = await db.customers.find_one({"_id": oid(inv["customer_id"])}) if inv.get("customer_id") else None
    to = (cust or {}).get("email")
    if not to:
        return
    cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
    s = await get_settings()
    pdf_link = await _invoice_pdf_link(str(inv.get("_id") or inv.get("id")))
    html = render_payment_receipt_email(inv, amount_now, cname, s, pdf_link)
    await send_email(to=to, subject=f"Payment received — Invoice {inv.get('number', '')} · DBG Signs, Inc.", html=html)


def render_welcome_email(name: str, email: str, temp_password: str, role: str, company: Optional[dict] = None) -> str:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    contact_bits = [co.get("company_address"), co.get("company_phone"), co.get("company_web"), co.get("company_email")]
    contact = " &nbsp;·&nbsp; ".join([escape(str(x)) for x in contact_bits if x])
    contact_html = f'<div style="color:#6B7280;font-size:11px;margin-top:6px">{contact}</div>' if contact else ""
    role_label = {"admin": "Administrator", "salesman": "Salesperson", "installer": "Service / Installer"}.get(role, role.title())
    login_url = f"{PUBLIC_BASE_URL}/login"
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">WELCOME</div>'
        f'<div style="color:#6B7280;font-size:13px">{escape(role_label)} account</div></td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:15px;font-weight:bold">Hi {escape(name)},</div>'
        f'<p style="margin:12px 0 0">An account has been created for you on the {escape(cname)} system. '
        f'For your security, <b>please change your password before you start using the app</b> — you\'ll be prompted to set a new one the first time you sign in.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:18px 32px 0"><table role="presentation" width="100%" style="border:1px solid #E5E7EB;background:#F9FAFB">'
        f'<tr><td style="padding:12px 16px;color:#6B7280;width:150px">Sign-in email</td>'
        f'<td style="padding:12px 16px;font-weight:bold">{escape(email)}</td></tr>'
        f'<tr><td style="padding:12px 16px;color:#6B7280;border-top:1px solid #E5E7EB">Temporary password</td>'
        f'<td style="padding:12px 16px;font-weight:bold;font-family:monospace;border-top:1px solid #E5E7EB">{escape(temp_password)}</td></tr>'
        f'</table></td></tr>'
        f'<tr><td style="padding:22px 32px 0" align="left">'
        f'<a href="{login_url}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:12px 28px;font-weight:bold;letter-spacing:1px">Sign In &amp; Set Your Password</a>'
        f'</td></tr>'
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px;color:#6B7280;font-size:12px">If you didn\'t expect this email, please contact your administrator.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">{escape(cname)}</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'{contact_html}'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">We never ask for your password or card details by email.</div>'
        f'</div></td></tr>'
        f'</table></div>'
    )


async def _send_welcome_email(*, name: str, email: str, temp_password: str, role: str) -> None:
    html = render_welcome_email(name, email, temp_password, role, await get_settings())
    await send_email(to=email, subject="Welcome to DBG Signs, Inc. — set your password", html=html)


@api_router.post("/estimates/{eid}/send")
async def send_estimate(eid: str, user: dict = Depends(require_staff)):
    return await _send_document(db.estimates, eid, "Estimate")


@api_router.post("/sales-orders/{sid}/send")
async def send_sales_order(sid: str, user: dict = Depends(require_staff)):
    return await _send_document(db.sales_orders, sid, "Sales Order")


@api_router.post("/invoices/{iid}/send")
async def send_invoice(iid: str, user: dict = Depends(require_staff)):
    return await _send_document(db.invoices, iid, "Invoice")


_PIXEL = base64.b64decode("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==")


@api_router.get("/track/open/{token}")
async def track_open(token: str):
    rec = await db.email_tracking.find_one({"token": token})
    if rec:
        coll = db[rec["collection"]]
        await coll.update_one(
            {"_id": oid(rec["doc_id"]), "email_opened_at": None},
            {"$set": {"email_opened_at": now_iso(), "email_status": "opened"}},
        )
    return Response(content=_PIXEL, media_type="image/gif", headers={"Cache-Control": "no-store, max-age=0"})


# ---------------------------------------------------------------------------
# PDF generation
# ---------------------------------------------------------------------------
DISCLAIMER_HEADING = "Disclaimer"
DISCLAIMER_BLOCKS = [
    ("p", "This outlines the disclaimer for services provided by Deep Blue Graphics (DBG Signs). Deep Blue Graphics (DBG Signs) is not responsible for any defects or issues arising from graphic installations performed in outdoor conditions where the following factors are present:"),
    ("li", "Temperatures of 60 degrees Fahrenheit or under, or temperatures that drop below 60 degrees Fahrenheit within 36 hours after installation."),
    ("li", "Winds in excess of 5 mph."),
    ("li", "Application to damaged or uncleaned equipment."),
    ("p", "Deep Blue Graphics (DBG Signs) is also not responsible for cleaning or preparing any personal or commercial equipment, including but not limited to service vans, pickup trucks, semi-trailers, box trucks, semi-trucks, or any other oversized equipment. Unless explicitly stated or discussed prior to installation, DBG Signs will not clean or prep equipment. Any issues or defects due to unclean surfaces will not be the liability of DBG Signs. Customers are responsible for cleaning their equipment before installation, and DBG Signs will not be held responsible for any issues due to unclean equipment or graphic issues resulting from it."),
    ("p", "Regarding warranties:"),
    ("li", "Equipment older than five years from the current date carries no warranty due to heavy commercial use."),
    ("li", "For equipment five years and newer, DBG Signs will evaluate any issues and determine if services will be performed for a fix, only if the vinyl is at fault. DBG Signs will not be held responsible for any issues due to customers, customers' employees, or drivers."),
    ("p", "(Ready Artwork) is as outlined any artwork that is not created by DBG Signs in-house and DBG Signs will not alter or make any changes to artwork unless written consent has been authorized by the customer and then approved by customer. Ready Artwork will be printed and produced with no guarantee to the accuracy of colors due to the artwork was not produced by DBG Signs in-house art dept.; DBG Signs will not be held responsible for any incorrect colors or problems in artwork, IE (Spelling errors, Colors, or anything in the artwork). Any issues will be addressed and fixed at the customer's expense."),
]


def _disclaimer_html() -> str:
    parts = [
        f'<div style="font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">{escape(DISCLAIMER_HEADING)}</div>',
        '<div style="height:2px;background:#06B6D4;width:56px;margin:0 0 10px"></div>',
    ]
    ul_open = False
    for kind, text in DISCLAIMER_BLOCKS:
        if kind == "li":
            if not ul_open:
                parts.append('<ul style="margin:0 0 8px 18px;padding:0;color:#6B7280;font-size:11px;line-height:1.55">')
                ul_open = True
            parts.append(f'<li style="margin:0 0 4px">{escape(text)}</li>')
        else:
            if ul_open:
                parts.append('</ul>')
                ul_open = False
            parts.append(f'<p style="margin:0 0 8px;color:#6B7280;font-size:11px;line-height:1.55">{escape(text)}</p>')
    if ul_open:
        parts.append('</ul>')
    return ('<tr><td style="padding:2px 32px 26px">'
            '<div style="border-top:1px solid #E5E7EB;padding-top:14px">' + "".join(parts) + '</div></td></tr>')


def _draw_disclaimer(c, L, R, H) -> None:
    from reportlab.lib.utils import simpleSplit
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#4B5563"); cyan = colors.HexColor("#06B6D4")
    y = H - 70
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 16); c.drawString(L, y, DISCLAIMER_HEADING.upper())
    y -= 10
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 20
    for kind, text in DISCLAIMER_BLOCKS:
        indent = 14 if kind == "li" else 0
        prefix = "•  " if kind == "li" else ""
        c.setFillColor(soft); c.setFont("Helvetica", 8)
        lines = simpleSplit(prefix + text, "Helvetica", 8, (R - L) - indent)
        for ln in lines:
            if y < 60:
                c.showPage(); y = H - 70; c.setFont("Helvetica", 8); c.setFillColor(soft)
            c.drawString(L + indent, y, ln); y -= 11
        y -= 5


def build_doc_pdf(kind_label: str, doc: dict, customer: Optional[dict], logo_bytes: Optional[bytes] = None, company: Optional[dict] = None) -> bytes:
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    W, H = letter
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); cyan = colors.HexColor("#06B6D4")
    grayline = colors.HexColor("#E5E7EB"); soft = colors.HexColor("#6B7280"); rowbg = colors.HexColor("#F7F7F8")
    ax = R  # right edge for amounts
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    sub_raw = float(doc.get("subtotal", 0))
    disc_amt = float(doc.get("discount_amount", 0))
    factor = (sub_raw - disc_amt) / sub_raw if sub_raw else 1.0

    # Logo (top-left, enlarged)
    try:
        logo = ImageReader(io.BytesIO(logo_bytes)) if logo_bytes else ImageReader(str(LOGO_PATH))
        c.drawImage(logo, L, H - 128, width=230, height=116,
                    preserveAspectRatio=True, mask="auto", anchor="sw")
    except Exception:
        c.setFillColor(ink); c.setFont("Helvetica-Bold", 20); c.drawString(L, H - 96, cname)

    # Company info under the logo
    ciy = H - 140
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 9); c.drawString(L, ciy, cname); ciy -= 11
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    for line in [co.get("company_address"), co.get("company_phone"),
                 " · ".join([x for x in [co.get("company_web"), co.get("company_email")] if x])]:
        if line:
            c.drawString(L, ciy, str(line)); ciy -= 11

    # Document label + number (top-right)
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 28); c.drawRightString(R, H - 82, kind_label.upper())
    c.setFillColor(soft); c.setFont("Helvetica", 11); c.drawRightString(R, H - 100, f"#{doc.get('number', '')}")

    # Accent rule (below the header block)
    rule_y = min(ciy - 2, H - 176)
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, rule_y, R, rule_y)

    # PAID IN FULL badge (small, top-right under the document number)
    if doc.get("status") == "paid":
        green = colors.HexColor("#16A34A")
        c.saveState()
        c.setFont("Helvetica-Bold", 10)
        txt = "PAID IN FULL"
        tw = c.stringWidth(txt, "Helvetica-Bold", 10)
        bx1, by1 = R - tw - 16, H - 122
        c.setStrokeColor(green); c.setFillColor(green); c.setLineWidth(1.2)
        c.roundRect(bx1, by1, tw + 16, 18, 4, stroke=1, fill=0)
        c.setFillColor(green)
        c.drawRightString(R - 8, by1 + 5, txt)
        c.restoreState()

    y = rule_y - 30
    # Meta (right)
    meta = [("Date", str(doc.get("created_at", ""))[:10])]
    if doc.get("work_status") in WORK_STATUS_LABELS:
        meta.append(("Work Status", WORK_STATUS_LABELS[doc["work_status"]]))
    if doc.get("customer_po"):
        meta.append(("Customer PO", str(doc.get("customer_po"))))
    if doc.get("due_date"):
        meta.append(("Due Date", str(doc.get("due_date"))))
    terms = (customer or {}).get("net_terms")
    if terms:
        meta.append(("Terms", str(terms)))
    my = y
    for k, v in meta:
        c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawRightString(R - 96, my, k.upper())
        c.setFillColor(ink); c.setFont("Helvetica-Bold", 9); c.drawRightString(R, my, str(v)); my -= 15

    # Bill To (left)
    c.setFillColor(soft); c.setFont("Helvetica-Bold", 8); c.drawString(L, y, "BILL TO")
    name = (customer or {}).get("company") or (customer or {}).get("name") or "Customer"
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 13); c.drawString(L, y - 18, str(name))
    yy = y - 33
    c.setFont("Helvetica", 9); c.setFillColor(soft)
    if doc.get("contact_name"):
        c.setFont("Helvetica-Bold", 9); c.setFillColor(ink)
        c.drawString(L, yy, f'Attn: {doc["contact_name"]}'); yy -= 13
        c.setFont("Helvetica", 9); c.setFillColor(soft)
    if customer and customer.get("company") and customer.get("name"):
        who = customer["name"] + (f" - {customer['title']}" if customer.get("title") else "")
        c.drawString(L, yy, str(who)); yy -= 13
    if customer and customer.get("email"):
        c.drawString(L, yy, str(customer["email"])); yy -= 13
    if customer and customer.get("phone"):
        c.drawString(L, yy, str(customer["phone"])); yy -= 13

    y = min(yy, my) - 22

    # Table header
    c.setFillColor(ink); c.rect(L, y - 6, R - L, 24, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 9)
    c.drawString(L + 10, y + 3, "DESCRIPTION")
    c.drawRightString(ax - 150, y + 3, "SIZE")
    c.drawRightString(ax - 10, y + 3, "AMOUNT")
    y -= 30

    c.setFont("Helvetica", 10)
    for i, li in enumerate(doc.get("line_items", [])):
        det = str(li.get("details", "") or "").strip()
        rh = 34 if det else 22
        if i % 2 == 1:
            c.setFillColor(rowbg); c.rect(L, y - (rh - 15), R - L, rh, fill=1, stroke=0)
        c.setFillColor(ink); c.setFont("Helvetica", 10)
        c.drawString(L + 10, y, str(li.get("description", ""))[:40])
        c.setFont("Helvetica", 9)
        c.drawRightString(ax - 150, y, _dims_label(li))
        c.setFont("Helvetica", 10)
        c.drawRightString(ax - 10, y, _money(li.get("line_total", 0) * factor))
        if det:
            c.setFillColor(soft); c.setFont("Helvetica", 8)
            c.drawString(L + 10, y - 12, det[:95])
        y -= rh
        if y < 170:
            c.showPage(); y = H - 90; c.setFont("Helvetica", 10)

    # Anchor the totals/balance block near the bottom of the page
    amt_paid = float(doc.get("amount_paid") or 0)
    totals_top = 260 if (kind_label == "Invoice" and amt_paid > 0) else 200
    if y < totals_top:
        c.showPage()
    y = totals_top

    # Totals (discount hidden; subtotal shown net of any discount so it reconciles)
    net_subtotal = round(float(doc.get("subtotal", 0)) - float(doc.get("discount_amount", 0)), 2)
    c.setStrokeColor(grayline); c.setLineWidth(1); c.line(ax - 230, y + 2, R, y + 2); y -= 16
    c.setFont("Helvetica", 10); c.setFillColor(soft); c.drawRightString(ax - 100, y, "Subtotal")
    c.setFillColor(ink); c.drawRightString(ax - 10, y, _money(net_subtotal)); y -= 16
    if (customer and customer.get("tax_exempt")) or doc.get("tax_exempt"):
        _exnum = doc.get("tax_exempt_number") or (customer.get("tax_exempt_number") if customer else None)
        _tax_lbl = "Tax Exempt" + (f" · {_exnum}" if _exnum else "")
    else:
        _tax_lbl = f"Tax ({doc.get('tax_rate', 0)}%)"
    c.setFillColor(soft); c.drawRightString(ax - 100, y, _tax_lbl)
    c.setFillColor(ink); c.drawRightString(ax - 10, y, _money(doc.get("tax_amount", 0))); y -= 26
    label = "AMOUNT DUE" if kind_label == "Invoice" else "TOTAL"
    c.setFillColor(ink); c.rect(ax - 230, y - 7, 230, 28, fill=1, stroke=0)
    c.setFillColor(cyan); c.rect(ax - 230, y - 7, 5, 28, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(ax - 214, y + 2, label)
    c.setFont("Helvetica-Bold", 14); c.drawRightString(ax - 10, y + 1, _money(doc.get("total", 0)))

    # Payment details (invoices with payments applied)
    if kind_label == "Invoice" and amt_paid > 0:
        bal = round(float(doc.get("total") or 0) - amt_paid, 2)
        y -= 26
        c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawRightString(ax - 100, y, "Amount Paid")
        c.setFillColor(colors.HexColor("#16A34A")); c.setFont("Helvetica-Bold", 10); c.drawRightString(ax - 10, y, "-" + _money(amt_paid)); y -= 15
        pm = doc.get("paid_via") or doc.get("last_payment_method")
        if pm:
            when = str(doc.get("paid_at"))[:10] if doc.get("paid_at") else ""
            c.setFillColor(soft); c.setFont("Helvetica", 8)
            c.drawRightString(ax - 10, y + 1, f"Paid via {pm}" + (f" on {when}" if when else "")); y -= 14
        y -= 4
        c.setFillColor(ink); c.rect(ax - 230, y - 7, 230, 26, fill=1, stroke=0)
        c.setFillColor(cyan); c.rect(ax - 230, y - 7, 5, 26, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(ax - 214, y + 1, "BALANCE DUE")
        c.setFont("Helvetica-Bold", 13); c.drawRightString(ax - 10, y + 1, _money(bal))
        if bal <= 0.005:
            c.saveState(); c.setFillColor(colors.HexColor("#16A34A")); c.setFont("Helvetica-Bold", 24)
            c.translate(L + 40, y + 30); c.rotate(9); c.drawString(0, 0, "PAID IN FULL"); c.restoreState()

    # Footer
    fy = 88
    c.setStrokeColor(grayline); c.setLineWidth(1); c.line(L, fy + 24, R, fy + 24)
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    tline = f"Payment terms: {terms}.  " if terms else ""
    c.drawString(L, fy + 10, f"{tline}Thank you for your business.")
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 9); c.drawString(L, fy - 5, cname)
    c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, fy - 17, "Image Is Everything")
    cy = fy - 5
    contact = [co.get("company_address"), co.get("company_phone"),
               " · ".join([x for x in [co.get("company_web"), co.get("company_email")] if x])]
    for line in contact:
        if line:
            c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawRightString(R, cy, str(line)); cy -= 11
    # Disclaimer on its own page
    c.showPage()
    _draw_disclaimer(c, L, R, H)
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def _draw_accounting(c, W, H, inv: dict, customer: Optional[dict], payments: list, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> None:
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4")
    rowbg = colors.HexColor("#F7F7F8")
    y = H - 70
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 40, width=150, height=86, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 20); c.drawRightString(R, y, "ACCOUNTING RECORD")
    c.setFillColor(soft); c.setFont("Helvetica", 11); c.drawRightString(R, y - 16, f"Invoice #{inv.get('number', '')}")
    y -= 62
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 26

    custname = (customer.get("company") or customer.get("name")) if customer else "Customer"
    total = float(inv.get("total") or 0); paid = float(inv.get("amount_paid") or 0); bal = round(total - paid, 2)
    status = "PAID IN FULL" if bal <= 0.005 and paid > 0 else ((inv.get("status") or "").upper() or "OPEN")
    for label, val in [("Customer", custname), ("Invoice date", str(inv.get("created_at", ""))[:10]), ("Status", status)]:
        c.setFillColor(soft); c.setFont("Helvetica", 9); c.drawString(L, y, label.upper())
        c.setFillColor(ink); c.setFont("Helvetica-Bold", 10); c.drawString(L + 130, y, str(val)); y -= 18
    y -= 8

    # Invoice line items
    c.setFillColor(ink); c.rect(L, y - 6, R - L, 22, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 9)
    c.drawString(L + 10, y + 2, "DESCRIPTION"); c.drawRightString(R - 10, y + 2, "AMOUNT")
    y -= 28
    sub_raw = float(inv.get("subtotal", 0)); disc = float(inv.get("discount_amount", 0))
    factor = (sub_raw - disc) / sub_raw if sub_raw else 1.0
    c.setFont("Helvetica", 10)
    for i, li in enumerate(inv.get("line_items", [])):
        if i % 2 == 1:
            c.setFillColor(rowbg); c.rect(L, y - 6, R - L, 20, fill=1, stroke=0)
        c.setFillColor(ink); c.setFont("Helvetica", 10)
        c.drawString(L + 10, y, str(li.get("description", ""))[:64])
        c.drawRightString(R - 10, y, _money(li.get("line_total", 0) * factor))
        y -= 20
        if y < 200:
            c.showPage(); y = H - 80; c.setFont("Helvetica", 10)

    net_sub = round(sub_raw - disc, 2)
    c.setStrokeColor(colors.HexColor("#E5E7EB")); c.setLineWidth(1); c.line(R - 240, y + 4, R, y + 4); y -= 14
    for label, val, bold in [("Subtotal", net_sub, False), (f"Tax ({inv.get('tax_rate', 0)}%)", inv.get("tax_amount", 0), False),
                             ("Total", total, True), ("Amount paid", paid, False), ("Balance due", bal, True)]:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
        c.setFillColor(ink if bold else soft); c.drawRightString(R - 120, y, label)
        c.setFillColor(ink); c.drawRightString(R - 10, y, _money(val)); y -= 16
    y -= 16

    # Payment records
    if y < 140:
        c.showPage(); y = H - 80
    c.setFillColor(cyan); c.setFont("Helvetica-Bold", 11); c.drawString(L, y, "PAYMENT RECORDS"); y -= 8
    c.setStrokeColor(cyan); c.setLineWidth(1); c.line(L, y, R, y); y -= 24
    if not payments:
        c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawString(L, y, "No payments recorded for this invoice."); y -= 20
    for p in payments:
        rows = [("Date", str(p.get("date") or "")[:19].replace("T", " ")),
                ("Amount", _money(p.get("amount")))]
        if p.get("payment_intent_id"):
            rows.append(("Type", "Stripe card payment"))
            rows.append(("Payment intent", str(p.get("payment_intent_id"))))
            if p.get("surcharge"):
                rows.append(("Card surcharge (txn)", _money(p.get("surcharge"))))
            if p.get("charged"):
                rows.append(("Total charged (txn)", _money(p.get("charged"))))
            if p.get("currency"):
                rows.append(("Currency", str(p.get("currency")).upper()))
        else:
            rows.append(("Type", f"Manual — {p.get('method') or ''}"))
            if p.get("reference"):
                rows.append(("Reference", str(p.get("reference"))))
            if p.get("recorded_by"):
                rows.append(("Recorded by", str(p.get("recorded_by"))))
        if p.get("notes"):
            rows.append(("Notes", str(p.get("notes"))))
        box_h = 16 * len(rows) + 12
        if y - box_h < 60:
            c.showPage(); y = H - 80
        c.setStrokeColor(colors.HexColor("#E5E7EB")); c.setLineWidth(1)
        c.rect(L, y - box_h + 10, R - L, box_h, stroke=1, fill=0)
        yy = y - 4
        for k, v in rows:
            c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L + 10, yy, k.upper())
            c.setFillColor(ink); c.setFont("Helvetica", 10); c.drawString(L + 170, yy, str(v)[:66]); yy -= 16
        y = y - box_h - 6

    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 46, f"{cname} · Accounting record generated {now_iso()[:10]}")


def build_accounting_pdf(inv: dict, customer: Optional[dict], payments: list, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> bytes:
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    _draw_accounting(c, W, H, inv, customer, payments, company, logo_bytes)
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def build_accounting_bulk_pdf(items: list, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> bytes:
    """items: list of (inv, customer, payments). One accounting record per invoice, each starting a new page."""
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    for inv, customer, payments in items:
        _draw_accounting(c, W, H, inv, customer, payments, company, logo_bytes)
        c.showPage()
    c.save(); buf.seek(0)
    return buf.getvalue()


def build_invoices_list_pdf(invoices: list, period_label: str, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> bytes:
    """A one-line-per-invoice summary report (for accounting / Xero)."""
    co = company or {}
    cname = co.get("company_name") or "DBG Signs, Inc."
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    L, R = 40, W - 40
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4")
    rowbg = colors.HexColor("#F7F7F8")
    cx = {"num": L + 4, "date": L + 92, "cust": L + 168, "total": R - 240, "paid": R - 150, "bal": R - 66, "status": R - 58}

    def header(y):
        c.setFillColor(ink); c.rect(L, y - 6, R - L, 22, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 8)
        c.drawString(cx["num"], y + 1, "INVOICE"); c.drawString(cx["date"], y + 1, "DATE")
        c.drawString(cx["cust"], y + 1, "CUSTOMER")
        c.drawRightString(cx["total"], y + 1, "TOTAL"); c.drawRightString(cx["paid"], y + 1, "PAID")
        c.drawRightString(cx["bal"], y + 1, "BALANCE"); c.drawString(cx["status"] + 6, y + 1, "STATUS")
        return y - 26

    y = H - 60
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 30, width=130, height=70, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 18); c.drawRightString(R, y, "INVOICE REPORT")
    c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawRightString(R, y - 15, period_label)
    y -= 54
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 24
    y = header(y)
    tot = paid_sum = bal_sum = 0.0
    c.setFont("Helvetica", 9)
    for i, inv in enumerate(invoices):
        total = float(inv.get("total") or 0); paid = float(inv.get("amount_paid") or 0)
        bal = round(total - paid, 2)
        tot += total; paid_sum += paid; bal_sum += bal
        status = "VOID" if inv.get("voided") else ((inv.get("status") or "").upper() or "OPEN")
        if i % 2 == 1:
            c.setFillColor(rowbg); c.rect(L, y - 5, R - L, 18, fill=1, stroke=0)
        c.setFillColor(ink); c.setFont("Helvetica", 9)
        c.drawString(cx["num"], y, str(inv.get("number", ""))[:14])
        c.setFillColor(soft); c.drawString(cx["date"], y, str(inv.get("created_at", ""))[:10])
        c.setFillColor(ink); c.drawString(cx["cust"], y, str(inv.get("customer_name", "") or "")[:38])
        c.drawRightString(cx["total"], y, _money(total))
        c.setFillColor(colors.HexColor("#16A34A")); c.drawRightString(cx["paid"], y, _money(paid))
        c.setFillColor(ink); c.drawRightString(cx["bal"], y, _money(bal))
        c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(cx["status"] + 6, y, status)
        y -= 18
        if y < 70:
            c.showPage(); y = H - 60; y = header(y); c.setFont("Helvetica", 9)
    c.setStrokeColor(ink); c.setLineWidth(1); c.line(L, y + 3, R, y + 3); y -= 14
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 9)
    c.drawString(cx["num"], y, f"{len(invoices)} invoice(s)")
    c.drawRightString(cx["total"], y, _money(tot))
    c.drawRightString(cx["paid"], y, _money(paid_sum))
    c.drawRightString(cx["bal"], y, _money(bal_sum))
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 40, f"{cname} · Generated {now_iso()[:10]}")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def build_work_order_pdf(wo: dict, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> bytes:
    co = company or {}
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4")
    y = H - 70
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 40, width=150, height=86, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 22); c.drawRightString(R, y, "WORK ORDER")
    c.setFillColor(soft); c.setFont("Helvetica", 11); c.drawRightString(R, y - 16, f"#{wo.get('number', '')}")
    y -= 66
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 30

    eq = wo.get("equipment_type") or ""
    if eq == "Other" and wo.get("equipment_other"):
        eq = f"Other: {wo['equipment_other']}"
    ms, me = wo.get("mileage_start"), wo.get("mileage_end")
    miles = (me - ms) if (ms is not None and me is not None) else None
    rows = [
        ("Customer", wo.get("customer_name") or "—"),
        ("Date", str(wo.get("date") or "")),
        ("Equipment", eq or "—"),
        ("Unit / VIN", wo.get("unit_vin") or "—"),
        ("Mileage start", "—" if ms is None else str(ms)),
        ("Mileage end", "—" if me is None else str(me)),
        ("Miles driven", "—" if miles is None else str(miles)),
        ("Performed by", wo.get("worker_name") or "—"),
    ]
    c.setFont("Helvetica", 11)
    for label, val in rows:
        c.setFillColor(soft); c.drawString(L, y, label.upper())
        c.setFillColor(ink); c.drawString(L + 150, y, str(val))
        y -= 22
    y -= 10
    c.setFillColor(soft); c.setFont("Helvetica-Bold", 10); c.drawString(L, y, "WORK PERFORMED"); y -= 6
    c.setStrokeColor(colors.HexColor("#E5E7EB")); c.setLineWidth(1); c.rect(L, y - 120, R - L, 118, stroke=1, fill=0)
    c.setFillColor(ink); c.setFont("Helvetica", 11)
    text = c.beginText(L + 10, y - 16)
    words = str(wo.get("work_performed") or "").split()
    line = ""
    for w in words:
        if len(line) + len(w) + 1 > 82:
            text.textLine(line); line = w
        else:
            line = (line + " " + w).strip()
    if line:
        text.textLine(line)
    c.drawText(text)
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 70, f"{co.get('company_name') or 'DBG Signs, Inc.'}  ·  Image Is Everything")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def build_statement_pdf(cust: dict, invoices: list, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None, period_label: Optional[str] = None) -> bytes:
    co = company or {}
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4")
    y = H - 70
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 40, width=150, height=86, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 22); c.drawRightString(R, y, "STATEMENT")
    c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawRightString(R, y - 16, datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    if period_label:
        c.setFillColor(ink); c.setFont("Helvetica-Bold", 10); c.drawRightString(R, y - 32, period_label)
    y -= 70
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 26
    c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, y, "ACCOUNT")
    y -= 14; c.setFillColor(ink); c.setFont("Helvetica-Bold", 13)
    c.drawString(L, y, str(cust.get("company") or cust.get("name") or "Customer")); y -= 30
    c.setFillColor(ink); c.rect(L, y - 6, R - L, 24, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 9)
    c.drawString(L + 10, y + 3, "INVOICE"); c.drawString(L + 150, y + 3, "DATE")
    c.drawRightString(R - 140, y + 3, "TOTAL"); c.drawRightString(R - 10, y + 3, "BALANCE")
    y -= 30
    total_bal = 0.0
    c.setFont("Helvetica", 10)
    for i, inv in enumerate(invoices):
        bal = round(float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0), 2)
        total_bal = round(total_bal + bal, 2)
        if i % 2 == 1:
            c.setFillColor(colors.HexColor("#F3F4F6")); c.rect(L, y - 7, R - L, 22, fill=1, stroke=0)
        c.setFillColor(ink); c.setFont("Helvetica", 10)
        c.drawString(L + 10, y, str(inv.get("number", "")))
        c.drawString(L + 150, y, str(inv.get("due_date") or str(inv.get("created_at", ""))[:10]))
        c.drawRightString(R - 140, y, _money(inv.get("total", 0)))
        c.drawRightString(R - 10, y, _money(bal))
        y -= 22
        if y < 120:
            c.showPage(); y = H - 90; c.setFont("Helvetica", 10)
    if not invoices:
        msg = f"No invoices for {period_label}." if period_label else "No open invoices — your account is all paid up. Thank you!"
        c.setFillColor(soft); c.drawString(L + 10, y, msg); y -= 22
    c.setStrokeColor(colors.HexColor("#D1D5DB")); c.setLineWidth(1); c.line(R - 260, y + 4, R, y + 4); y -= 18
    c.setFillColor(ink); c.rect(R - 260, y - 7, 260, 28, fill=1, stroke=0)
    c.setFillColor(cyan); c.rect(R - 260, y - 7, 5, 28, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(R - 244, y + 2, "TOTAL DUE")
    c.setFont("Helvetica-Bold", 14); c.drawRightString(R - 10, y + 1, _money(total_bal))
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 80, f"{co.get('company_name') or 'DBG Signs, Inc.'}  ·  Image Is Everything")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def build_po_pdf(po: dict, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None) -> bytes:
    co = company or {}
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4"); mag = colors.HexColor("#A21CAF")
    y = H - 70
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 40, width=150, height=86, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 22); c.drawRightString(R, y, "PURCHASE ORDER")
    c.setFillColor(mag); c.setFont("Helvetica-Bold", 13); c.drawRightString(R, y - 18, str(po.get("number") or ""))
    c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawRightString(R, y - 33, (po.get("date") or po.get("created_at") or "")[:10])
    y -= 78
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 26
    c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, y, "PAY TO")
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 13); c.drawString(L, y - 15, str(po.get("salesman_name") or "Unassigned"))
    c.setFillColor(soft); c.setFont("Helvetica", 9); c.drawString(L, y - 30, "Sales commission")
    c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawRightString(R, y, "REFERENCE")
    c.setFillColor(ink); c.setFont("Helvetica", 10)
    c.drawRightString(R, y - 15, f"Invoice {po.get('invoice_number') or ''}")
    c.drawRightString(R, y - 29, str(po.get("customer_name") or ""))
    y -= 60
    c.setFillColor(ink); c.rect(L, y - 6, R - L, 22, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 8)
    c.drawString(L + 8, y + 2, "DESCRIPTION"); c.drawRightString(R - 8, y + 2, "AMOUNT")
    y -= 30
    amt = float(po.get("commission_amount") or 0)
    rate = float(po.get("commission_rate") or 0)
    desc = f"Sales commission ({rate}%) for Invoice {po.get('invoice_number') or ''}"
    c.setFillColor(ink); c.setFont("Helvetica", 10)
    c.drawString(L + 8, y, desc[:70]); c.drawRightString(R - 8, y, _money(amt))
    y -= 8
    c.setStrokeColor(colors.HexColor("#D1D5DB")); c.setLineWidth(1); c.line(L, y, R, y); y -= 24
    c.setFillColor(ink); c.rect(R - 260, y - 7, 260, 30, fill=1, stroke=0)
    c.setFillColor(mag); c.rect(R - 260, y - 7, 5, 30, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(R - 244, y + 4, "TOTAL DUE")
    c.setFont("Helvetica-Bold", 15); c.drawRightString(R - 10, y + 2, _money(amt))
    if po.get("notes"):
        y -= 40
        c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, y, "NOTES")
        c.setFillColor(ink); c.setFont("Helvetica", 9)
        for ln in str(po.get("notes"))[:400].split("\n")[:6]:
            y -= 13; c.drawString(L, y, ln[:95])
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 80, f"{co.get('company_name') or 'DBG Signs, Inc.'}  ·  Image Is Everything")
    if po.get("created_by"):
        c.drawString(L, 66, f"Issued by {po.get('created_by')}")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()



def build_commissions_pdf(rows: list, company: Optional[dict] = None, logo_bytes: Optional[bytes] = None, scope_label: str = "") -> bytes:
    co = company or {}
    W, H = letter
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); soft = colors.HexColor("#6B7280"); cyan = colors.HexColor("#06B6D4"); mag = colors.HexColor("#A21CAF")
    y = H - 70
    if logo_bytes:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo_bytes)), L, y - 40, width=150, height=86, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 22); c.drawRightString(R, y, "COMMISSIONS · PAID")
    c.setFillColor(soft); c.setFont("Helvetica", 10); c.drawRightString(R, y - 16, datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    y -= 70
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, y, R, y); y -= 24
    if scope_label:
        c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, y, "SALESMAN")
        y -= 14; c.setFillColor(ink); c.setFont("Helvetica-Bold", 13); c.drawString(L, y, scope_label); y -= 24
    c.setFillColor(ink); c.rect(L, y - 6, R - L, 22, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 8)
    c.drawString(L + 8, y + 2, "ESTIMATE"); c.drawString(L + 92, y + 2, "CUSTOMER")
    c.drawString(L + 232, y + 2, "SALESMAN"); c.drawString(L + 330, y + 2, "PO #")
    c.drawString(L + 408, y + 2, "PAID"); c.drawRightString(R - 8, y + 2, "COMMISSION")
    y -= 28
    total = 0.0
    c.setFont("Helvetica", 9)
    for i, r in enumerate(rows):
        if i % 2 == 1:
            c.setFillColor(colors.HexColor("#F3F4F6")); c.rect(L, y - 7, R - L, 22, fill=1, stroke=0)
        total = round(total + float(r.get("commission_amount") or 0), 2)
        c.setFillColor(ink); c.setFont("Helvetica", 9)
        c.drawString(L + 8, y, str(r.get("number") or "")[:12])
        c.drawString(L + 92, y, str(r.get("customer_name") or "")[:22])
        c.drawString(L + 232, y, str(r.get("salesman_name") or "")[:16])
        c.drawString(L + 330, y, str(r.get("po_number") or "")[:14])
        c.drawString(L + 408, y, str(r.get("paid_at") or "")[:10])
        c.drawRightString(R - 8, y, _money(r.get("commission_amount", 0)))
        y -= 22
        if y < 110:
            c.showPage(); y = H - 90; c.setFont("Helvetica", 9)
    if not rows:
        c.setFillColor(soft); c.drawString(L + 8, y, "No paid commissions on record."); y -= 22
    c.setStrokeColor(colors.HexColor("#D1D5DB")); c.setLineWidth(1); c.line(R - 260, y + 4, R, y + 4); y -= 18
    c.setFillColor(ink); c.rect(R - 260, y - 7, 260, 28, fill=1, stroke=0)
    c.setFillColor(mag); c.rect(R - 260, y - 7, 5, 28, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(R - 244, y + 2, "TOTAL PAID")
    c.setFont("Helvetica-Bold", 14); c.drawRightString(R - 10, y + 1, _money(total))
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    c.drawString(L, 80, f"{co.get('company_name') or 'DBG Signs, Inc.'}  ·  Image Is Everything")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()



def _pdf_response(doc: dict, pdf: bytes, disposition: str = "attachment") -> Response:
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disposition}; filename="{doc.get("number", "document")}.pdf"'})


async def _staff_pdf(collection, doc_id: str, label: str, inline: bool = False) -> Response:
    doc = await get_or_404(collection, doc_id, label)
    await _attach_contact_name(doc)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    pdf = build_doc_pdf(label, doc, clean(cust) if cust else None, await get_logo_bytes(), await get_settings())
    return _pdf_response(doc, pdf, "inline" if inline else "attachment")


@api_router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, inline: bool = False, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.invoices, iid, "Invoice", inline)


async def _accounting_payments_for_invoice(iid: str) -> list:
    out = []
    recs = await db.payment_transactions.find({"payment_status": "paid"}).sort("updated_at", 1).to_list(2000)
    for rec in recs:
        base = {
            "date": rec.get("updated_at") or rec.get("created_at"),
            "method": rec.get("method") or ("Card (Stripe)" if rec.get("payment_intent_id") else "Payment"),
            "reference": rec.get("reference"), "notes": rec.get("notes"),
            "payment_intent_id": rec.get("payment_intent_id"), "surcharge": rec.get("surcharge"),
            "charged": rec.get("charged"), "currency": rec.get("currency"), "recorded_by": rec.get("recorded_by"),
        }
        if rec.get("invoice_id") == iid:
            out.append({**base, "amount": rec.get("amount")})
        for a in (rec.get("allocations") or []):
            if a.get("invoice_id") == iid:
                out.append({**base, "amount": a.get("amount")})
    out.sort(key=lambda x: x["date"] or "")
    return out


@api_router.get("/invoices/{iid}/accounting-pdf")
async def invoice_accounting_pdf(iid: str, inline: bool = False, user: dict = Depends(require_staff)):
    inv = await get_or_404(db.invoices, iid, "Invoice")
    cust = await db.customers.find_one({"_id": oid(inv["customer_id"])}) if inv.get("customer_id") else None
    payments = await _accounting_payments_for_invoice(iid)
    pdf = build_accounting_pdf(clean(inv), clean(cust) if cust else None, payments, await get_settings(), await get_logo_bytes())
    disp = "inline" if inline else "attachment"
    fname = f"Accounting-{inv.get('number', 'invoice')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disp}; filename="{fname}"', "Cache-Control": "no-store"})


@api_router.get("/estimates/{eid}/pdf")
async def estimate_pdf(eid: str, inline: bool = False, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.estimates, eid, "Estimate", inline)


@api_router.get("/sales-orders/{sid}/pdf")
async def sales_order_pdf(sid: str, inline: bool = False, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.sales_orders, sid, "Sales Order", inline)


@api_router.get("/pub/pdf/{token}")
async def public_pdf(token: str):
    rec = await db.pdf_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = await db[rec["collection"]].find_one({"_id": ObjectId(rec["doc_id"])})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _attach_contact_name(doc)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    label = {"invoices": "Invoice", "estimates": "Estimate", "sales_orders": "Sales Order"}.get(rec["collection"], "Document")
    return _pdf_response(doc, build_doc_pdf(label, doc, clean(cust) if cust else None, await get_logo_bytes(), await get_settings()), disposition="inline")


# ---------------------------------------------------------------------------
# Past-due receivables notices
# ---------------------------------------------------------------------------
def _days_overdue(inv: dict) -> int:
    ref = (inv.get("due_date") or str(inv.get("created_at", "")))[:10]
    try:
        d = datetime.strptime(ref, "%Y-%m-%d").date()
    except ValueError:
        return 0
    return (datetime.now(timezone.utc).date() - d).days


def render_past_due_email(inv: dict, customer_name: str, pdf_url: str, open_token: str) -> str:
    od = _days_overdue(inv)
    pixel = f'<img src="{PUBLIC_BASE_URL}/api/track/open/{open_token}" width="1" height="1" alt="" style="display:none" />'
    return (
        f'<table role="presentation" width="100%" style="font-family:Arial,sans-serif;color:#0A0A0A">'
        f'<tr><td style="padding:24px">'
        f'<h2 style="margin:0 0 2px">DBG Signs, Inc.</h2>'
        f'<p style="color:#888;margin:0 0 16px;font-size:12px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</p>'
        f'<p>Hi {escape(customer_name)},</p>'
        f'<p>Our records show invoice <strong>{escape(str(inv.get("number", "")))}</strong> for '
        f'<strong>{_money(inv.get("total", 0))}</strong> is now <strong>{od} days past due</strong>'
        f'{(" (due " + escape(str(inv.get("due_date"))) + ")") if inv.get("due_date") else ""}.</p>'
        f'<p>Please arrange payment at your earliest convenience. A PDF copy of the invoice is available here:</p>'
        f'<p><a href="{pdf_url}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:10px 18px;text-decoration:none">Download invoice (PDF)</a></p>'
        f'<p>If you have already paid, please disregard this notice or reply to let us know.</p>'
        f'<p style="font-size:12px;color:#888">Sent by DBG Signs, Inc. We never ask for your password or card details by email.</p>'
        f'</td></tr></table>{pixel}'
    )


async def _send_past_due(inv: dict) -> dict:
    cust = await db.customers.find_one({"_id": oid(inv["customer_id"])}) if inv.get("customer_id") else None
    to = (cust or {}).get("email")
    if not to:
        return {"number": inv.get("number"), "sent": False, "reason": "no customer email"}
    pdf_token = secrets.token_urlsafe(16)
    open_token = secrets.token_urlsafe(16)
    await db.pdf_tokens.insert_one({"token": pdf_token, "collection": "invoices", "doc_id": str(inv["_id"]), "created_at": now_iso()})
    cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
    html = render_past_due_email(inv, cname, f"{PUBLIC_BASE_URL}/api/pub/pdf/{pdf_token}", open_token)
    email_id = await send_email(to=to, subject=f"Past due notice: Invoice {inv.get('number', '')} - DBG Signs, Inc.", html=html)
    await db.email_tracking.insert_one({"token": open_token, "collection": "invoices", "doc_id": str(inv["_id"]), "created_at": now_iso()})
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {
        "past_due_sent_at": now_iso(), "email_status": "sent", "email_to": to,
        "email_sent_at": now_iso(), "email_opened_at": None, "email_token": open_token, "email_id": email_id,
    }})
    return {"number": inv.get("number"), "sent": True, "to": to}


@api_router.get("/receivables/overdue")
async def overdue_receivables(days: int = 45, user: dict = Depends(require_admin)):
    invoices = await db.invoices.find({"status": {"$ne": "paid"}, "voided": {"$ne": True}}).sort("created_at", 1).to_list(2000)
    out = []
    for inv in invoices:
        inv = await enrich_customer(clean(inv))
        od = _days_overdue(inv)
        if od > days:
            inv["days_overdue"] = od
            out.append(inv)
    return out


@api_router.post("/invoices/{iid}/send-past-due")
async def send_invoice_past_due(iid: str, user: dict = Depends(require_admin)):
    inv = await get_or_404(db.invoices, iid, "Invoice")
    return await _send_past_due(inv)


@api_router.post("/receivables/send-past-due")
async def send_all_past_due(days: int = 45, user: dict = Depends(require_admin)):
    invoices = await db.invoices.find({"status": {"$ne": "paid"}}).to_list(2000)
    sent, skipped = [], []
    for inv in invoices:
        if _days_overdue(clean(dict(inv))) > days:
            res = await _send_past_due(inv)
            (sent if res.get("sent") else skipped).append(res)
    return {"days": days, "sent_count": len(sent), "skipped_count": len(skipped), "sent": sent, "skipped": skipped}


# ---------------------------------------------------------------------------
# Scheduled cron: overdue invoice reminders
# ---------------------------------------------------------------------------
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")


async def _run_overdue_reminders(run_id: str) -> None:
    if await db.cron_runs.find_one({"run_id": run_id}):
        return
    await db.cron_runs.insert_one({"run_id": run_id, "job": "overdue-reminders", "at": now_iso()})
    invoices = await db.invoices.find({"voided": {"$ne": True}, "status": {"$ne": "paid"}}).to_list(5000)
    now = datetime.now(timezone.utc)
    sent = 0
    for inv in invoices:
        if _days_overdue(inv) <= 0:
            continue
        last = inv.get("past_due_sent_at")
        if last:
            try:
                if (now - datetime.fromisoformat(last)).days < 3:
                    continue
            except ValueError:
                pass
        try:
            r = await _send_past_due(inv)
            if r.get("sent"):
                sent += 1
        except Exception as e:
            logger.error(f"Overdue reminder failed for {inv.get('number')}: {e}")
    logger.info(f"Overdue reminder run {run_id}: {sent} email(s) sent")


@api_router.post("/cron/overdue-reminders")
async def cron_overdue_reminders(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not WEBHOOK_CRON_SECRET or not hmac.compare_digest(token, WEBHOOK_CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or (body or {}).get("run_id") or secrets.token_hex(8)
    asyncio.create_task(_run_overdue_reminders(run_id))
    return {"status": "accepted", "run_id": run_id}


# ---------------------------------------------------------------------------
# Site-wide search
# ---------------------------------------------------------------------------
@api_router.get("/search")
async def site_search(q: str, user: dict = Depends(require_staff)):
    q = (q or "").strip()
    if not q:
        return {"results": []}
    rx = {"$regex": re.escape(q), "$options": "i"}
    results = []

    async for d in db.estimates.find({"$or": [{"number": rx}, {"title": rx}, {"line_items.description": rx}]}).limit(6):
        d = await enrich_customer(clean(d))
        results.append({"type": "Estimate", "id": d["id"], "label": d.get("number"),
                        "subtitle": f"{d.get('title', '')} - {d.get('customer_name', '')}", "route": "/estimates"})
    async for d in db.sales_orders.find({"$or": [{"number": rx}, {"title": rx}, {"line_items.description": rx}]}).limit(6):
        d = await enrich_customer(clean(d))
        results.append({"type": "Sales Order", "id": d["id"], "label": d.get("number"),
                        "subtitle": f"{d.get('title', '')} - {d.get('customer_name', '')}", "route": "/sales-orders"})
    async for d in db.invoices.find({"$or": [{"number": rx}, {"title": rx}, {"line_items.description": rx}]}).limit(6):
        d = await enrich_customer(clean(d))
        results.append({"type": "Invoice", "id": d["id"], "label": d.get("number"),
                        "subtitle": f"{d.get('title', '')} - {d.get('customer_name', '')}", "route": "/invoices"})
    async for d in db.customers.find({"$or": [{"name": rx}, {"company": rx}, {"email": rx}]}).limit(6):
        d = clean(d)
        results.append({"type": "Customer", "id": d["id"], "label": d.get("company") or d.get("name"),
                        "subtitle": d.get("email") or d.get("phone") or "", "route": "/customers"})
    async for d in db.materials.find({"$or": [{"name": rx}, {"category": rx}]}).limit(6):
        d = material_out(d)
        results.append({"type": "Material", "id": d["id"], "label": d.get("name"),
                        "subtitle": f"{d.get('category', '')} - {_money(d.get('price_per_sqft', 0))}/sqft", "route": "/materials"})

    if user.get("role") == "admin":
        async for d in db.work_orders.find({"$or": [{"number": rx}, {"work_performed": rx}, {"unit_vin": rx},
                                                     {"equipment_type": rx}, {"equipment_other": rx},
                                                     {"customer_name": rx}, {"worker_name": rx}]}).limit(8):
            d = await enrich_work_order(d)
            eq = d.get("equipment_type") or ""
            if eq == "Other" and d.get("equipment_other"):
                eq = f"Other: {d['equipment_other']}"
            bits = [x for x in [d.get("customer_name"), eq, d.get("unit_vin"), d.get("date")] if x]
            results.append({"type": "Work Order", "id": d["id"], "label": d.get("number"),
                            "subtitle": " · ".join(bits), "route": "/work-orders"})

    return {"results": results}


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await get_settings()  # seed default shop rates
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Shop Owner", "role": "admin", "created_at": now_iso(),
        })
        logger.info("Seeded admin user")
    # NOTE: never auto-overwrite an existing admin's password on restart — that would
    # wipe a password the admin set through the UI. Seeding is idempotent (create-only).
    # seed a demo salesman
    sm_email = "sam@dbgsigns.com"
    if await db.users.find_one({"email": sm_email}) is None:
        await db.users.insert_one({
            "email": sm_email, "password_hash": hash_password("Sales2026!"),
            "name": "Sam Salesman", "role": "salesman", "commission_rate": 10.0,
            "created_at": now_iso(),
        })
        logger.info("Seeded demo salesman")
    # seed a demo installer / service worker
    inst_email = "service@dbgsigns.com"
    if await db.users.find_one({"email": inst_email}) is None:
        await db.users.insert_one({
            "email": inst_email, "password_hash": hash_password("Service2026!"),
            "name": "Service Tech", "role": "installer", "created_at": now_iso(),
        })
        logger.info("Seeded demo installer")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)

_cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins == "*":
    # Credentialed CORS cannot use a literal "*"; reflect the request origin instead.
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    _origins = [x.strip() for x in _cors_origins.split(",") if x.strip()] or \
        [os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"]
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
