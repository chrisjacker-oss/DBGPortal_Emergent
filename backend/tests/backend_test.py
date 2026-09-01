import os
import re
import csv
import io
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"


def creds():
    p = Path("/app/memory/test_credentials.md")
    c = p.read_text()
    e = re.search(r'(?im)^\s*(?:[-*]\s*)?(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)', c)
    pw = re.search(r'(?im)^\s*(?:[-*]\s*)?(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)', c)
    if not e or not pw:
        pytest.skip("no creds")
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    c = creds()
    r = s.post(f"{BASE}/auth/login", json=c, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    return s


@pytest.fixture(scope="session")
def customer():
    """Register a fresh customer account (role must be customer)."""
    s = requests.Session()
    email = f"TEST_cust_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE}/auth/register", json={"email": email, "password": "CustPass2026!", "name": "TEST_Customer Co", "company": "TEST_Co"}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"register failed {r.status_code}: {r.text[:300]}")
    return s, email, r.json()


# --- Auth module ---
class TestAuth:
    def test_login_success_sets_httponly_cookies(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/login", json=creds(), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "admin"
        assert d["email"] == creds()["email"].lower()
        raw = r.headers.get("set-cookie", "")
        assert "access_token" in raw and "HttpOnly" in raw, raw
        assert "access_token" in s.cookies

    def test_me(self, admin):
        r = admin.get(f"{BASE}/auth/me", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin"
        assert "password_hash" not in d and "_id" not in d
        assert isinstance(d["id"], str)

    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_invalid_password(self):
        r = requests.post(f"{BASE}/auth/login", json={"email": creds()["email"], "password": "wrong-pass-xyz"}, timeout=30)
        assert r.status_code in (401, 429)

    def test_refresh(self, admin):
        r = admin.post(f"{BASE}/auth/refresh", timeout=30)
        assert r.status_code == 200
        assert "refreshed" in r.text

    def test_duplicate_register_rejected(self, customer):
        _, email, _ = customer
        r = requests.post(f"{BASE}/auth/register", json={"email": email, "password": "x12345678", "name": "dup"}, timeout=30)
        assert r.status_code == 400

    def test_register_role_is_customer(self, customer):
        _, _, data = customer
        assert data["role"] == "customer"

    def test_bcrypt_hash_format(self):
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import dotenv_values as dv
        env = dv("/app/backend/.env")

        async def go():
            cl = AsyncIOMotorClient(env["MONGO_URL"])
            u = await cl[env["DB_NAME"]].users.find_one({"email": creds()["email"].lower()})
            cl.close()
            return u
        u = asyncio.get_event_loop().run_until_complete(go()) if False else asyncio.run(go())
        assert u is not None
        assert u["password_hash"].startswith("$2b$"), u["password_hash"][:10]

    def test_brute_force_lockout(self):
        email = f"TEST_bf_{uuid.uuid4().hex[:6]}@example.com"
        codes = []
        # NOTE: backend keys the lockout on request.client.host which behind the
        # k8s ingress is the proxy pod IP (multiple replicas), so attempts spread
        # across keys and more than 5 tries can be needed.
        for _ in range(16):
            r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": "nope12345"}, timeout=30)
            codes.append(r.status_code)
        assert 429 in codes, f"no lockout observed: {codes}"


# --- RBAC ---
class TestRBAC:
    def test_customer_cannot_access_staff_endpoints(self, customer):
        s, _, _ = customer
        for path in ["/customers", "/estimates", "/invoices", "/bills", "/dashboard", "/reorders", "/export/xero/invoices"]:
            r = s.get(f"{BASE}{path}", timeout=30)
            assert r.status_code == 403, f"{path} -> {r.status_code}"

    def test_unauth_blocked(self):
        r = requests.get(f"{BASE}/dashboard", timeout=30)
        assert r.status_code == 401


# --- Materials CRUD ---
class TestMaterials:
    def test_material_crud(self, admin):
        r = admin.post(f"{BASE}/materials", json={"name": "TEST_Vinyl", "category": "Vinyl", "unit": "sqft", "cost": 10.0, "price": 25.0, "stock": 100, "supplier": "TEST_Sup"}, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        mid = m["id"]
        assert m["cost"] == 10.0 and m["price"] == 25.0
        assert "_id" not in m

        lst = admin.get(f"{BASE}/materials", timeout=30).json()
        assert any(x["id"] == mid for x in lst)

        r = admin.put(f"{BASE}/materials/{mid}", json={"name": "TEST_Vinyl2", "unit": "sqft", "cost": 12.0, "price": 30.0}, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Vinyl2" and r.json()["price"] == 30.0

        assert admin.delete(f"{BASE}/materials/{mid}", timeout=30).status_code == 200
        lst = admin.get(f"{BASE}/materials", timeout=30).json()
        assert not any(x["id"] == mid for x in lst)


# --- Customers CRUD ---
class TestCustomers:
    def test_customer_crud(self, admin):
        r = admin.post(f"{BASE}/customers", json={"name": "TEST_Client", "company": "TEST_Corp", "email": "test_client@example.com", "phone": "123"}, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        assert c["company"] == "TEST_Corp"
        r = admin.put(f"{BASE}/customers/{cid}", json={"name": "TEST_Client B", "company": "TEST_Corp"}, timeout=30)
        assert r.status_code == 200 and r.json()["name"] == "TEST_Client B"
        assert admin.delete(f"{BASE}/customers/{cid}", timeout=30).status_code == 200
        assert not any(x["id"] == cid for x in admin.get(f"{BASE}/customers", timeout=30).json())

    def test_invalid_id_handling(self, admin):
        r = admin.get(f"{BASE}/customers", timeout=30)
        assert r.status_code == 200
        r2 = admin.put(f"{BASE}/customers/not-an-objectid", json={"name": "x"}, timeout=30)
        assert r2.status_code in (400, 404, 422), f"expected 4xx got {r2.status_code}"


# --- Estimates + convert ---
class TestEstimates:
    @pytest.fixture(scope="class")
    def cust_id(self, admin):
        r = admin.post(f"{BASE}/customers", json={"name": "TEST_EstCust", "company": "TEST_EstCo"}, timeout=30)
        cid = r.json()["id"]
        yield cid
        admin.delete(f"{BASE}/customers/{cid}", timeout=30)

    def test_estimate_totals_and_crud_and_convert(self, admin, cust_id):
        payload = {
            "customer_id": cust_id, "title": "TEST_Estimate", "tax_rate": 10,
            "line_items": [
                {"description": "Banner", "quantity": 2, "unit_price": 100},
                {"description": "Install", "quantity": 1, "unit_price": 50},
            ],
        }
        r = admin.post(f"{BASE}/estimates", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        e = r.json()
        eid = e["id"]
        assert e["subtotal"] == 250.0
        assert e["tax_amount"] == 25.0
        assert e["total"] == 275.0
        assert e["number"].startswith("EST-")
        assert e["customer_name"] == "TEST_EstCo"
        assert e["line_items"][0]["line_total"] == 200.0

        # edit
        payload["line_items"][0]["quantity"] = 3
        r = admin.put(f"{BASE}/estimates/{eid}", json=payload, timeout=30)
        assert r.status_code == 200 and r.json()["subtotal"] == 350.0
        # persistence
        got = [x for x in admin.get(f"{BASE}/estimates", timeout=30).json() if x["id"] == eid][0]
        assert got["total"] == 385.0

        # convert
        r = admin.post(f"{BASE}/estimates/{eid}/convert", timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["status"] == "unpaid" and inv["total"] == 385.0
        assert inv["number"].startswith("INV-")
        est = [x for x in admin.get(f"{BASE}/estimates", timeout=30).json() if x["id"] == eid][0]
        assert est["status"] == "approved"

        # cleanup
        assert admin.delete(f"{BASE}/invoices/{inv['id']}", timeout=30).status_code == 200
        assert admin.delete(f"{BASE}/estimates/{eid}", timeout=30).status_code == 200

    def test_convert_missing_estimate_404(self, admin):
        r = admin.post(f"{BASE}/estimates/000000000000000000000000/convert", timeout=30)
        assert r.status_code == 404


# --- Invoices ---
class TestInvoices:
    @pytest.fixture(scope="class")
    def cust_id(self, admin):
        r = admin.post(f"{BASE}/customers", json={"name": "TEST_InvCust"}, timeout=30)
        cid = r.json()["id"]
        yield cid
        admin.delete(f"{BASE}/customers/{cid}", timeout=30)

    def test_invoice_crud_and_status(self, admin, cust_id):
        payload = {"customer_id": cust_id, "title": "TEST_Invoice", "tax_rate": 0,
                   "line_items": [{"description": "Sign", "quantity": 4, "unit_price": 25}]}
        r = admin.post(f"{BASE}/invoices", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        iid = inv["id"]
        assert inv["total"] == 100.0 and inv["status"] == "unpaid"
        assert inv["customer_name"] == "TEST_InvCust"

        r = admin.patch(f"{BASE}/invoices/{iid}/status", params={"status": "paid"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid" and r.json()["paid_at"]

        got = [x for x in admin.get(f"{BASE}/invoices", timeout=30).json() if x["id"] == iid][0]
        assert got["status"] == "paid"

        payload["title"] = "TEST_Invoice edited"
        r = admin.put(f"{BASE}/invoices/{iid}", json=payload, timeout=30)
        assert r.status_code == 200 and r.json()["title"] == "TEST_Invoice edited"
        # NOTE: PUT resets status to default 'unpaid' if client omits status
        assert admin.delete(f"{BASE}/invoices/{iid}", timeout=30).status_code == 200
        assert not any(x["id"] == iid for x in admin.get(f"{BASE}/invoices", timeout=30).json())


# --- Bills / AP ---
class TestBills:
    def test_bill_crud_and_status(self, admin):
        r = admin.post(f"{BASE}/bills", json={"vendor": "TEST_Vendor", "reference": "R1", "description": "TEST bill", "amount": 250.5, "due_date": "2026-08-01"}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        bid = b["id"]
        assert b["amount"] == 250.5 and b["number"].startswith("BILL-") and b["status"] == "unpaid"

        r = admin.patch(f"{BASE}/bills/{bid}/status", params={"status": "paid"}, timeout=30)
        assert r.status_code == 200 and r.json()["status"] == "paid"

        r = admin.put(f"{BASE}/bills/{bid}", json={"vendor": "TEST_Vendor2", "amount": 300, "status": "paid"}, timeout=30)
        assert r.status_code == 200 and r.json()["vendor"] == "TEST_Vendor2"

        assert admin.delete(f"{BASE}/bills/{bid}", timeout=30).status_code == 200
        assert not any(x["id"] == bid for x in admin.get(f"{BASE}/bills", timeout=30).json())


# --- Dashboard ---
class TestDashboard:
    def test_dashboard_math(self, admin):
        d = admin.get(f"{BASE}/dashboard", timeout=30).json()
        for k in ["receivable", "collected", "payable", "net_cash", "open_estimates", "invoice_count", "customer_count", "material_count"]:
            assert k in d, k
        invoices = admin.get(f"{BASE}/invoices", timeout=30).json()
        bills = admin.get(f"{BASE}/bills", timeout=30).json()
        exp_recv = round(sum(i.get("total", 0) for i in invoices if i.get("status") != "paid"), 2)
        exp_pay = round(sum(b.get("amount", 0) for b in bills if b.get("status") != "paid"), 2)
        assert abs(d["receivable"] - exp_recv) < 0.05
        assert abs(d["payable"] - exp_pay) < 0.05
        assert d["invoice_count"] == len(invoices)


# --- Xero export ---
class TestXeroExport:
    HEADER = ["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType"]

    def test_invoices_csv(self, admin):
        r = admin.get(f"{BASE}/export/xero/invoices", timeout=30)
        assert r.status_code == 200
        assert "text/csv" in r.headers["content-type"]
        assert "attachment" in r.headers.get("content-disposition", "")
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == self.HEADER
        assert len(rows) > 1

    def test_bills_csv(self, admin):
        r = admin.get(f"{BASE}/export/xero/bills", timeout=30)
        assert r.status_code == 200
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == self.HEADER


# --- Portal + reorders ---
class TestPortalReorders:
    def test_portal_orders_and_reorder_flow(self, admin, customer):
        s, email, data = customer
        r = s.get(f"{BASE}/portal/orders", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["customer"] is not None
        assert d["customer"]["email"] == email.lower()
        assert isinstance(d["invoices"], list) and isinstance(d["reorders"], list)
        cid = d["customer"]["id"]

        # staff creates invoice for this customer -> should appear in portal
        inv = admin.post(f"{BASE}/invoices", json={"customer_id": cid, "title": "TEST_PortalInv", "line_items": [{"description": "x", "quantity": 1, "unit_price": 60}]}, timeout=30).json()
        d2 = s.get(f"{BASE}/portal/orders", timeout=30).json()
        assert any(i["id"] == inv["id"] for i in d2["invoices"])

        # reorder
        r = s.post(f"{BASE}/portal/reorder", json={"title": "TEST_Reorder", "notes": "same as before", "source_invoice_id": inv["id"]}, timeout=30)
        assert r.status_code == 200, r.text
        ro = r.json()
        assert ro["status"] == "requested" and ro["customer_id"] == cid
        rid = ro["id"]

        d3 = s.get(f"{BASE}/portal/orders", timeout=30).json()
        assert any(x["id"] == rid for x in d3["reorders"])

        # staff sees + advances status
        staff_list = admin.get(f"{BASE}/reorders", timeout=30).json()
        assert any(x["id"] == rid for x in staff_list)
        for st in ("processing", "completed"):
            r = admin.patch(f"{BASE}/reorders/{rid}/status", params={"status": st}, timeout=30)
            assert r.status_code == 200 and r.json()["status"] == st

        admin.delete(f"{BASE}/invoices/{inv['id']}", timeout=30)
