"""Iteration 5 backend tests: customer tiers/discounts, customer fields, portal gating,
settings throughput persistence, past-due receivables, PDFs, site-wide search, RBAC, Xero export."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

ADMIN = {"email": "sales@dbgsigns.com", "password": "10297099"}
SALESMAN = {"email": "sam@dbgsigns.com", "password": "Sales2026!"}
MAIL = "delivered@resend.dev"

STATE = {}


def login(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return login(ADMIN)


@pytest.fixture(scope="module")
def sales():
    return login(SALESMAN)


def mk_customer(admin, tier, **extra):
    body = {"name": f"TEST_Tier{tier}_{uuid.uuid4().hex[:6]}", "company": f"TEST_Co_T{tier}",
            "email": MAIL, "tier": tier}
    body.update(extra)
    r = admin.post(f"{BASE}/customers", json=body, timeout=60)
    assert r.status_code in (200, 201), r.text[:300]
    c = r.json()
    STATE.setdefault("customers", []).append(c["id"])
    return c


LINE = [{"description": "TEST_100sqft panel", "width_in": 120, "height_in": 120,
         "quantity": 1, "price_per_sqft": 2.0, "extra_labor_hours": 0}]


def mk_estimate(sess, customer_id, tax_rate=10.0, title="TEST_Tier Estimate"):
    r = sess.post(f"{BASE}/estimates", json={"customer_id": customer_id, "title": title,
                                             "line_items": LINE, "tax_rate": tax_rate}, timeout=60)
    assert r.status_code in (200, 201), r.text[:400]
    e = r.json()
    STATE.setdefault("estimates", []).append(e["id"])
    return e


# --------------------------------------------------------------- health/base
class TestHealth:
    def test_admin_me(self, admin):
        r = admin.get(f"{BASE}/auth/me", timeout=60)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_settings_defaults(self, admin):
        r = admin.get(f"{BASE}/settings", timeout=60)
        assert r.status_code == 200
        d = r.json()
        for k in ("shop_rate_per_hr", "shop_sqft_per_hr", "machine_rate_per_hr",
                  "machine_sqft_per_hr", "default_markup"):
            assert k in d


# --------------------------------------------------------------- customer fields
class TestCustomerFields:
    def test_create_with_new_fields_and_persist(self, admin):
        c = mk_customer(admin, 2, title="Purchasing Manager", net_terms="Net 10", portal_enabled=True)
        assert c["tier"] == 2
        assert c["title"] == "Purchasing Manager"
        assert c["net_terms"] == "Net 10"
        assert c["portal_enabled"] is True
        g = admin.get(f"{BASE}/customers", timeout=60)
        assert g.status_code == 200
        row = next(x for x in g.json() if x["id"] == c["id"])
        assert row["title"] == "Purchasing Manager"
        assert row["net_terms"] == "Net 10"
        assert row["portal_enabled"] is True
        assert row["tier"] == 2

    def test_update_fields_persist(self, admin):
        c = mk_customer(admin, 3, title="Owner", net_terms="COD", portal_enabled=False)
        r = admin.put(f"{BASE}/customers/{c['id']}", json={
            "name": c["name"], "company": c["company"], "email": MAIL,
            "tier": 1, "title": "President", "net_terms": "50/50", "portal_enabled": True}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert (d["tier"], d["title"], d["net_terms"], d["portal_enabled"]) == (1, "President", "50/50", True)
        row = next(x for x in admin.get(f"{BASE}/customers", timeout=60).json() if x["id"] == c["id"])
        assert row["net_terms"] == "50/50" and row["tier"] == 1

    def test_no_mongo_id_leak(self, admin):
        for x in admin.get(f"{BASE}/customers", timeout=60).json():
            assert "_id" not in x


# --------------------------------------------------------------- tier discounts
class TestTierDiscount:
    @pytest.mark.parametrize("tier,rate", [(1, 35.0), (2, 25.0), (3, 15.0), (None, 0.0)])
    def test_estimate_discount_math(self, admin, tier, rate):
        c = mk_customer(admin, tier)
        e = mk_estimate(admin, c["id"])
        sub = e["subtotal"]
        assert sub == 266.66, f"expected subtotal 266.66, got {sub}"
        assert e["discount_rate"] == rate
        exp_disc = round(sub * rate / 100.0, 2)
        assert e["discount_amount"] == exp_disc
        exp_tax = round(round(sub - exp_disc, 2) * 0.10, 2)
        assert e["tax_amount"] == exp_tax
        assert e["total"] == round(round(sub - exp_disc, 2) + exp_tax, 2)
        if tier == 1:
            assert (e["discount_amount"], e["tax_amount"], e["total"]) == (93.33, 17.33, 190.66)

    def test_commission_on_materials_pre_discount(self, sales):
        # iteration 6: commission base = materials-only at selling price (pre-discount, pre-tax)
        adm = login(ADMIN)
        c = mk_customer(adm, 1)
        e = mk_estimate(sales, c["id"], title="TEST_Commission Tier1")
        assert e["discount_rate"] == 35.0
        assert e["commission_rate"] == 10.0
        mats = round(sum(li["material_cost"] for li in e["line_items"]), 2)
        assert e["commission_base"] == mats
        assert e["commission_amount"] == round(mats * 0.10, 2)

    def test_discount_carries_est_so_inv(self, admin):
        c = mk_customer(admin, 1)
        e = mk_estimate(admin, c["id"], title="TEST_Chain Tier1")
        ap = admin.post(f"{BASE}/estimates/{e['id']}/approve", timeout=60)
        assert ap.status_code in (200, 201), ap.text[:300]
        so = ap.json()
        STATE.setdefault("sales_orders", []).append(so["id"])
        assert so["discount_rate"] == 35.0 and so["discount_amount"] == 93.33
        assert so["total"] == e["total"]
        cv = admin.post(f"{BASE}/sales-orders/{so['id']}/convert", timeout=60)
        assert cv.status_code in (200, 201), cv.text[:300]
        inv = cv.json()
        STATE.setdefault("invoices", []).append(inv["id"])
        assert inv["discount_rate"] == 35.0 and inv["discount_amount"] == 93.33
        assert inv["total"] == e["total"]
        STATE["chain_invoice"] = inv["id"]
        STATE["chain_invoice_number"] = inv["number"]
        STATE["chain_estimate_id"] = e["id"]
        STATE["chain_so_id"] = so["id"]

    def test_invoice_direct_discount(self, admin):
        c = mk_customer(admin, 2)
        r = admin.post(f"{BASE}/invoices", json={"customer_id": c["id"], "title": "TEST_Direct Inv",
                                                 "line_items": LINE, "tax_rate": 10.0}, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        inv = r.json()
        STATE.setdefault("invoices", []).append(inv["id"])
        assert inv["discount_rate"] == 25.0
        assert inv["discount_amount"] == round(266.66 * 0.25, 2)


# --------------------------------------------------------------- settings persistence (prior HIGH)
class TestSettingsThroughput:
    def test_put_persists_throughput(self, admin):
        orig = admin.get(f"{BASE}/settings", timeout=60).json()
        try:
            r = admin.put(f"{BASE}/settings", json={
                "shop_rate_per_hr": 65, "shop_sqft_per_hr": 200,
                "machine_rate_per_hr": 35, "machine_sqft_per_hr": 250,
                "default_markup": 40}, timeout=60)
            assert r.status_code == 200, r.text[:300]
            assert r.json()["shop_sqft_per_hr"] == 200
            assert r.json()["machine_sqft_per_hr"] == 250
            g = admin.get(f"{BASE}/settings", timeout=60).json()
            assert g["shop_sqft_per_hr"] == 200
            assert g["machine_sqft_per_hr"] == 250
        finally:
            admin.put(f"{BASE}/settings", json={
                "shop_rate_per_hr": 65, "shop_sqft_per_hr": 150,
                "machine_rate_per_hr": 35, "machine_sqft_per_hr": 150,
                "default_markup": 40}, timeout=60)
        g = admin.get(f"{BASE}/settings", timeout=60).json()
        assert g["shop_sqft_per_hr"] == 150 and g["machine_sqft_per_hr"] == 150

    def test_throughput_costing_regression(self, admin):
        # 100 sqft: material 200 + labor 100/150*65=43.33 + machine 100/150*35=23.33 = 266.66
        c = mk_customer(admin, None)
        e = mk_estimate(admin, c["id"], tax_rate=0)
        li = e["line_items"][0]
        assert li["area_sqft"] == 100
        assert round(li["labor_cost"], 2) == 43.33
        assert round(li["machine_cost"], 2) == 23.33
        assert li["line_total"] == 266.66


# --------------------------------------------------------------- portal gating
class TestPortalGating:
    def test_registered_customer_can_access_then_gated(self, admin):
        email = f"test_portal_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        r = s.post(f"{BASE}/auth/register", json={"email": email, "password": "Portal2026!",
                                                  "name": "TEST_Portal User"}, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        tok = r.json().get("access_token") or r.json().get("token")
        if tok:
            s.headers.update({"Authorization": f"Bearer {tok}"})
        STATE["portal_email"] = email
        p = s.get(f"{BASE}/portal/orders", timeout=60)
        assert p.status_code == 200, p.text[:300]
        cust = p.json()["customer"]
        assert cust is not None and cust.get("portal_enabled") is True
        STATE.setdefault("customers", []).append(cust["id"])
        # admin disables portal access
        u = admin.put(f"{BASE}/customers/{cust['id']}", json={
            "name": cust["name"], "email": email, "portal_enabled": False}, timeout=60)
        assert u.status_code == 200, u.text[:300]
        assert u.json()["portal_enabled"] is False
        blocked = s.get(f"{BASE}/portal/orders", timeout=60)
        assert blocked.status_code == 403, f"expected 403, got {blocked.status_code}: {blocked.text[:200]}"
        assert "not enabled" in blocked.json().get("detail", "").lower()


# --------------------------------------------------------------- PDFs
class TestPdf:
    def test_invoice_estimate_so_pdf(self, admin):
        assert "chain_invoice" in STATE, "chain not created"
        for path, did in (("invoices", STATE["chain_invoice"]),
                          ("estimates", STATE["chain_estimate_id"]),
                          ("sales-orders", STATE["chain_so_id"])):
            r = admin.get(f"{BASE}/{path}/{did}/pdf", timeout=60)
            assert r.status_code == 200, f"{path} pdf {r.status_code}: {r.text[:200]}"
            assert r.headers["content-type"].startswith("application/pdf"), r.headers["content-type"]
            assert r.content[:4] == b"%PDF"

    def test_pdf_404_bad_id(self, admin):
        r = admin.get(f"{BASE}/invoices/000000000000000000000000/pdf", timeout=60)
        assert r.status_code == 404

    def test_public_pdf_bad_token(self):
        r = requests.get(f"{BASE}/pub/pdf/definitely-not-a-token", timeout=60)
        assert r.status_code == 404

    def test_pdf_requires_auth(self):
        r = requests.get(f"{BASE}/invoices/{STATE.get('chain_invoice', 'x')}/pdf", timeout=60)
        assert r.status_code in (401, 403)


# --------------------------------------------------------------- past due
class TestPastDue:
    def test_make_invoice_past_due_and_list(self, admin):
        iid = STATE["chain_invoice"]
        inv = next(x for x in admin.get(f"{BASE}/invoices", timeout=60).json() if x["id"] == iid)
        old_due = (datetime.now(timezone.utc) - timedelta(days=60)).date().isoformat()
        r = admin.put(f"{BASE}/invoices/{iid}", json={
            "customer_id": inv["customer_id"], "title": inv["title"],
            "line_items": inv["line_items"], "tax_rate": inv["tax_rate"],
            "due_date": old_due, "status": "unpaid"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["due_date"] == old_due
        od = admin.get(f"{BASE}/receivables/overdue", params={"days": 45}, timeout=60)
        assert od.status_code == 200, od.text[:300]
        rows = od.json()
        mine = [x for x in rows if x["id"] == iid]
        assert mine, "past-due invoice missing from /receivables/overdue"
        assert mine[0]["days_overdue"] == 60
        for x in rows:
            assert x["days_overdue"] > 45 and x["status"] != "paid"

    def test_overdue_days_param(self, admin):
        r = admin.get(f"{BASE}/receivables/overdue", params={"days": 365}, timeout=60)
        assert r.status_code == 200
        assert all(x["days_overdue"] > 365 for x in r.json())

    def test_send_past_due_email_and_read_receipt(self, admin):
        iid = STATE["chain_invoice"]
        r = admin.post(f"{BASE}/invoices/{iid}/send-past-due", timeout=120)
        if r.status_code == 429:
            pytest.skip(f"email provider rate limited: {r.text[:150]}")
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        assert d["sent"] is True
        assert d["to"] == MAIL
        time.sleep(2)
        inv = next(x for x in admin.get(f"{BASE}/invoices", timeout=60).json() if x["id"] == iid)
        assert inv["email_status"] == "sent"
        assert inv.get("past_due_sent_at")
        token = inv.get("email_token")
        assert token, "email_token not stored on invoice"
        px = requests.get(f"{BASE}/track/open/{token}", timeout=60)
        assert px.status_code == 200
        assert px.headers["content-type"].startswith("image/")
        inv2 = next(x for x in admin.get(f"{BASE}/invoices", timeout=60).json() if x["id"] == iid)
        assert inv2["email_status"] == "opened", inv2["email_status"]
        assert inv2.get("email_opened_at")

    def test_public_pdf_token_from_email(self, admin):
        # the send flow created a pdf token; verify tokenized public PDF works without auth
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL") or dotenv_values("/app/backend/.env").get("MONGO_URL")
        dbname = dotenv_values("/app/backend/.env").get("DB_NAME")
        cli = MongoClient(mongo_url)
        rec = cli[dbname].pdf_tokens.find_one({"doc_id": STATE["chain_invoice"]})
        cli.close()
        if not rec:
            pytest.skip("no pdf token (email send skipped)")
        r = requests.get(f"{BASE}/pub/pdf/{rec['token']}", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_send_past_due_no_email_customer(self, admin):
        c = mk_customer(admin, None, email=None)
        r = admin.post(f"{BASE}/invoices", json={"customer_id": c["id"], "title": "TEST_NoEmail Inv",
                                                 "line_items": LINE, "tax_rate": 0}, timeout=60)
        inv = r.json()
        STATE.setdefault("invoices", []).append(inv["id"])
        s = admin.post(f"{BASE}/invoices/{inv['id']}/send-past-due", timeout=60)
        assert s.status_code == 200, s.text[:200]
        assert s.json()["sent"] is False
        assert "email" in s.json()["reason"]


# --------------------------------------------------------------- search
class TestSearch:
    def test_search_invoice_number(self, admin):
        num = STATE["chain_invoice_number"]
        r = admin.get(f"{BASE}/search", params={"q": num}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        res = r.json()["results"]
        assert any(x["type"] == "Invoice" and x["label"] == num for x in res), res
        hit = next(x for x in res if x["label"] == num)
        assert hit["route"] == "/invoices" and hit["id"]

    def test_search_customer_and_material_and_line_item(self, admin):
        r = admin.get(f"{BASE}/search", params={"q": "TEST_Co_T1"}, timeout=60)
        assert r.status_code == 200
        assert any(x["type"] == "Customer" for x in r.json()["results"])

        mats = admin.get(f"{BASE}/materials", timeout=60).json()
        assert mats, "no materials seeded"
        name = mats[0]["name"]
        rm = admin.get(f"{BASE}/search", params={"q": name[:6]}, timeout=60)
        assert rm.status_code == 200
        assert any(x["type"] == "Material" for x in rm.json()["results"]), rm.json()["results"]

        rl = admin.get(f"{BASE}/search", params={"q": "100sqft panel"}, timeout=60)
        assert rl.status_code == 200
        types = {x["type"] for x in rl.json()["results"]}
        assert types & {"Estimate", "Invoice", "Sales Order"}, rl.json()["results"]

    def test_search_empty_and_no_match(self, admin):
        assert admin.get(f"{BASE}/search", params={"q": ""}, timeout=60).json()["results"] == []
        r = admin.get(f"{BASE}/search", params={"q": "zzzzz_no_match_zzzzz"}, timeout=60)
        assert r.status_code == 200 and r.json()["results"] == []

    def test_search_regex_injection_safe(self, admin):
        r = admin.get(f"{BASE}/search", params={"q": "("}, timeout=60)
        assert r.status_code == 200, r.text[:200]

    def test_salesman_can_search(self, sales):
        r = sales.get(f"{BASE}/search", params={"q": "TEST_"}, timeout=60)
        assert r.status_code == 200, r.text[:200]

    def test_search_requires_auth(self):
        r = requests.get(f"{BASE}/search", params={"q": "a"}, timeout=60)
        assert r.status_code in (401, 403)


# --------------------------------------------------------------- RBAC
class TestRBAC:
    def test_salesman_blocked_admin_endpoints(self, sales):
        checks = [
            ("post", f"{BASE}/invoices/{STATE['chain_invoice']}/send-past-due", None),
            ("post", f"{BASE}/receivables/send-past-due", None),
            ("put", f"{BASE}/settings", {"shop_rate_per_hr": 1, "shop_sqft_per_hr": 1,
                                         "machine_rate_per_hr": 1, "machine_sqft_per_hr": 1,
                                         "default_markup": 1}),
            ("post", f"{BASE}/materials", {"name": "TEST_x"}),
            ("get", f"{BASE}/bills", None),
            ("get", f"{BASE}/users", None),
        ]
        failures = []
        for method, url, body in checks:
            r = getattr(sales, method)(url, json=body, timeout=60) if body else getattr(sales, method)(url, timeout=60)
            if r.status_code != 403:
                failures.append(f"{method.upper()} {url} -> {r.status_code}")
        assert not failures, failures

    def test_salesman_can_read_receivables_overdue_and_pdf(self, sales):
        assert sales.get(f"{BASE}/receivables/overdue", timeout=60).status_code == 200
        r = sales.get(f"{BASE}/invoices/{STATE['chain_invoice']}/pdf", timeout=60)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"


# --------------------------------------------------------------- Xero export
class TestXero:
    def test_invoice_export_has_negative_discount_row(self, admin):
        r = admin.get(f"{BASE}/export/xero/invoices", timeout=60)
        assert r.status_code == 200, r.text[:200]
        text = r.text
        assert "Tier discount" in text, "no Tier discount row in Xero CSV"
        line = next(ln for ln in text.splitlines() if "Tier discount" in ln)
        assert "-93.33" in line or "-" in line.split("Tier discount")[1], line


# --------------------------------------------------------------- cleanup
def test_zz_cleanup(admin):
    for iid in STATE.get("invoices", []):
        admin.delete(f"{BASE}/invoices/{iid}", timeout=60)
    for sid in STATE.get("sales_orders", []):
        admin.delete(f"{BASE}/sales-orders/{sid}", timeout=60)
    for eid in STATE.get("estimates", []):
        admin.delete(f"{BASE}/estimates/{eid}", timeout=60)
    for cid in set(STATE.get("customers", [])):
        admin.delete(f"{BASE}/customers/{cid}", timeout=60)
    s = admin.get(f"{BASE}/settings", timeout=60).json()
    assert s["shop_sqft_per_hr"] == 150 and s["machine_sqft_per_hr"] == 150
