from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated

import bcrypt
import jwt
from bson import ObjectId
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
    if user.get("role") not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Staff access required")
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
    description: str
    material_id: Optional[str] = None
    quantity: float = 1
    unit_price: float = 0.0

    @property
    def line_total(self) -> float:
        return round(self.quantity * self.unit_price, 2)


class CustomerInput(BaseModel):
    name: str
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class MaterialInput(BaseModel):
    name: str
    category: Optional[str] = None
    unit: str = "sqft"
    cost: float = 0.0
    price: float = 0.0
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


def compute_totals(line_items: List[dict], tax_rate: float) -> dict:
    subtotal = 0.0
    items = []
    for li in line_items:
        lt = round(float(li.get("quantity", 1)) * float(li.get("unit_price", 0)), 2)
        item = dict(li)
        item["line_total"] = lt
        items.append(item)
        subtotal += lt
    subtotal = round(subtotal, 2)
    tax_amount = round(subtotal * (tax_rate / 100.0), 2)
    total = round(subtotal + tax_amount, 2)
    return {"line_items": items, "subtotal": subtotal, "tax_amount": tax_amount, "total": total}


async def next_number(prefix: str, collection) -> str:
    count = await collection.count_documents({})
    return f"{prefix}-{count + 1:04d}"


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
        "user_id": uid, "created_at": now_iso(),
    })
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": payload.name, "role": "customer"}


@api_router.post("/auth/login")
async def login(payload: LoginInput, response: Response, request: Request):
    email = payload.email.lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
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
    await db.customers.update_one({"_id": oid(cid)}, {"$set": payload.model_dump()})
    return clean(await db.customers.find_one({"_id": oid(cid)}))


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_staff)):
    await db.customers.delete_one({"_id": oid(cid)})
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
@api_router.get("/materials")
async def list_materials(user: dict = Depends(require_staff)):
    docs = await db.materials.find().sort("name", 1).to_list(1000)
    return [clean(d) for d in docs]


@api_router.post("/materials")
async def create_material(payload: MaterialInput, user: dict = Depends(require_staff)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    res = await db.materials.insert_one(doc)
    return clean(await db.materials.find_one({"_id": res.inserted_id}))


@api_router.put("/materials/{mid}")
async def update_material(mid: str, payload: MaterialInput, user: dict = Depends(require_staff)):
    await db.materials.update_one({"_id": oid(mid)}, {"$set": payload.model_dump()})
    return clean(await db.materials.find_one({"_id": oid(mid)}))


@api_router.delete("/materials/{mid}")
async def delete_material(mid: str, user: dict = Depends(require_staff)):
    await db.materials.delete_one({"_id": oid(mid)})
    return {"message": "deleted"}


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


@api_router.post("/estimates")
async def create_estimate(payload: EstimateInput, user: dict = Depends(require_staff)):
    totals = compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate)
    doc = payload.model_dump()
    doc.update(totals)
    doc["number"] = await next_number("EST", db.estimates)
    doc["created_at"] = now_iso()
    res = await db.estimates.insert_one(doc)
    return await enrich_customer(clean(await db.estimates.find_one({"_id": res.inserted_id})))


@api_router.put("/estimates/{eid}")
async def update_estimate(eid: str, payload: EstimateInput, user: dict = Depends(require_staff)):
    totals = compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate)
    doc = payload.model_dump()
    doc.update(totals)
    await db.estimates.update_one({"_id": oid(eid)}, {"$set": doc})
    return await enrich_customer(clean(await db.estimates.find_one({"_id": oid(eid)})))


@api_router.delete("/estimates/{eid}")
async def delete_estimate(eid: str, user: dict = Depends(require_staff)):
    await db.estimates.delete_one({"_id": oid(eid)})
    return {"message": "deleted"}


@api_router.post("/estimates/{eid}/convert")
async def convert_estimate(eid: str, user: dict = Depends(require_staff)):
    est = await db.estimates.find_one({"_id": oid(eid)})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    doc = {
        "customer_id": est["customer_id"],
        "title": est["title"],
        "line_items": est["line_items"],
        "tax_rate": est.get("tax_rate", 0),
        "subtotal": est.get("subtotal", 0),
        "tax_amount": est.get("tax_amount", 0),
        "total": est.get("total", 0),
        "notes": est.get("notes"),
        "status": "unpaid",
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat(),
        "number": await next_number("INV", db.invoices),
        "from_estimate": est.get("number"),
        "created_at": now_iso(),
    }
    res = await db.invoices.insert_one(doc)
    await db.estimates.update_one({"_id": oid(eid)}, {"$set": {"status": "approved"}})
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
    totals = compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate)
    doc = payload.model_dump()
    doc.update(totals)
    doc["number"] = await next_number("INV", db.invoices)
    doc["created_at"] = now_iso()
    res = await db.invoices.insert_one(doc)
    return await enrich_customer(clean(await db.invoices.find_one({"_id": res.inserted_id})))


@api_router.put("/invoices/{iid}")
async def update_invoice(iid: str, payload: InvoiceInput, user: dict = Depends(require_staff)):
    totals = compute_totals([li.model_dump() for li in payload.line_items], payload.tax_rate)
    doc = payload.model_dump()
    doc.update(totals)
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": doc})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.patch("/invoices/{iid}/status")
async def set_invoice_status(iid: str, status: str, user: dict = Depends(require_staff)):
    await db.invoices.update_one({"_id": oid(iid)}, {"$set": {"status": status, "paid_at": now_iso() if status == "paid" else None}})
    return await enrich_customer(clean(await db.invoices.find_one({"_id": oid(iid)})))


@api_router.delete("/invoices/{iid}")
async def delete_invoice(iid: str, user: dict = Depends(require_staff)):
    await db.invoices.delete_one({"_id": oid(iid)})
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Bills (Accounts Payable)
# ---------------------------------------------------------------------------
@api_router.get("/bills")
async def list_bills(user: dict = Depends(require_staff)):
    docs = await db.bills.find().sort("created_at", -1).to_list(1000)
    return [clean(d) for d in docs]


@api_router.post("/bills")
async def create_bill(payload: BillInput, user: dict = Depends(require_staff)):
    doc = payload.model_dump()
    doc["number"] = await next_number("BILL", db.bills)
    doc["created_at"] = now_iso()
    res = await db.bills.insert_one(doc)
    return clean(await db.bills.find_one({"_id": res.inserted_id}))


@api_router.put("/bills/{bid}")
async def update_bill(bid: str, payload: BillInput, user: dict = Depends(require_staff)):
    await db.bills.update_one({"_id": oid(bid)}, {"$set": payload.model_dump()})
    return clean(await db.bills.find_one({"_id": oid(bid)}))


@api_router.patch("/bills/{bid}/status")
async def set_bill_status(bid: str, status: str, user: dict = Depends(require_staff)):
    await db.bills.update_one({"_id": oid(bid)}, {"$set": {"status": status, "paid_at": now_iso() if status == "paid" else None}})
    return clean(await db.bills.find_one({"_id": oid(bid)}))


@api_router.delete("/bills/{bid}")
async def delete_bill(bid: str, user: dict = Depends(require_staff)):
    await db.bills.delete_one({"_id": oid(bid)})
    return {"message": "deleted"}


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
    return {
        "receivable": round(receivable, 2),
        "collected": round(collected, 2),
        "payable": round(payable, 2),
        "net_cash": round(collected - sum(b.get("amount", 0) for b in bills if b.get("status") == "paid"), 2),
        "open_estimates": est_count,
        "invoice_count": len(invoices),
        "customer_count": await db.customers.count_documents({}),
        "material_count": await db.materials.count_documents({}),
    }


# ---------------------------------------------------------------------------
# Xero CSV export
# ---------------------------------------------------------------------------
def csv_response(rows: List[List[str]], filename: str) -> Response:
    import io, csv
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
        items = inv.get("line_items") or [{"description": inv.get("title"), "quantity": 1, "unit_price": inv.get("total", 0)}]
        for li in items:
            rows.append([
                inv.get("customer_name", ""), inv.get("number", ""), inv_date, due,
                li.get("description", ""), li.get("quantity", 1), li.get("unit_price", 0),
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
    await db.reorders.update_one({"_id": oid(rid)}, {"$set": {"status": status}})
    return clean(await db.reorders.find_one({"_id": oid(rid)}))


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
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
