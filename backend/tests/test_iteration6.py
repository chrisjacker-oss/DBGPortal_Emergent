"""Iteration 6 backend tests - DBG Signs CRM.

Covers: material categories (presets + custom CRUD + RBAC), commission =
materials-only at selling price, settings default_tax_rate persistence,
Stripe embedded payment intents (create-intent auth/paid/voided + status
flips invoice to paid), sales-order direct create/edit, portal account admin
console (create/suspend/login-403/reactivate/delete), void/reactivate +
exclusion from dashboard/overdue/portal, admin-password protected deletes.
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
API = base_url.rstrip("/") + "/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "")
ADMIN_PASS = os.environ.get("TEST_ADMIN_PASSWORD", "")
SALES_EMAIL = os.environ.get("TEST_SALESMAN_EMAIL", "")
SALES_PASS = os.environ.get("TEST_SALESMAN_PASSWORD", "")


def _read_creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing /app/memory/test_credentials.md")
    return p.read_text(encoding="utf-8")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.fail(f"login failed for {email}: {r.status_code} {r.text[:300]}")
    return s


def _require_staff_credentials():
    if not all((ADMIN_EMAIL, ADMIN_PASS, SALES_EMAIL, SALES_PASS)):
        pytest.skip("TEST_ADMIN_* and TEST_SALESMAN_* credentials are required")


@pytest.fixture(scope="module")
def creds_file():
    return _read_creds()


@pytest.fixture(scope="module")
def admin(creds_file):
    _require_staff_credentials()
    assert ADMIN_EMAIL in creds_file
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def salesman(creds_file):
    _require_staff_credentials()
    assert SALES_EMAIL in creds_file
    return _login(SALES_EMAIL, SALES_PASS)


@pytest.fixture(scope="module")
def customer(admin):
    """A TEST_ customer business record used by doc tests."""
    r = admin.post(f"{API}/customers", json={
        "name": "TEST_it6 Customer", "company": "TEST_it6 Co",
        "email": "test_it6_customer@it6test.example.com", "net_terms": "Net 15",
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield cid
    admin.delete(f"{API}/customers/{cid}")


def _admin_delete(sess, path, password=None):
    password = password or ADMIN_PASS
    return sess.delete(f"{API}{path}", json={"password": password})


# ---------------------------------------------------------------------------
# Auth / RBAC basics
# ---------------------------------------------------------------------------
class TestAuthBasics:
    def test_admin_me(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_salesman_me(self, salesman):
        r = salesman.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] == "salesman"

    def test_login_sets_httponly_cookies(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200
        assert "token" not in r.json()
        raw = "; ".join(r.headers.get_all("set-cookie")) if hasattr(r.headers, "get_all") else str(r.headers)
        assert "HttpOnly" in raw or "httponly" in raw.lower()

    def test_bcrypt_hash_format(self):
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        env = dotenv_values("/app/backend/.env")

        async def go():
            c = AsyncIOMotorClient(env["MONGO_URL"])
            u = await c[env["DB_NAME"]].users.find_one({"email": ADMIN_EMAIL})
            c.close()
            return u
        u = asyncio.get_event_loop().run_until_complete(go()) if False else asyncio.run(go())
        assert u is not None
        assert u["password_hash"].startswith("$2b$")


# ---------------------------------------------------------------------------
# Material categories
# ---------------------------------------------------------------------------
class TestMaterialCategories:
    created = []

    def test_presets_include_marketing_materials(self, admin):
        r = admin.get(f"{API}/material-categories")
        assert r.status_code == 200
        d = r.json()
        assert "Marketing Materials" in d["presets"]
        for c in ["Cut Vinyl", "Digital Vinyl", "Banner", "Substrates", "Laminates"]:
            assert c in d["presets"]
        assert set(d["presets"]).issubset(set(d["all"]))

    def test_create_custom_category_and_appears_in_list(self, admin):
        r = admin.post(f"{API}/material-categories", json={"name": "TEST_it6 Cat"})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        TestMaterialCategories.created.append(cid)
        assert r.json()["name"] == "TEST_it6 Cat"
        lst = admin.get(f"{API}/material-categories").json()
        assert "TEST_it6 Cat" in [c["name"] for c in lst["custom"]]
        assert "TEST_it6 Cat" in lst["all"]

    def test_duplicate_custom_case_insensitive_rejected(self, admin):
        r = admin.post(f"{API}/material-categories", json={"name": "test_IT6 cAt"})
        assert r.status_code == 400
        assert "exists" in r.json()["detail"].lower()

    def test_duplicate_preset_rejected(self, admin):
        r = admin.post(f"{API}/material-categories", json={"name": "marketing materials"})
        assert r.status_code == 400

    def test_blank_name_rejected(self, admin):
        r = admin.post(f"{API}/material-categories", json={"name": "   "})
        assert r.status_code == 400

    def test_salesman_can_read_but_not_write(self, salesman):
        assert salesman.get(f"{API}/material-categories").status_code == 200
        assert salesman.post(f"{API}/material-categories", json={"name": "TEST_it6 Nope"}).status_code == 403
        assert salesman.delete(f"{API}/material-categories/000000000000000000000000").status_code == 403

    def test_unauth_blocked(self):
        assert requests.get(f"{API}/material-categories").status_code == 401

    def test_delete_custom_category(self, admin):
        assert TestMaterialCategories.created, "no category created"
        cid = TestMaterialCategories.created.pop()
        r = _admin_delete(admin, f"/material-categories/{cid}")
        assert r.status_code == 200
        lst = admin.get(f"{API}/material-categories").json()
        assert "TEST_it6 Cat" not in [c["name"] for c in lst["custom"]]
        assert _admin_delete(admin, f"/material-categories/{cid}").status_code == 404


# ---------------------------------------------------------------------------
# Commission = materials only at selling price
# ---------------------------------------------------------------------------
class TestCommissionMaterialsOnly:
    def test_commission_base_is_material_selling_total(self, admin, customer):
        # Line 1: 24x24 in => 4 sqft @ $10/sqft = $40 material
        # Line 2: qty as sqft = 10 @ $5 = $50 material, plus extra labor hours
        payload = {
            "customer_id": customer, "title": "TEST_it6 commission",
            "tax_rate": 0, "commission_rate": 10,
            "line_items": [
                {"description": "L1", "width_in": 24, "height_in": 24, "quantity": 1, "price_per_sqft": 10},
                {"description": "L2", "quantity": 10, "price_per_sqft": 5, "extra_labor_hours": 2},
            ],
        }
        r = admin.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        est = r.json()
        try:
            mats = sum(li["material_cost"] for li in est["line_items"])
            labor = sum(li["labor_cost"] for li in est["line_items"])
            machine = sum(li["machine_cost"] for li in est["line_items"])
            assert mats == pytest.approx(90.0, abs=0.01)
            assert labor > 0 and machine > 0, "labor/machine should be non-zero for this fixture"
            assert est["commission_base"] == pytest.approx(mats, abs=0.01)
            assert est["commission_base"] != pytest.approx(est["subtotal"], abs=0.01)
            assert est["commission_base"] < mats + labor + machine
            assert est["commission_rate"] == 10
            assert est["commission_amount"] == pytest.approx(round(mats * 0.10, 2), abs=0.01)
            # persisted
            got = [e for e in admin.get(f"{API}/estimates").json() if e["id"] == est["id"]][0]
            assert got["commission_base"] == est["commission_base"]
        finally:
            _admin_delete(admin, f"/estimates/{est['id']}")

    def test_commission_rows_use_commission_base(self, salesman, customer, admin):
        payload = {
            "customer_id": customer, "title": "TEST_it6 salesman commission",
            "tax_rate": 8.25,
            "line_items": [{"description": "L1", "quantity": 20, "price_per_sqft": 3}],
        }
        r = salesman.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        est = r.json()
        try:
            assert est["commission_rate"] == pytest.approx(10.0)  # from salesman profile
            assert est["commission_base"] == pytest.approx(60.0, abs=0.01)
            assert est["commission_amount"] == pytest.approx(6.0, abs=0.01)
            rows = salesman.get(f"{API}/commissions").json()
            row = [x for x in rows["rows"] if x.get("id") == est["id"]] if isinstance(rows, dict) else \
                [x for x in rows if x.get("id") == est["id"]]
            assert row, f"commission row missing for estimate; payload keys={rows if isinstance(rows, dict) else 'list'}"
            assert row[0].get("base") == pytest.approx(60.0, abs=0.01)
            assert row[0].get("commission_amount") == pytest.approx(6.0, abs=0.01)
        finally:
            _admin_delete(admin, f"/estimates/{est['id']}")


# ---------------------------------------------------------------------------
# Settings default tax rate
# ---------------------------------------------------------------------------
class TestSettingsDefaultTax:
    def test_default_tax_rate_persists_with_throughput(self, admin):
        original = admin.get(f"{API}/settings").json()
        assert "default_tax_rate" in original
        body = dict(original)
        body.pop("has_custom_logo", None)
        body["default_tax_rate"] = 7.75
        body["shop_sqft_per_hr"] = 150.0
        body["machine_sqft_per_hr"] = 150.0
        r = admin.put(f"{API}/settings", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["default_tax_rate"] == pytest.approx(7.75)
        again = admin.get(f"{API}/settings").json()
        assert again["default_tax_rate"] == pytest.approx(7.75)
        assert again["shop_sqft_per_hr"] == pytest.approx(150.0)
        assert again["machine_sqft_per_hr"] == pytest.approx(150.0)
        assert again["shop_rate_per_hr"] == pytest.approx(float(original["shop_rate_per_hr"]))
        # restore
        restore = dict(original)
        restore.pop("has_custom_logo", None)
        assert admin.put(f"{API}/settings", json=restore).status_code == 200

    def test_salesman_cannot_write_settings(self, salesman):
        assert salesman.put(f"{API}/settings", json={"default_tax_rate": 1}).status_code == 403


# ---------------------------------------------------------------------------
# Sales orders direct create/edit/void
# ---------------------------------------------------------------------------
class TestSalesOrders:
    def test_create_edit_void_reactivate_delete(self, admin, customer):
        r = admin.post(f"{API}/sales-orders", json={
            "customer_id": customer, "title": "TEST_it6 SO", "tax_rate": 5,
            "status": "in_production", "commission_rate": 5,
            "line_items": [{"description": "S1", "quantity": 10, "price_per_sqft": 4}],
        })
        assert r.status_code == 200, r.text
        so = r.json()
        sid = so["id"]
        try:
            assert re.match(r"^SO-\d+$", so["number"]), so["number"]
            assert so["status"] == "in_production"
            assert so["commission_base"] == pytest.approx(40.0, abs=0.01)
            assert so["commission_amount"] == pytest.approx(2.0, abs=0.01)
            assert "_id" not in so
            # invalid status falls back to open
            r2 = admin.post(f"{API}/sales-orders", json={
                "customer_id": customer, "title": "TEST_it6 SO bad status",
                "status": "bogus", "line_items": [],
            })
            assert r2.status_code == 200
            assert r2.json()["status"] == "open"
            _admin_delete(admin, f"/sales-orders/{r2.json()['id']}")
            # edit
            r3 = admin.put(f"{API}/sales-orders/{sid}", json={
                "customer_id": customer, "title": "TEST_it6 SO edited", "tax_rate": 5,
                "status": "fulfilled", "commission_rate": 5,
                "line_items": [{"description": "S1", "quantity": 20, "price_per_sqft": 4}],
            })
            assert r3.status_code == 200, r3.text
            assert r3.json()["title"] == "TEST_it6 SO edited"
            assert r3.json()["status"] == "fulfilled"
            assert r3.json()["commission_base"] == pytest.approx(80.0, abs=0.01)
            got = [x for x in admin.get(f"{API}/sales-orders").json() if x["id"] == sid][0]
            assert got["title"] == "TEST_it6 SO edited"
            # void + reactivate
            v = admin.patch(f"{API}/sales-orders/{sid}/void?voided=true")
            assert v.status_code == 200 and v.json()["voided"] is True
            got = [x for x in admin.get(f"{API}/sales-orders").json() if x["id"] == sid][0]
            assert got["voided"] is True
            v2 = admin.patch(f"{API}/sales-orders/{sid}/void?voided=false")
            assert v2.status_code == 200 and v2.json()["voided"] is False
        finally:
            pass
        # admin-password delete
        assert _admin_delete(admin, f"/sales-orders/{sid}", "wrongpass").status_code == 403
        assert _admin_delete(admin, f"/sales-orders/{sid}").status_code == 200
        assert _admin_delete(admin, f"/sales-orders/{sid}").status_code == 404

    def test_salesman_can_create_but_not_delete(self, salesman, admin, customer):
        r = salesman.post(f"{API}/sales-orders", json={
            "customer_id": customer, "title": "TEST_it6 SO sales", "line_items": [],
        })
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        assert _admin_delete(salesman, f"/sales-orders/{sid}").status_code == 403
        assert _admin_delete(admin, f"/sales-orders/{sid}").status_code == 200


# ---------------------------------------------------------------------------
# Admin-password protected deletes
# ---------------------------------------------------------------------------
class TestAdminPasswordDeletes:
    def _mk(self, admin, customer, kind):
        body = {"customer_id": customer, "title": f"TEST_it6 {kind} del", "line_items": []}
        r = admin.post(f"{API}/{kind}", json=body)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    @pytest.mark.parametrize("kind", ["estimates", "sales-orders", "invoices"])
    def test_wrong_then_right_password(self, admin, customer, kind):
        did = self._mk(admin, customer, kind)
        bad = _admin_delete(admin, f"/{kind}/{did}", "totally-wrong")
        assert bad.status_code == 403, bad.text
        assert "Incorrect admin password" in bad.json()["detail"]
        # still exists
        assert did in [x["id"] for x in admin.get(f"{API}/{kind}").json()]
        missing = admin.delete(f"{API}/{kind}/{did}")
        assert missing.status_code == 422, f"delete without body should 422, got {missing.status_code}"
        ok = _admin_delete(admin, f"/{kind}/{did}")
        assert ok.status_code == 200, ok.text
        assert did not in [x["id"] for x in admin.get(f"{API}/{kind}").json()]

    @pytest.mark.parametrize("kind", ["estimates", "sales-orders", "invoices"])
    def test_salesman_forbidden(self, admin, salesman, customer, kind):
        did = self._mk(admin, customer, kind)
        r = _admin_delete(salesman, f"/{kind}/{did}", SALES_PASS)
        assert r.status_code == 403
        assert _admin_delete(admin, f"/{kind}/{did}").status_code == 200


# ---------------------------------------------------------------------------
# Void invoices + exclusion from receivables/dashboard
# ---------------------------------------------------------------------------
class TestVoidInvoice:
    def test_void_excluded_from_dashboard_and_overdue(self, admin, customer):
        r = admin.post(f"{API}/invoices", json={
            "customer_id": customer, "title": "TEST_it6 void inv", "tax_rate": 0,
            "due_date": "2024-01-01",
            "line_items": [{"description": "V", "quantity": 100, "price_per_sqft": 10}],
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        iid = inv["id"]
        total = inv["total"]
        try:
            d0 = admin.get(f"{API}/dashboard").json()
            assert iid in [x["id"] for x in admin.get(f"{API}/receivables/overdue?days=45").json()]
            v = admin.patch(f"{API}/invoices/{iid}/void?voided=true")
            assert v.status_code == 200 and v.json()["voided"] is True
            d1 = admin.get(f"{API}/dashboard").json()
            assert d1["receivable"] == pytest.approx(round(d0["receivable"] - total, 2), abs=0.02)
            assert d1["invoice_count"] == d0["invoice_count"] - 1
            assert iid not in [x["id"] for x in admin.get(f"{API}/receivables/overdue?days=45").json()]
            # voided invoice cannot be paid
            p = admin.post(f"{API}/payments/create-intent", json={"invoice_id": iid})
            assert p.status_code == 400
            assert "void" in p.json()["detail"].lower()
            # reactivate
            v2 = admin.patch(f"{API}/invoices/{iid}/void?voided=false")
            assert v2.status_code == 200 and v2.json()["voided"] is False
            d2 = admin.get(f"{API}/dashboard").json()
            assert d2["receivable"] == pytest.approx(d0["receivable"], abs=0.02)
        finally:
            _admin_delete(admin, f"/invoices/{iid}")


# ---------------------------------------------------------------------------
# Stripe embedded payments
# ---------------------------------------------------------------------------
class TestStripePayments:
    def test_create_intent_shape_and_paid_rejection(self, admin, customer):
        r = admin.post(f"{API}/invoices", json={
            "customer_id": customer, "title": "TEST_it6 stripe inv", "tax_rate": 0,
            "line_items": [{"description": "P", "quantity": 5, "price_per_sqft": 10}],
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        iid = inv["id"]
        try:
            p = admin.post(f"{API}/payments/create-intent", json={"invoice_id": iid})
            assert p.status_code == 200, p.text
            d = p.json()
            assert d["client_secret"].startswith("pi_") and "_secret_" in d["client_secret"]
            assert d["publishable_key"].startswith("pk_")
            assert d["amount"] == pytest.approx(inv["total"], abs=0.01)
            # zero-amount invoice rejected
            z = admin.post(f"{API}/invoices", json={
                "customer_id": customer, "title": "TEST_it6 zero inv", "line_items": [],
            })
            zid = z.json()["id"]
            zp = admin.post(f"{API}/payments/create-intent", json={"invoice_id": zid})
            assert zp.status_code == 400
            _admin_delete(admin, f"/invoices/{zid}")
            # paid invoice rejected
            admin.patch(f"{API}/invoices/{iid}/status?status=paid")
            p2 = admin.post(f"{API}/payments/create-intent", json={"invoice_id": iid})
            assert p2.status_code == 400
            assert "already paid" in p2.json()["detail"].lower()
            # unknown invoice
            assert admin.post(f"{API}/payments/create-intent",
                              json={"invoice_id": "000000000000000000000000"}).status_code == 404
            # unauth
            assert requests.post(f"{API}/payments/create-intent", json={"invoice_id": iid}).status_code == 401
        finally:
            _admin_delete(admin, f"/invoices/{iid}")

    def test_status_unknown_intent_404(self, admin):
        assert admin.get(f"{API}/payments/status/pi_does_not_exist_123").status_code == 404

    def test_confirm_intent_flips_invoice_to_paid(self, admin, customer):
        """Create intent, confirm server-side with a Stripe test PM, poll status."""
        stripe_env = dotenv_values("/app/backend/.env")
        sk = stripe_env.get("STRIPE_SECRET_KEY")
        if not sk:
            pytest.fail("STRIPE_SECRET_KEY missing from backend/.env")
        import stripe as stripe_lib
        stripe_lib.api_key = sk
        r = admin.post(f"{API}/invoices", json={
            "customer_id": customer, "title": "TEST_it6 stripe pay", "tax_rate": 0,
            "line_items": [{"description": "PAY", "quantity": 2, "price_per_sqft": 10}],
        })
        iid = r.json()["id"]
        try:
            p = admin.post(f"{API}/payments/create-intent", json={"invoice_id": iid})
            assert p.status_code == 200, p.text
            pi_id = p.json()["client_secret"].split("_secret_")[0]
            confirmed = stripe_lib.PaymentIntent.confirm(
                pi_id, payment_method="pm_card_visa", return_url="https://example.com/return")
            assert confirmed.status == "succeeded", confirmed.status
            st = admin.get(f"{API}/payments/status/{pi_id}")
            assert st.status_code == 200, st.text
            assert st.json()["payment_status"] == "paid", st.json()
            inv = [x for x in admin.get(f"{API}/invoices").json() if x["id"] == iid][0]
            assert inv["status"] == "paid"
            assert inv.get("paid_via") == "stripe"
        finally:
            _admin_delete(admin, f"/invoices/{iid}")

    def test_webhook_rejects_bad_signature(self):
        r = requests.post(f"{API}/stripe/webhook", data=b"{}", headers={"stripe-signature": "t=1,v1=bad"})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Portal accounts admin console
# ---------------------------------------------------------------------------
class TestPortalAccounts:
    EMAIL = "test_it6_portal@it6test.example.com"

    def test_full_lifecycle(self, admin, salesman):
        portal_password = os.environ.get("TEST_PORTAL_PASSWORD") or f"PortalTest{uuid.uuid4().hex}!"
        # cleanup any leftovers
        for a in admin.get(f"{API}/portal-accounts").json():
            if a["email"] == self.EMAIL:
                _admin_delete(admin, f"/portal-accounts/{a['id']}")
        r = admin.post(f"{API}/portal-accounts", json={
            "name": "TEST_it6 Portal User", "email": self.EMAIL, "password": portal_password,
            "company": "TEST_it6 Portal Co", "phone": "555-0100", "tier": 2, "net_terms": "Net 10",
        })
        assert r.status_code == 200, r.text
        acct = r.json()
        uid = acct["id"]
        try:
            assert acct["portal_enabled"] is True
            assert acct["suspended"] is False
            assert acct["customer_id"]
            assert acct["tier"] == 2 and acct["net_terms"] == "Net 10"
            cid = acct["customer_id"]
            # duplicate email
            dup = admin.post(f"{API}/portal-accounts", json={
                "name": "dup", "email": self.EMAIL, "password": portal_password})
            assert dup.status_code == 400
            # appears in list
            lst = admin.get(f"{API}/portal-accounts").json()
            assert uid in [a["id"] for a in lst]
            # customer can log in and read portal
            cs = _login(self.EMAIL, portal_password)
            po = cs.get(f"{API}/portal/orders")
            assert po.status_code == 200, po.text
            assert po.json()["customer"]["email"] == self.EMAIL
            # customer cannot touch staff endpoints
            assert cs.get(f"{API}/invoices").status_code == 403
            assert cs.get(f"{API}/portal-accounts").status_code == 403
            # suspend => login 403
            sp = admin.patch(f"{API}/portal-accounts/{uid}/status?suspended=true")
            assert sp.status_code == 200 and sp.json()["suspended"] is True
            assert sp.json()["portal_enabled"] is False
            bad = requests.post(f"{API}/auth/login", json={"email": self.EMAIL, "password": portal_password})
            assert bad.status_code == 403, bad.status_code
            assert "suspend" in bad.json()["detail"].lower()
            # existing session also blocked
            assert cs.get(f"{API}/portal/orders").status_code == 403
            # reactivate
            rp = admin.patch(f"{API}/portal-accounts/{uid}/status?suspended=false")
            assert rp.status_code == 200 and rp.json()["suspended"] is False
            cs2 = _login(self.EMAIL, portal_password)
            assert cs2.get(f"{API}/portal/orders").status_code == 200
            # RBAC
            assert salesman.get(f"{API}/portal-accounts").status_code == 403
            assert salesman.post(f"{API}/portal-accounts", json={
                "name": "x", "email": "test_it6_x@it6test.example.com", "password": "Xx123456!"}).status_code == 403
            assert salesman.patch(f"{API}/portal-accounts/{uid}/status?suspended=true").status_code == 403
            assert salesman.delete(f"{API}/portal-accounts/{uid}").status_code == 403
            # delete keeps customer record
            d = _admin_delete(admin, f"/portal-accounts/{uid}")
            assert d.status_code == 200, d.text
            assert requests.post(f"{API}/auth/login",
                                 json={"email": self.EMAIL, "password": portal_password}).status_code == 401
            cust = [c for c in admin.get(f"{API}/customers").json() if c["id"] == cid]
            assert cust, "customer business record should survive portal account deletion"
            assert cust[0].get("portal_enabled") is False
            _admin_delete(admin, f"/customers/{cid}")
            assert _admin_delete(admin, f"/portal-accounts/{uid}").status_code == 404
        finally:
            _admin_delete(admin, f"/portal-accounts/{uid}")

    def test_customer_can_only_pay_own_invoice(self, admin, customer):
        email = "test_it6_pay@it6test.example.com"
        pw = "PortalPay2026!"
        for a in admin.get(f"{API}/portal-accounts").json():
            if a["email"] == email:
                admin.delete(f"{API}/portal-accounts/{a['id']}")
        acct = admin.post(f"{API}/portal-accounts", json={
            "name": "TEST_it6 Pay User", "email": email, "password": pw}).json()
        uid, own_cid = acct["id"], acct["customer_id"]
        other_inv = admin.post(f"{API}/invoices", json={
            "customer_id": customer, "title": "TEST_it6 other cust inv",
            "line_items": [{"description": "O", "quantity": 3, "price_per_sqft": 10}]}).json()
        own_inv = admin.post(f"{API}/invoices", json={
            "customer_id": own_cid, "title": "TEST_it6 own inv",
            "line_items": [{"description": "M", "quantity": 3, "price_per_sqft": 10}]}).json()
        try:
            cs = _login(email, pw)
            forb = cs.post(f"{API}/payments/create-intent", json={"invoice_id": other_inv["id"]})
            assert forb.status_code == 403, forb.status_code
            ok = cs.post(f"{API}/payments/create-intent", json={"invoice_id": own_inv["id"]})
            assert ok.status_code == 200, ok.text
            assert ok.json()["amount"] == pytest.approx(own_inv["total"], abs=0.01)
            # portal only lists own, non-voided invoices
            admin.patch(f"{API}/invoices/{own_inv['id']}/void?voided=true")
            listed = cs.get(f"{API}/portal/orders").json()["invoices"]
            assert own_inv["id"] not in [i["id"] for i in listed]
            admin.patch(f"{API}/invoices/{own_inv['id']}/void?voided=false")
            listed = cs.get(f"{API}/portal/orders").json()["invoices"]
            assert own_inv["id"] in [i["id"] for i in listed]
            assert other_inv["id"] not in [i["id"] for i in listed]
        finally:
            _admin_delete(admin, f"/invoices/{own_inv['id']}")
            _admin_delete(admin, f"/invoices/{other_inv['id']}")
            admin.delete(f"{API}/portal-accounts/{uid}")
            admin.delete(f"{API}/customers/{own_cid}")

    def test_portal_disabled_customer_gets_403(self, admin):
        email = "test_it6_disabled@it6test.example.com"
        pw = "PortalOff2026!"
        for a in admin.get(f"{API}/portal-accounts").json():
            if a["email"] == email:
                admin.delete(f"{API}/portal-accounts/{a['id']}")
        acct = admin.post(f"{API}/portal-accounts", json={
            "name": "TEST_it6 Disabled", "email": email, "password": pw}).json()
        uid, cid = acct["id"], acct["customer_id"]
        try:
            cs = _login(email, pw)
            assert cs.get(f"{API}/portal/orders").status_code == 200
            cust = [c for c in admin.get(f"{API}/customers").json() if c["id"] == cid][0]
            body = {k: cust.get(k) for k in
                    ("name", "company", "email", "phone", "address", "notes", "tier", "title", "net_terms")}
            body["portal_enabled"] = False
            assert admin.put(f"{API}/customers/{cid}", json=body).status_code == 200
            r = cs.get(f"{API}/portal/orders")
            assert r.status_code == 403
            assert "not enabled" in r.json()["detail"].lower()
        finally:
            admin.delete(f"{API}/portal-accounts/{uid}")
            admin.delete(f"{API}/customers/{cid}")
