"""Sign shop CRM backend tests - iteration 3.
Covers: auth (staff/customer register), RBAC admin vs salesman, commissions,
estimate area math + commission math, pipeline estimate->SO->invoice with
commission carry-through, users CRUD, error handling (404/400), xero export.
"""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

UNKNOWN_ID = "000000000000000000000000"


def _creds(section_regex):
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    c = p.read_text(encoding="utf-8")
    m = re.search(section_regex, c, re.I | re.S)
    if not m:
        pytest.skip(f"creds not found for {section_regex}")
    return {"email": m.group(1), "password": m.group(2)}


# --------------------------------------------------------------------------
# Fixtures: sessions for admin / salesman / customer
# --------------------------------------------------------------------------
@pytest.fixture(scope="session")
def admin_creds():
    return _creds(r"Admin \(DBG\).*?Email:\s*(\S+).*?Password:\s*(\S+)")


@pytest.fixture(scope="session")
def salesman_creds():
    return _creds(r"Salesman.*?Email:\s*(\S+).*?Password:\s*(\S+)")


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    return s, r.json()


@pytest.fixture(scope="session")
def admin(admin_creds):
    return _login(admin_creds)[0]


@pytest.fixture(scope="session")
def salesman(salesman_creds):
    return _login(salesman_creds)[0]


@pytest.fixture(scope="session")
def customer_id(admin):
    r = admin.get(f"{API}/customers", timeout=30)
    assert r.status_code == 200, r.text
    items = r.json()
    if items:
        return items[0]["id"]
    r = admin.post(f"{API}/customers", json={"name": "TEST_Cust"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# --------------------------------------------------------------------------
# Module: auth
# --------------------------------------------------------------------------
class TestAuth:
    def test_admin_login_role(self, admin_creds):
        s, data = _login(admin_creds)
        assert data["role"] == "admin"
        assert s.cookies.get("access_token")
        me = s.get(f"{API}/auth/me", timeout=30)
        assert me.status_code == 200
        assert me.json()["role"] == "admin"
        assert "password_hash" not in me.json()
        assert "_id" not in me.json()

    def test_salesman_login_role_and_rate(self, salesman_creds):
        s, data = _login(salesman_creds)
        assert data["role"] == "salesman"
        me = s.get(f"{API}/auth/me", timeout=30).json()
        assert float(me.get("commission_rate", 0)) == 10.0

    def test_bad_password_401(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com", "password": "x"}, timeout=30)
        assert r.status_code == 401

    def test_unauthenticated_401(self):
        assert requests.get(f"{API}/estimates", timeout=30).status_code == 401

    def test_customer_register_and_portal(self):
        email = f"test_portal_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register",
                   json={"email": email, "password": "Portal2026!", "name": "TEST_Portal User"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "customer"
        p = s.get(f"{API}/portal/orders", timeout=30)
        assert p.status_code == 200
        assert p.json()["customer"]["email"] == email
        # customer must not reach staff endpoints
        assert s.get(f"{API}/estimates", timeout=30).status_code == 403
        assert s.get(f"{API}/dashboard", timeout=30).status_code == 403
        # duplicate registration
        assert requests.post(f"{API}/auth/register",
                             json={"email": email, "password": "Portal2026!", "name": "dup"}, timeout=30).status_code == 400

    def test_brute_force_lockout(self):
        # throwaway email so real accounts are never locked
        email = f"test_lock_{uuid.uuid4().hex[:8]}@example.com"
        codes = []
        for _ in range(14):
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"}, timeout=30)
            codes.append(r.status_code)
        print("lockout codes:", codes)
        assert codes[:5] == [401] * 5, codes
        assert 429 in codes[5:], f"expected 429 lockout after 5 failures, got {codes}"

    def test_bcrypt_hash_format(self):
        import subprocess
        out = subprocess.run(
            ["python", "-c",
             "import os,asyncio;from dotenv import load_dotenv;load_dotenv('/app/backend/.env');"
             "from motor.motor_asyncio import AsyncIOMotorClient;"
             "c=AsyncIOMotorClient(os.environ['MONGO_URL']);d=c[os.environ['DB_NAME']];"
             "print(asyncio.get_event_loop().run_until_complete(d.users.find_one({'email':os.environ['ADMIN_EMAIL'].lower()}))['password_hash'][:4])"],
            capture_output=True, text=True, timeout=60)
        assert "$2b$" in out.stdout, f"unexpected hash prefix: {out.stdout} {out.stderr[-300:]}"


# --------------------------------------------------------------------------
# Module: RBAC salesman restrictions
# --------------------------------------------------------------------------
class TestRBAC:
    def test_salesman_materials_write_forbidden(self, salesman):
        payload = {"name": "TEST_Mat", "unit": "roll", "buying_cost": 100, "conversion_factor": 50, "markup": 40}
        assert salesman.get(f"{API}/materials", timeout=30).status_code == 200
        assert salesman.post(f"{API}/materials", json=payload, timeout=30).status_code == 403
        assert salesman.put(f"{API}/materials/{UNKNOWN_ID}", json=payload, timeout=30).status_code == 403
        assert salesman.delete(f"{API}/materials/{UNKNOWN_ID}", timeout=30).status_code == 403

    def test_salesman_bills_forbidden(self, salesman):
        assert salesman.get(f"{API}/bills", timeout=30).status_code == 403
        assert salesman.post(f"{API}/bills", json={"vendor": "TEST_V", "amount": 10}, timeout=30).status_code == 403

    def test_salesman_settings_write_forbidden(self, salesman):
        assert salesman.get(f"{API}/settings", timeout=30).status_code == 200
        r = salesman.put(f"{API}/settings",
                         json={"shop_rate_per_hr": 1, "machine_rate_per_hr": 1, "default_markup": 1}, timeout=30)
        assert r.status_code == 403

    def test_salesman_users_forbidden(self, salesman):
        assert salesman.get(f"{API}/users", timeout=30).status_code == 403
        assert salesman.post(f"{API}/users",
                             json={"email": "x@y.com", "password": "p", "name": "n", "role": "admin"}, timeout=30).status_code == 403
        assert salesman.delete(f"{API}/users/{UNKNOWN_ID}", timeout=30).status_code == 403

    def test_salesman_cannot_delete_invoice(self, salesman):
        assert salesman.delete(f"{API}/invoices/{UNKNOWN_ID}", timeout=30).status_code == 403

    def test_salesman_allowed_reads(self, salesman):
        for path in ["/estimates", "/sales-orders", "/invoices", "/customers", "/commissions", "/dashboard"]:
            r = salesman.get(f"{API}{path}", timeout=30)
            assert r.status_code == 200, f"{path} -> {r.status_code}"

    def test_admin_allowed_where_salesman_blocked(self, admin):
        assert admin.get(f"{API}/bills", timeout=30).status_code == 200
        assert admin.get(f"{API}/users", timeout=30).status_code == 200
        s = admin.get(f"{API}/settings", timeout=30).json()
        r = admin.put(f"{API}/settings", json=s, timeout=30)
        assert r.status_code == 200
        assert r.json()["shop_rate_per_hr"] == s["shop_rate_per_hr"]


# --------------------------------------------------------------------------
# Module: estimates costing + commission
# --------------------------------------------------------------------------
LINE = {"description": "TEST_Panel", "width_in": 48, "height_in": 24, "quantity": 2,
        "price_per_sqft": 2.4, "labor_hours": 1.5, "machine_hours": 0.5}


class TestEstimateCommission:
    created = []

    def test_salesman_estimate_auto_commission(self, salesman, customer_id):
        r = salesman.post(f"{API}/estimates",
                          json={"customer_id": customer_id, "title": "TEST_Comm Salesman",
                                "line_items": [LINE], "tax_rate": 0}, timeout=30)
        assert r.status_code == 200, r.text
        e = r.json()
        self.created.append(("salesman", e["id"]))
        assert e["line_items"][0]["area_sqft"] == 16
        assert e["line_items"][0]["material_cost"] == 38.40
        # iteration 4: labor/machine hours derived from throughput (16 sqft / 150 sqft-hr)
        assert e["line_items"][0]["labor_cost"] == pytest.approx(6.94, abs=0.02)
        assert e["line_items"][0]["machine_cost"] == pytest.approx(3.73, abs=0.02)
        assert e["subtotal"] == pytest.approx(49.07, abs=0.03)
        assert e["commission_rate"] == 10.0
        # iteration 6: commission base = materials-only at selling price
        mats = sum(li["material_cost"] for li in e["line_items"])
        assert e["commission_base"] == pytest.approx(mats, abs=0.01)
        assert e["commission_amount"] == pytest.approx(round(mats * 0.10, 2), abs=0.01)
        assert e["salesman_name"] == "Sam Salesman"
        assert e["salesman_id"]

    def test_admin_estimate_pick_salesman_and_rate(self, admin, salesman_creds, customer_id):
        users = admin.get(f"{API}/users", timeout=30).json()
        sam = next(u for u in users if u["email"] == salesman_creds["email"])
        r = admin.post(f"{API}/estimates",
                       json={"customer_id": customer_id, "title": "TEST_Comm Admin",
                             "line_items": [LINE], "tax_rate": 8.25,
                             "salesman_id": sam["id"], "commission_rate": 5}, timeout=30)
        assert r.status_code == 200, r.text
        e = r.json()
        self.created.append(("admin", e["id"]))
        assert e["salesman_name"] == sam["name"]
        assert e["commission_rate"] == 5.0
        mats = sum(li["material_cost"] for li in e["line_items"])
        assert e["commission_base"] == pytest.approx(mats, abs=0.01)
        assert e["commission_amount"] == pytest.approx(round(mats * 0.05, 2), abs=0.01)
        # tax computed on subtotal, commission on pre-tax subtotal
        assert e["tax_amount"] == pytest.approx(round(e["subtotal"] * 0.0825, 2), abs=0.01)

    def test_commission_carried_through_pipeline(self, admin, admin_creds, customer_id):
        r = admin.post(f"{API}/estimates",
                       json={"customer_id": customer_id, "title": "TEST_Pipeline",
                             "line_items": [LINE], "tax_rate": 10, "commission_rate": 7}, timeout=30)
        assert r.status_code == 200, r.text
        est = r.json()
        eid = est["id"]
        ap = admin.post(f"{API}/estimates/{eid}/approve", timeout=30)
        assert ap.status_code == 200, ap.text
        so = ap.json()
        assert so["commission_rate"] == 7.0
        assert so["commission_amount"] == est["commission_amount"]
        assert so["status"] == "open"
        # duplicate approve blocked
        assert admin.post(f"{API}/estimates/{eid}/approve", timeout=30).status_code == 400
        conv = admin.post(f"{API}/sales-orders/{so['id']}/convert", timeout=30)
        assert conv.status_code == 200, conv.text
        inv = conv.json()
        assert inv["commission_rate"] == 7.0
        assert inv["commission_amount"] == est["commission_amount"]
        assert inv["from_sales_order"] == so["number"]
        assert admin.post(f"{API}/sales-orders/{so['id']}/convert", timeout=30).status_code == 400
        # status patch
        pr = admin.patch(f"{API}/invoices/{inv['id']}/status?status=paid", timeout=30)
        assert pr.status_code == 200 and pr.json()["status"] == "paid"
        # cleanup
        pw = {"password": admin_creds["password"]}
        assert admin.delete(f"{API}/invoices/{inv['id']}", json=pw, timeout=30).status_code == 200
        assert admin.delete(f"{API}/sales-orders/{so['id']}", json=pw, timeout=30).status_code == 200
        assert admin.delete(f"{API}/estimates/{eid}", json=pw, timeout=30).status_code == 200

    def test_commissions_report_roles(self, admin, salesman):
        a = admin.get(f"{API}/commissions", timeout=30)
        assert a.status_code == 200, a.text
        ad = a.json()
        for k in ("rows", "by_salesman", "total_earned", "total_pending"):
            assert k in ad
        s = salesman.get(f"{API}/commissions", timeout=30).json()
        names = {r["salesman_name"] for r in s["rows"]}
        assert names <= {"Sam Salesman"}, names
        assert len(s["rows"]) <= len(ad["rows"])
        assert round(ad["total_earned"] + ad["total_pending"], 2) == round(
            sum(r["commission_amount"] for r in ad["rows"]), 2)

    def test_cleanup_created_estimates(self, admin, admin_creds):
        for _, eid in self.created:
            r = admin.delete(f"{API}/estimates/{eid}", json={"password": admin_creds["password"]}, timeout=30)
            assert r.status_code in (200, 404)


# --------------------------------------------------------------------------
# Module: users CRUD (admin)
# --------------------------------------------------------------------------
class TestUsersCRUD:
    def test_create_update_delete_salesman(self, admin):
        email = f"test_sales_{uuid.uuid4().hex[:8]}@example.com"
        r = admin.post(f"{API}/users", json={"email": email, "password": "Temp2026!",
                                             "name": "TEST_Sales", "role": "salesman",
                                             "commission_rate": 12.5}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["role"] == "salesman" and u["commission_rate"] == 12.5
        assert "password_hash" not in u and "_id" not in u
        # new user can log in
        s2 = requests.Session()
        lr = s2.post(f"{API}/auth/login", json={"email": email, "password": "Temp2026!"}, timeout=30)
        assert lr.status_code == 200 and lr.json()["role"] == "salesman"
        # duplicate email
        assert admin.post(f"{API}/users", json={"email": email, "password": "x", "name": "d"}, timeout=30).status_code == 400
        # invalid role
        assert admin.post(f"{API}/users", json={"email": f"z{email}", "password": "x", "name": "d",
                                                "role": "wizard"}, timeout=30).status_code == 400
        # missing password
        assert admin.post(f"{API}/users", json={"email": f"y{email}", "name": "d"}, timeout=30).status_code == 400
        # update
        up = admin.put(f"{API}/users/{u['id']}", json={"email": email, "name": "TEST_Sales2",
                                                       "role": "salesman", "commission_rate": 15}, timeout=30)
        assert up.status_code == 200 and up.json()["name"] == "TEST_Sales2"
        assert admin.get(f"{API}/users", timeout=30).status_code == 200
        got = next(x for x in admin.get(f"{API}/users", timeout=30).json() if x["id"] == u["id"])
        assert got["commission_rate"] == 15
        # delete
        assert admin.delete(f"{API}/users/{u['id']}", timeout=30).status_code == 200
        assert admin.delete(f"{API}/users/{u['id']}", timeout=30).status_code == 404

    def test_admin_cannot_delete_self(self, admin):
        me = admin.get(f"{API}/auth/me", timeout=30).json()
        r = admin.delete(f"{API}/users/{me['id']}", timeout=30)
        assert r.status_code == 400


# --------------------------------------------------------------------------
# Module: error handling 404 / 400
# --------------------------------------------------------------------------
class TestErrorHandling:
    def test_404_on_unknown_ids(self, admin, admin_creds):
        mat = {"name": "TEST_x", "unit": "roll", "buying_cost": 1, "conversion_factor": 1, "markup": 0}
        cases = [
            ("put", f"/materials/{UNKNOWN_ID}", mat),
            ("put", f"/estimates/{UNKNOWN_ID}", {"customer_id": UNKNOWN_ID, "title": "x", "line_items": []}),
            ("put", f"/invoices/{UNKNOWN_ID}", {"customer_id": UNKNOWN_ID, "title": "x", "line_items": []}),
            ("put", f"/bills/{UNKNOWN_ID}", {"vendor": "v", "amount": 1}),
            ("put", f"/customers/{UNKNOWN_ID}", {"name": "n"}),
            ("patch", f"/invoices/{UNKNOWN_ID}/status?status=paid", None),
            ("patch", f"/sales-orders/{UNKNOWN_ID}/status?status=open", None),
            ("patch", f"/bills/{UNKNOWN_ID}/status?status=paid", None),
            ("patch", f"/reorders/{UNKNOWN_ID}/status?status=processing", None),
            ("post", f"/estimates/{UNKNOWN_ID}/approve", None),
            ("post", f"/sales-orders/{UNKNOWN_ID}/convert", None),
            ("delete", f"/materials/{UNKNOWN_ID}", None),
            ("delete", f"/estimates/{UNKNOWN_ID}", {"password": admin_creds["password"]}),
            ("delete", f"/invoices/{UNKNOWN_ID}", {"password": admin_creds["password"]}),
            ("delete", f"/bills/{UNKNOWN_ID}", None),
            ("delete", f"/customers/{UNKNOWN_ID}", None),
            ("delete", f"/sales-orders/{UNKNOWN_ID}", {"password": admin_creds["password"]}),
        ]
        failures = []
        for method, path, body in cases:
            fn = getattr(admin, method)
            r = fn(f"{API}{path}", json=body, timeout=30) if body is not None else fn(f"{API}{path}", timeout=30)
            if r.status_code != 404:
                failures.append(f"{method.upper()} {path} -> {r.status_code} {r.text[:120]}")
        assert not failures, failures

    def test_malformed_id_returns_404(self, admin, admin_creds):
        r = admin.delete(f"{API}/estimates/not-an-objectid", json={"password": admin_creds["password"]}, timeout=30)
        assert r.status_code == 404

    def test_invalid_status_400(self, admin):
        failures = []
        for path in [f"/invoices/{UNKNOWN_ID}/status?status=bogus",
                     f"/sales-orders/{UNKNOWN_ID}/status?status=bogus",
                     f"/bills/{UNKNOWN_ID}/status?status=bogus",
                     f"/reorders/{UNKNOWN_ID}/status?status=bogus"]:
            r = admin.patch(f"{API}{path}", timeout=30)
            if r.status_code != 400:
                failures.append(f"{path} -> {r.status_code}")
        assert not failures, failures

    def test_validation_errors_422(self, admin):
        assert admin.post(f"{API}/customers", json={}, timeout=30).status_code == 422
        assert admin.post(f"{API}/estimates", json={"title": "no customer"}, timeout=30).status_code == 422


# --------------------------------------------------------------------------
# Module: materials costing, dashboard, export
# --------------------------------------------------------------------------
class TestMiscModules:
    def test_material_derived_costing(self, admin):
        r = admin.post(f"{API}/materials", json={"name": "TEST_Vinyl", "unit": "roll",
                                                 "buying_cost": 120, "conversion_factor": 50,
                                                 "markup": 40}, timeout=30)
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["cost_per_sqft"] == 2.4
        assert m["price_per_sqft"] == 3.36
        assert "_id" not in m
        g = next(x for x in admin.get(f"{API}/materials", timeout=30).json() if x["id"] == m["id"])
        assert g["price_per_sqft"] == 3.36
        assert admin.delete(f"{API}/materials/{m['id']}", timeout=30).status_code == 200

    def test_dashboard_shape(self, admin):
        r = admin.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("receivable", "collected", "payable", "net_cash", "open_estimates",
                  "open_sales_orders", "invoice_count", "customer_count", "material_count"):
            assert k in d, k

    def test_xero_exports(self, admin):
        for path in ["/export/xero/invoices", "/export/xero/bills"]:
            r = admin.get(f"{API}{path}", timeout=60)
            assert r.status_code == 200, path
            assert "text/csv" in r.headers.get("content-type", "")
            assert "attachment" in r.headers.get("content-disposition", "")
            assert "*ContactName" in r.text.splitlines()[0]

    def test_bills_crud_admin(self, admin):
        r = admin.post(f"{API}/bills", json={"vendor": "TEST_Vendor", "amount": 250.5,
                                             "description": "TEST bill"}, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["number"].startswith("BILL-")
        pr = admin.patch(f"{API}/bills/{b['id']}/status?status=paid", timeout=30)
        assert pr.status_code == 200 and pr.json()["status"] == "paid"
        assert admin.delete(f"{API}/bills/{b['id']}", timeout=30).status_code == 200
        assert admin.delete(f"{API}/bills/{b['id']}", timeout=30).status_code == 404

    def test_unique_numbering(self, admin, admin_creds, customer_id):
        ids, numbers = [], []
        for i in range(3):
            r = admin.post(f"{API}/estimates", json={"customer_id": customer_id,
                                                     "title": f"TEST_Num{i}", "line_items": []}, timeout=30)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
            numbers.append(r.json()["number"])
        assert len(set(numbers)) == 3, numbers
        for i in ids:
            admin.delete(f"{API}/estimates/{i}", json={"password": admin_creds["password"]}, timeout=30)
