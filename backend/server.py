from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import secrets
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
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from bson import ObjectId
from pymongo import ReturnDocument
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, BeforeValidator, ConfigDict

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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
    material_id: Optional[str] = None
    width_in: float = 0.0
    height_in: float = 0.0
    quantity: float = 1
    price_per_sqft: float = 0.0
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
    portal_enabled: bool = False


class MaterialInput(BaseModel):
    name: str
    category: Optional[str] = None
    unit: str = "roll"  # roll / sheet / each
    buying_cost: float = 0.0        # cost per purchased unit (roll/sheet)
    conversion_factor: float = 1.0  # usable sqft per purchased unit
    markup: float = 0.0             # percent markup on cost
    stock: Optional[float] = None
    supplier: Optional[str] = None
    image_url: Optional[str] = None


class EstimateInput(BaseModel):
    customer_id: str
    title: str
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    notes: Optional[str] = None
    status: str = "draft"  # draft, sent, approved, rejected
    commission_rate: float = 0.0
    salesman_id: Optional[str] = None
    salesman_name: Optional[str] = None


class InvoiceInput(BaseModel):
    customer_id: str
    title: str
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    notes: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "unpaid"  # unpaid, paid, partial, overdue


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
    default_markup: float = 40.0


class StaffInput(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    name: str
    role: str = "salesman"  # admin | salesman
    commission_rate: float = 0.0


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


DEFAULT_SETTINGS = {"shop_rate_per_hr": 65.0, "shop_sqft_per_hr": 150.0, "machine_rate_per_hr": 35.0, "machine_sqft_per_hr": 150.0, "default_markup": 40.0}


async def get_settings() -> dict:
    s = await db.settings.find_one({"key": "shop"})
    if not s:
        await db.settings.insert_one({"key": "shop", **DEFAULT_SETTINGS})
        return dict(DEFAULT_SETTINGS)
    return {k: float(s.get(k, v)) for k, v in DEFAULT_SETTINGS.items()}


def material_out(doc: dict) -> dict:
    d = clean(doc)
    bc = float(d.get("buying_cost") or 0)
    cf = float(d.get("conversion_factor") or 0)
    mk = float(d.get("markup") or 0)
    cost_per_sqft = round(bc / cf, 4) if cf else 0.0
    d["cost_per_sqft"] = cost_per_sqft
    d["price_per_sqft"] = round(cost_per_sqft * (1 + mk / 100.0), 4)
    return d


def compute_line(li: dict, s: dict) -> dict:
    w = float(li.get("width_in") or 0)
    h = float(li.get("height_in") or 0)
    qty = float(li.get("quantity") or 0)
    # If width & height given, area = (W*H/144)*qty; otherwise qty acts as sqft
    area = round((w * h / 144.0) * qty, 4) if (w > 0 and h > 0) else round(qty, 4)
    pps = float(li.get("price_per_sqft") or 0)
    material_cost = round(pps * area, 2)
    # Machine + shop time derived from throughput (sqft/hr); round currency not hours
    m_sqft = float(s.get("machine_sqft_per_hr") or 0)
    machine_hours_raw = area / m_sqft if m_sqft else 0.0
    machine_cost = round(machine_hours_raw * float(s.get("machine_rate_per_hr") or 0), 2)
    sh_sqft = float(s.get("shop_sqft_per_hr") or 0)
    labor_hours_raw = (area / sh_sqft if sh_sqft else 0.0) + float(li.get("extra_labor_hours") or 0)
    labor_cost = round(labor_hours_raw * float(s.get("shop_rate_per_hr") or 0), 2)
    line_total = round(material_cost + labor_cost + machine_cost, 2)
    item = dict(li)
    item.update({
        "area_sqft": area,
        "machine_hours": round(machine_hours_raw, 4),
        "labor_hours": round(labor_hours_raw, 4),
        "material_cost": material_cost,
        "labor_cost": labor_cost,
        "machine_cost": machine_cost,
        "line_total": line_total,
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
    items = [compute_line(li, s) for li in line_items]
    subtotal = round(sum(i["line_total"] for i in items), 2)
    discount_amount = round(subtotal * (discount_rate / 100.0), 2)
    discounted = round(subtotal - discount_amount, 2)
    tax_amount = round(discounted * (tax_rate / 100.0), 2)
    total = round(discounted + tax_amount, 2)
    return {
        "line_items": items, "subtotal": subtotal,
        "discount_rate": discount_rate, "discount_amount": discount_amount,
        "tax_amount": tax_amount, "total": total,
    }


async def next_number(prefix: str, key: str, collection) -> str:
    ctr = await db.counters.find_one({"_id": key})
    if not ctr:
        base = 0
        cursor = collection.find({"number": {"$regex": f"^{prefix}-"}}, {"number": 1})
        async for d in cursor:
            try:
                base = max(base, int(str(d["number"]).split("-")[1]))
            except (IndexError, ValueError):
                pass
        await db.counters.insert_one({"_id": key, "seq": base})
    r = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER
    )
    return f"{prefix}-{r['seq']:04d}"


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
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user.get("name"), "role": user.get("role")}


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
async def list_customers(user: dict = Depends(require_staff)):
    docs = await db.customers.find().sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@api_router.post("/customers")
async def create_customer(payload: CustomerInput, user: dict = Depends(require_staff)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    res = await db.customers.insert_one(doc)
    return clean(await db.customers.find_one({"_id": res.inserted_id}))


@api_router.put("/customers/{cid}")
async def update_customer(cid: str, payload: CustomerInput, user: dict = Depends(require_staff)):
    await get_or_404(db.customers, cid, "Customer")
    await db.customers.update_one({"_id": oid(cid)}, {"$set": payload.model_dump()})
    return clean(await db.customers.find_one({"_id": oid(cid)}))


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_admin)):
    res = await db.customers.delete_one({"_id": oid(cid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"message": "deleted"}


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
async def delete_material(mid: str, user: dict = Depends(require_admin)):
    res = await db.materials.delete_one({"_id": oid(mid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Material not found")
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


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------
async def enrich_customer(doc: dict) -> dict:
    cust = await db.customers.find_one({"_id": ObjectId(doc["customer_id"])}) if doc.get("customer_id") else None
    doc["customer_name"] = cust.get("company") or cust.get("name") if cust else "Unknown"
    return doc


@api_router.get("/estimates")
async def list_estimates(user: dict = Depends(require_staff)):
    docs = await db.estimates.find().sort("created_at", -1).to_list(1000)
    return [await enrich_customer(clean(d)) for d in docs]


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
    doc["commission_rate"] = rate
    doc["commission_amount"] = round(float(doc.get("subtotal") or 0) * rate / 100.0, 2)
    return doc


@api_router.post("/estimates")
async def create_estimate(payload: EstimateInput, user: dict = Depends(require_staff)):
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    await apply_commission(doc, user)
    doc["number"] = await next_number("EST", "estimates", db.estimates)
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
async def delete_estimate(eid: str, user: dict = Depends(require_staff)):
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
        "title": est["title"],
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
        "number": await next_number("SO", "sales_orders", db.sales_orders),
        "from_estimate": est.get("number"),
        "estimate_id": str(est["_id"]),
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
    return [await enrich_customer(clean(d)) for d in docs]


@api_router.patch("/sales-orders/{sid}/status")
async def set_so_status(sid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("open", "in_production", "fulfilled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.sales_orders, sid, "Sales order")
    await db.sales_orders.update_one({"_id": oid(sid)}, {"$set": {"status": status}})
    return await enrich_customer(clean(await db.sales_orders.find_one({"_id": oid(sid)})))


@api_router.delete("/sales-orders/{sid}")
async def delete_sales_order(sid: str, user: dict = Depends(require_staff)):
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
        "title": so["title"],
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
        "number": await next_number("INV", "invoices", db.invoices),
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
    return [await enrich_customer(clean(d)) for d in docs]


@api_router.post("/invoices")
async def create_invoice(payload: InvoiceInput, user: dict = Depends(require_staff)):
    disc = await customer_discount(payload.customer_id)
    totals = await compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate, disc)
    doc = payload.model_dump()
    doc.update(totals)
    doc["number"] = await next_number("INV", "invoices", db.invoices)
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


@api_router.patch("/invoices/{iid}/status")
async def set_invoice_status(iid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("unpaid", "partial", "paid", "overdue"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.invoices, iid, "Invoice")
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": {"status": status, "paid_at": now_iso() if status == "paid" else None}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.delete("/invoices/{iid}")
async def delete_invoice(iid: str, user: dict = Depends(require_admin)):
    res = await db.invoices.delete_one({"_id": oid(iid)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "deleted"}


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
async def delete_bill(bid: str, user: dict = Depends(require_admin)):
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
    docs = await db.users.find({"role": {"$in": ["admin", "salesman"]}}).sort("name", 1).to_list(1000)
    return [user_out(d) for d in docs]


@api_router.post("/users")
async def create_user(payload: StaffInput, user: dict = Depends(require_admin)):
    email = payload.email.lower()
    if payload.role not in ("admin", "salesman"):
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
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    return user_out(await db.users.find_one({"_id": res.inserted_id}))


@api_router.put("/users/{uid}")
async def update_user(uid: str, payload: StaffInput, user: dict = Depends(require_admin)):
    await get_or_404(db.users, uid, "User")
    update = {"name": payload.name, "role": payload.role, "commission_rate": float(payload.commission_rate or 0)}
    if payload.password:
        update["password_hash"] = hash_password(payload.password)
    await db.users.update_one({"_id": oid(uid)}, {"$set": update})
    return user_out(await db.users.find_one({"_id": oid(uid)}))


@api_router.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_admin)):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    res = await db.users.delete_one({"_id": oid(uid), "role": {"$in": ["admin", "salesman"]}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
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
    for e in ests:
        e = await enrich_customer(clean(e))
        base = float(e.get("subtotal") or 0)
        rate = float(e.get("commission_rate") or 0)
        amt = float(e.get("commission_amount") or round(base * rate / 100.0, 2))
        earned = e.get("status") == "approved" or bool(e.get("sales_order_id"))
        name = e.get("salesman_name") or "Unassigned"
        rows.append({
            "id": e["id"], "number": e.get("number"), "title": e.get("title"),
            "customer_name": e.get("customer_name"), "salesman_name": name,
            "status": e.get("status"), "base": round(base, 2), "commission_rate": rate,
            "commission_amount": round(amt, 2), "earned": earned,
        })
        agg = by_salesman.setdefault(name, {"salesman_name": name, "earned": 0.0, "pending": 0.0, "count": 0})
        agg["count"] += 1
        if earned:
            agg["earned"] += amt
            total_earned += amt
        else:
            agg["pending"] += amt
            total_pending += amt
    for a in by_salesman.values():
        a["earned"] = round(a["earned"], 2)
        a["pending"] = round(a["pending"], 2)
    return {
        "rows": rows,
        "by_salesman": sorted(by_salesman.values(), key=lambda x: x["earned"] + x["pending"], reverse=True),
        "total_earned": round(total_earned, 2),
        "total_pending": round(total_pending, 2),
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard")
async def dashboard(user: dict = Depends(require_staff)):
    invoices = await db.invoices.find().to_list(2000)
    bills = await db.bills.find().to_list(2000)
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


# ---------------------------------------------------------------------------
# Customer portal
# ---------------------------------------------------------------------------
async def current_customer(user: dict) -> Optional[dict]:
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
    invoices = await db.invoices.find({"customer_id": cid}).sort("created_at", -1).to_list(500)
    reorders = await db.reorders.find({"customer_id": cid}).sort("created_at", -1).to_list(500)
    return {
        "customer": clean(cust),
        "invoices": [clean(i) for i in invoices],
        "reorders": [clean(r) for r in reorders],
    }


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


@api_router.get("/reorders")
async def list_reorders(user: dict = Depends(require_staff)):
    docs = await db.reorders.find().sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@api_router.patch("/reorders/{rid}/status")
async def set_reorder_status(rid: str, status: str, user: dict = Depends(require_staff)):
    if status not in ("requested", "processing", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_or_404(db.reorders, rid, "Reorder")
    await db.reorders.update_one({"_id": oid(rid)}, {"$set": {"status": status}})
    return clean(await db.reorders.find_one({"_id": oid(rid)}))


# ---------------------------------------------------------------------------
# Email documents + read receipts (Emergent-managed Resend)
# ---------------------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "DBG Signs, Inc.")
PUBLIC_BASE_URL = os.environ.get("FRONTEND_URL", "")
LOGO_PATH = ROOT_DIR / "assets" / "dbg_logo.jpg"
LOGO_URL = "https://static.prod-images.emergentagent.com/jobs/ec6bd2ae-6f93-4a9d-865b-45f84531fa3f/images/1ba95998d22f513a4203664781b3ee2951299feaef457d27f5664136525cb3e9.jpeg"

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


def render_doc_email(kind_label: str, doc: dict, customer_name: str, token: str) -> str:
    sub_raw = float(doc.get("subtotal", 0))
    disc_amt = float(doc.get("discount_amount", 0))
    factor = (sub_raw - disc_amt) / sub_raw if sub_raw else 1.0
    rows = ""
    for i, li in enumerate(doc.get("line_items", [])):
        bg = "#F7F7F8" if i % 2 else "#ffffff"
        rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:10px 14px;border-bottom:1px solid #eee">{escape(str(li.get("description", "")))}</td>'
            f'<td align="right" style="padding:10px 14px;border-bottom:1px solid #eee;color:#6B7280">{li.get("area_sqft", 0)} sqft</td>'
            f'<td align="right" style="padding:10px 14px;border-bottom:1px solid #eee">{_money(li.get("line_total", 0) * factor)}</td></tr>'
        )
    pixel = f'<img src="{PUBLIC_BASE_URL}/api/track/open/{token}" width="1" height="1" alt="" style="display:none" />'
    net_subtotal = round(float(doc.get("subtotal", 0)) - float(doc.get("discount_amount", 0)), 2)
    label = "Amount Due" if kind_label == "Invoice" else "Total"
    due = f'<span style="color:#6B7280;font-size:12px">Due {escape(str(doc.get("due_date")))}</span>' if doc.get("due_date") else ""
    return (
        f'<div style="background:#F0F1F3;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#0A0A0A">'
        f'<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB">'
        # Header
        f'<tr><td style="padding:28px 32px 0"><table role="presentation" width="100%"><tr>'
        f'<td><img src="{LOGO_URL}" alt="DBG Signs, Inc." height="46" style="height:46px;display:block" /></td>'
        f'<td align="right"><div style="font-size:22px;font-weight:bold;letter-spacing:1px">{escape(kind_label.upper())}</div>'
        f'<div style="color:#6B7280;font-size:13px">#{escape(str(doc.get("number", "")))}</div>{due}</td>'
        f'</tr></table></td></tr>'
        f'<tr><td style="padding:14px 32px 0"><div style="height:3px;background:#06B6D4"></div></td></tr>'
        # Greeting + bill to
        f'<tr><td style="padding:20px 32px 0">'
        f'<div style="font-size:10px;letter-spacing:2px;color:#6B7280;text-transform:uppercase">Bill To</div>'
        f'<div style="font-size:15px;font-weight:bold;margin-top:2px">{escape(customer_name)}</div>'
        f'<p style="margin:16px 0 0">Please find your {escape(kind_label.lower())} for <strong>{escape(str(doc.get("title", "")))}</strong> below.</p>'
        f'</td></tr>'
        # Table
        f'<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" style="border-collapse:collapse">'
        f'<tr style="background:#0A0A0A;color:#fff">'
        f'<th align="left" style="padding:10px 14px;font-size:11px;letter-spacing:1px">DESCRIPTION</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">SQFT USED</th>'
        f'<th align="right" style="padding:10px 14px;font-size:11px;letter-spacing:1px">AMOUNT</th></tr>'
        f'{rows}'
        f'<tr><td></td><td align="right" style="padding:10px 14px;color:#6B7280">Subtotal</td>'
        f'<td align="right" style="padding:10px 14px">{_money(net_subtotal)}</td></tr>'
        f'<tr><td></td><td align="right" style="padding:6px 14px;color:#6B7280">Tax ({doc.get("tax_rate", 0)}%)</td>'
        f'<td align="right" style="padding:6px 14px">{_money(doc.get("tax_amount", 0))}</td></tr>'
        f'<tr><td></td><td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold">{label}</td>'
        f'<td align="right" style="padding:12px 14px;background:#0A0A0A;color:#fff;font-weight:bold;font-size:16px">{_money(doc.get("total", 0))}</td></tr>'
        f'</table></td></tr>'
        # Footer
        f'<tr><td style="padding:22px 32px 28px">'
        f'<p style="margin:0 0 4px">Questions about this {escape(kind_label.lower())}? Just reply to this email.</p>'
        f'<div style="border-top:1px solid #E5E7EB;margin-top:14px;padding-top:12px">'
        f'<div style="font-weight:bold">DBG Signs, Inc.</div>'
        f'<div style="color:#6B7280;font-size:11px;letter-spacing:2px;text-transform:uppercase">Image Is Everything</div>'
        f'<div style="color:#9CA3AF;font-size:11px;margin-top:8px">We never ask for your password or card details by email.</div>'
        f'</div></td></tr>'
        f'</table></div>{pixel}'
    )


async def _send_document(collection, doc_id: str, kind_label: str) -> dict:
    doc = await get_or_404(collection, doc_id, kind_label)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    to = (cust or {}).get("email")
    if not to:
        raise HTTPException(status_code=400, detail="This customer has no email address on file")
    cname = (cust.get("company") or cust.get("name")) if cust else "Customer"
    token = secrets.token_urlsafe(16)
    html = render_doc_email(kind_label, doc, cname, token)
    email_id = await send_email(to=to, subject=f"{kind_label} {doc.get('number', '')} from DBG Signs, Inc.", html=html)
    await db.email_tracking.insert_one({"token": token, "collection": collection.name, "doc_id": str(doc["_id"]), "created_at": now_iso()})
    await collection.update_one({"_id": oid(doc_id)}, {"$set": {
        "email_status": "sent", "email_to": to, "email_sent_at": now_iso(),
        "email_opened_at": None, "email_token": token, "email_id": email_id,
    }})
    return {"status": "sent", "to": to}


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
def build_doc_pdf(kind_label: str, doc: dict, customer: Optional[dict]) -> bytes:
    buf = io.BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    W, H = letter
    L, R = 54, W - 54
    ink = colors.HexColor("#0A0A0A"); cyan = colors.HexColor("#06B6D4")
    grayline = colors.HexColor("#E5E7EB"); soft = colors.HexColor("#6B7280"); rowbg = colors.HexColor("#F7F7F8")
    ax = R  # right edge for amounts
    sub_raw = float(doc.get("subtotal", 0))
    disc_amt = float(doc.get("discount_amount", 0))
    factor = (sub_raw - disc_amt) / sub_raw if sub_raw else 1.0

    # Logo (top-left)
    try:
        c.drawImage(ImageReader(str(LOGO_PATH)), L, H - 150, width=180, height=104,
                    preserveAspectRatio=True, mask="auto", anchor="sw")
    except Exception:
        c.setFillColor(ink); c.setFont("Helvetica-Bold", 20); c.drawString(L, H - 96, "DBG Signs, Inc.")

    # Document label + number (top-right)
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 28); c.drawRightString(R, H - 82, kind_label.upper())
    c.setFillColor(soft); c.setFont("Helvetica", 11); c.drawRightString(R, H - 100, f"#{doc.get('number', '')}")

    # Accent rule
    c.setStrokeColor(cyan); c.setLineWidth(3); c.line(L, H - 162, R, H - 162)

    y = H - 196
    # Meta (right)
    meta = [("Date", str(doc.get("created_at", ""))[:10])]
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
    c.drawRightString(ax - 150, y + 3, "SQFT USED")
    c.drawRightString(ax - 10, y + 3, "AMOUNT")
    y -= 30

    c.setFont("Helvetica", 10)
    for i, li in enumerate(doc.get("line_items", [])):
        rh = 22
        if i % 2 == 1:
            c.setFillColor(rowbg); c.rect(L, y - 7, R - L, rh, fill=1, stroke=0)
        c.setFillColor(ink)
        c.drawString(L + 10, y, str(li.get("description", ""))[:58])
        c.drawRightString(ax - 150, y, f"{li.get('area_sqft', 0)}")
        c.drawRightString(ax - 10, y, _money(li.get("line_total", 0) * factor))
        y -= rh
        if y < 170:
            c.showPage(); y = H - 90; c.setFont("Helvetica", 10)

    # Totals (discount hidden; subtotal shown net of any discount so it reconciles)
    net_subtotal = round(float(doc.get("subtotal", 0)) - float(doc.get("discount_amount", 0)), 2)
    c.setStrokeColor(grayline); c.setLineWidth(1); c.line(ax - 230, y + 2, R, y + 2); y -= 16
    c.setFont("Helvetica", 10); c.setFillColor(soft); c.drawRightString(ax - 100, y, "Subtotal")
    c.setFillColor(ink); c.drawRightString(ax - 10, y, _money(net_subtotal)); y -= 16
    c.setFillColor(soft); c.drawRightString(ax - 100, y, f"Tax ({doc.get('tax_rate', 0)}%)")
    c.setFillColor(ink); c.drawRightString(ax - 10, y, _money(doc.get("tax_amount", 0))); y -= 26
    label = "AMOUNT DUE" if kind_label == "Invoice" else "TOTAL"
    c.setFillColor(ink); c.rect(ax - 230, y - 7, 230, 28, fill=1, stroke=0)
    c.setFillColor(cyan); c.rect(ax - 230, y - 7, 5, 28, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 11); c.drawString(ax - 214, y + 2, label)
    c.setFont("Helvetica-Bold", 14); c.drawRightString(ax - 10, y + 1, _money(doc.get("total", 0)))

    # Footer
    fy = 88
    c.setStrokeColor(grayline); c.setLineWidth(1); c.line(L, fy + 24, R, fy + 24)
    c.setFillColor(soft); c.setFont("Helvetica", 8)
    tline = f"Payment terms: {terms}.  " if terms else ""
    c.drawString(L, fy + 10, f"{tline}Thank you for your business.")
    c.setFillColor(ink); c.setFont("Helvetica-Bold", 9); c.drawString(L, fy - 5, "DBG Signs, Inc.")
    c.setFillColor(soft); c.setFont("Helvetica", 8); c.drawString(L, fy - 17, "Image Is Everything")
    c.showPage(); c.save(); buf.seek(0)
    return buf.getvalue()


def _pdf_response(doc: dict, pdf: bytes, disposition: str = "attachment") -> Response:
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disposition}; filename="{doc.get("number", "document")}.pdf"'})


async def _staff_pdf(collection, doc_id: str, label: str) -> Response:
    doc = await get_or_404(collection, doc_id, label)
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    return _pdf_response(doc, build_doc_pdf(label, doc, clean(cust) if cust else None))


@api_router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.invoices, iid, "Invoice")


@api_router.get("/estimates/{eid}/pdf")
async def estimate_pdf(eid: str, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.estimates, eid, "Estimate")


@api_router.get("/sales-orders/{sid}/pdf")
async def sales_order_pdf(sid: str, user: dict = Depends(require_staff)):
    return await _staff_pdf(db.sales_orders, sid, "Sales Order")


@api_router.get("/pub/pdf/{token}")
async def public_pdf(token: str):
    rec = await db.pdf_tokens.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = await db[rec["collection"]].find_one({"_id": ObjectId(rec["doc_id"])})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    cust = await db.customers.find_one({"_id": oid(doc["customer_id"])}) if doc.get("customer_id") else None
    label = {"invoices": "Invoice", "estimates": "Estimate", "sales_orders": "Sales Order"}.get(rec["collection"], "Document")
    return _pdf_response(doc, build_doc_pdf(label, doc, clean(cust) if cust else None), disposition="inline")


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
async def overdue_receivables(days: int = 45, user: dict = Depends(require_staff)):
    invoices = await db.invoices.find({"status": {"$ne": "paid"}}).sort("created_at", 1).to_list(2000)
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
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}})
    # seed a demo salesman
    sm_email = "sam@dbgsigns.com"
    if await db.users.find_one({"email": sm_email}) is None:
        await db.users.insert_one({
            "email": sm_email, "password_hash": hash_password("Sales2026!"),
            "name": "Sam Salesman", "role": "salesman", "commission_rate": 10.0,
            "created_at": now_iso(),
        })
        logger.info("Seeded demo salesman")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
