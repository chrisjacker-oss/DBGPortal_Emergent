"""Iteration 4 backend tests: shop settings, throughput costing (machine+labor hours
derived from area), commission on full cost subtotal, document email send with
read-receipt tracking pixel, sequential numbering.

All tests live in a single class so pytest-xdist (--dist loadscope) keeps them on one
worker: several tests mutate the global shop settings document.
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = f"{base_url.rstrip('/')}/api"

DEFAULTS = {
    "shop_rate_per_hr": 65.0,
    "shop_sqft_per_hr": 150.0,
    "machine_rate_per_hr": 35.0,
    "machine_sqft_per_hr": 150.0,
    "default_markup": 40.0,
}


def _creds(section_regex):
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    c = p.read_text(encoding="utf-8")
    m = re.search(section_regex, c, re.I | re.S)
    if not m:
        pytest.skip(f"creds not found for {section_regex}")
    return {"email": m.group(1), "password": m.group(2)}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    return s


@pytest.fixture(scope="class")
def admin():
    return _login(_creds(r"Admin \(DBG\).*?Email:\s*(\S+).*?Password:\s*(\S+)"))


@pytest.fixture(scope="class")
def salesman():
    return _login(_creds(r"Salesman.*?Email:\s*(\S+).*?Password:\s*(\S+)"))


@pytest.fixture(scope="class")
def trash():
    """(collection_path, id) tuples deleted at class teardown."""
    return []


@pytest.fixture(scope="class", autouse=True)
def cleanup(admin, trash):
    yield
    for path, _id in reversed(trash):
        admin.delete(f"{API}/{path}/{_id}", timeout=30)
    admin.put(f"{API}/settings", json=DEFAULTS, timeout=30)


def _assert_sent(r):
    """Assert a /send call succeeded. The Emergent/Resend integration enforces a global
    email quota; when it is exhausted the backend surfaces 502 (upstream 429). That is an
    external quota condition, not an app defect, so it is reported as a skip."""
    if r.status_code in (429, 502):
        pytest.skip(f"email provider rate limit hit (HTTP {r.status_code}) - retry later")
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    return r.json()


def _mk_customer(admin, trash, name, email=None):
    r = admin.post(f"{API}/customers", json={"name": name, "email": email}, timeout=30)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    trash.append(("customers", cid))
    return cid


def _mk_estimate(sess, trash, customer_id, **kw):
    body = {"customer_id": customer_id, "title": "TEST_est", "tax_rate": 0, "line_items": []}
    body.update(kw)
    r = sess.post(f"{API}/estimates", json=body, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    trash.append(("estimates", d["id"]))
    return d


class TestIteration4:
    # -------------------- settings --------------------
    def test_settings_defaults(self, admin):
        r = admin.get(f"{API}/settings", timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        for k, v in DEFAULTS.items():
            assert s[k] == v, f"{k} expected {v} got {s.get(k)}"

    def test_settings_put_persists_then_restore(self, admin):
        new = {"shop_rate_per_hr": 70.0, "shop_sqft_per_hr": 200.0, "machine_rate_per_hr": 40.0,
               "machine_sqft_per_hr": 250.0, "default_markup": 45.0}
        r = admin.put(f"{API}/settings", json=new, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json() == new
        g = admin.get(f"{API}/settings", timeout=30).json()
        assert g == new, g
        # restore
        assert admin.put(f"{API}/settings", json=DEFAULTS, timeout=30).json() == DEFAULTS

    def test_settings_read_allowed_for_salesman_write_forbidden(self, salesman):
        assert salesman.get(f"{API}/settings", timeout=30).status_code == 200
        assert salesman.put(f"{API}/settings", json=DEFAULTS, timeout=30).status_code == 403

    # -------------------- throughput costing --------------------
    def test_throughput_costing_math(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Costing")
        est = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_line", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0, "extra_labor_hours": 0,
        }])
        li = est["line_items"][0]
        assert li["area_sqft"] == 16.0, li
        assert li["machine_hours"] == pytest.approx(0.1067, abs=0.0002), li
        assert li["machine_cost"] == pytest.approx(3.73, abs=0.02), li
        assert li["labor_hours"] == pytest.approx(0.1067, abs=0.0002), li
        assert li["labor_cost"] == pytest.approx(6.94, abs=0.02), li
        assert li["material_cost"] == 160.0, li
        assert li["line_total"] == pytest.approx(
            li["material_cost"] + li["labor_cost"] + li["machine_cost"], abs=0.01)
        assert est["subtotal"] == pytest.approx(li["line_total"], abs=0.01)

    def test_extra_labor_hours_adds_labor_cost(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Extra")
        base = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_base", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0}])["line_items"][0]
        extra = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_extra", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0, "extra_labor_hours": 2}])["line_items"][0]
        assert extra["labor_hours"] == pytest.approx(base["labor_hours"] + 2, abs=0.001)
        assert extra["labor_cost"] == pytest.approx(base["labor_cost"] + 130.0, abs=0.02)
        assert extra["machine_cost"] == base["machine_cost"]
        assert extra["line_total"] == pytest.approx(base["line_total"] + 130.0, abs=0.02)

    def test_costing_uses_updated_settings(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_SettingsCost")
        admin.put(f"{API}/settings", json={**DEFAULTS, "machine_sqft_per_hr": 8.0,
                                          "machine_rate_per_hr": 50.0}, timeout=30)
        try:
            li = _mk_estimate(admin, trash, cid, line_items=[{
                "description": "TEST_s", "width_in": 48, "height_in": 24,
                "quantity": 2, "price_per_sqft": 0}])["line_items"][0]
            assert li["machine_hours"] == pytest.approx(2.0, abs=0.001), li
            assert li["machine_cost"] == pytest.approx(100.0, abs=0.02), li
        finally:
            admin.put(f"{API}/settings", json=DEFAULTS, timeout=30)

    def test_persistence_after_get(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Persist")
        est = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_p", "width_in": 24, "height_in": 24,
            "quantity": 1, "price_per_sqft": 5.0}])
        rows = admin.get(f"{API}/estimates", timeout=30).json()
        got = next((e for e in rows if e["id"] == est["id"]), None)
        assert got is not None, "estimate not returned by list endpoint"
        assert "_id" not in got
        assert got["line_items"][0]["line_total"] == est["line_items"][0]["line_total"]

    # -------------------- commission --------------------
    def test_commission_on_full_cost_subtotal(self, salesman, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Comm")
        est = _mk_estimate(salesman, trash, cid, line_items=[{
            "description": "TEST_c", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0, "extra_labor_hours": 1}], tax_rate=8.0)
        assert est["commission_rate"] == 10.0, est
        assert est["salesman_name"], est
        assert est["commission_amount"] == pytest.approx(round(est["subtotal"] * 0.10, 2), abs=0.01)
        # commission is pre-tax: not based on total
        assert est["tax_amount"] > 0
        assert est["commission_amount"] != pytest.approx(round(est["total"] * 0.10, 2), abs=0.001)

    # -------------------- numbering --------------------
    def test_sequential_unique_numbering(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Num")
        nums = [_mk_estimate(admin, trash, cid)["number"] for _ in range(4)]
        assert len(set(nums)) == 4, nums
        seq = [int(n.split("-")[1]) for n in nums]
        assert seq == list(range(seq[0], seq[0] + 4)), nums
        existing = [e["number"] for e in admin.get(f"{API}/estimates", timeout=30).json()]
        assert len(existing) == len(set(existing)), "duplicate estimate numbers exist"

    # -------------------- email + read receipt --------------------
    def test_send_requires_customer_email(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_NoEmail")
        est = _mk_estimate(admin, trash, cid)
        r = admin.post(f"{API}/estimates/{est['id']}/send", timeout=60)
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"

    def test_send_estimate_and_read_receipt(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Deliver", email="delivered@resend.dev")
        est = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_email", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0}])
        body = _assert_sent(admin.post(f"{API}/estimates/{est['id']}/send", timeout=90))
        assert body["status"] == "sent"
        assert body["to"] == "delivered@resend.dev"

        rows = admin.get(f"{API}/estimates", timeout=30).json()
        doc = next(e for e in rows if e["id"] == est["id"])
        assert doc["email_status"] == "sent", doc
        assert doc.get("email_opened_at") is None
        token = doc.get("email_token")
        assert token, "email_token missing from list response"

        # tracking pixel is public (no auth session)
        px = requests.get(f"{API}/track/open/{token}", timeout=30)
        assert px.status_code == 200
        assert px.headers.get("content-type", "").startswith("image/gif")

        doc = next(e for e in admin.get(f"{API}/estimates", timeout=30).json() if e["id"] == est["id"])
        assert doc["email_status"] == "opened", doc
        first_open = doc.get("email_opened_at")
        assert first_open

        # second open must not overwrite the first-open timestamp
        requests.get(f"{API}/track/open/{token}", timeout=30)
        doc = next(e for e in admin.get(f"{API}/estimates", timeout=30).json() if e["id"] == est["id"])
        assert doc["email_opened_at"] == first_open

    def test_send_sales_order_and_invoice(self, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_Chain", email="delivered@resend.dev")
        est = _mk_estimate(admin, trash, cid, line_items=[{
            "description": "TEST_chain", "width_in": 48, "height_in": 24,
            "quantity": 2, "price_per_sqft": 10.0}])
        so = admin.post(f"{API}/estimates/{est['id']}/approve", timeout=30)
        assert so.status_code == 200, so.text
        so = so.json()
        trash.append(("sales-orders", so["id"]))
        assert _assert_sent(admin.post(f"{API}/sales-orders/{so['id']}/send", timeout=90))["status"] == "sent"

        inv = admin.post(f"{API}/sales-orders/{so['id']}/convert", timeout=30)
        assert inv.status_code == 200, inv.text
        inv = inv.json()
        trash.append(("invoices", inv["id"]))
        assert _assert_sent(admin.post(f"{API}/invoices/{inv['id']}/send", timeout=90))["status"] == "sent"
        # commission carried through
        assert inv["commission_rate"] == est["commission_rate"]
        assert inv["commission_amount"] == est["commission_amount"]

        # invoice receipt flips to opened
        idoc = next(i for i in admin.get(f"{API}/invoices", timeout=30).json() if i["id"] == inv["id"])
        assert idoc["email_status"] == "sent"
        requests.get(f"{API}/track/open/{idoc['email_token']}", timeout=30)
        idoc = next(i for i in admin.get(f"{API}/invoices", timeout=30).json() if i["id"] == inv["id"])
        assert idoc["email_status"] == "opened", idoc

    def test_salesman_can_send(self, salesman, admin, trash):
        cid = _mk_customer(admin, trash, "TEST_SalesSend", email="delivered@resend.dev")
        est = _mk_estimate(salesman, trash, cid)
        _assert_sent(salesman.post(f"{API}/estimates/{est['id']}/send", timeout=90))

    def test_send_unknown_doc_404(self, admin):
        r = admin.post(f"{API}/estimates/000000000000000000000000/send", timeout=30)
        assert r.status_code == 404, r.status_code

    def test_track_unknown_token_still_returns_pixel(self):
        r = requests.get(f"{API}/track/open/nope-not-a-token", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/gif")
