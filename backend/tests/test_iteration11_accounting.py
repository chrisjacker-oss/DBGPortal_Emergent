"""Iteration 11 — Auto accounting email on full payment (manual payment + on-demand endpoint + settings)."""
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
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PASSWORD = "10297099"
ACCOUNTING_EMAIL = "michelle@dbgsigns.com"


def _admin_creds():
    p = Path("/app/memory/test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    m = re.search(r"## Admin \(DBG\)\s*\n- Email:\s*(\S+)\s*\n- Password:\s*(\S+)", txt)
    if not m:
        pytest.skip("DBG admin credentials not found in test_credentials.md")
    return {"email": m.group(1), "password": m.group(2)}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    creds = _admin_creds()
    r = s.post(f"{API}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    assert s.cookies, "No cookie set on login (httpOnly cookie auth expected)"
    me = s.get(f"{API}/auth/me", timeout=60)
    assert me.status_code == 200, f"/auth/me failed: {me.status_code} {me.text[:200]}"
    assert me.json().get("role") == "admin"
    return s


@pytest.fixture(scope="module")
def customer_id(client):
    r = client.get(f"{API}/customers", timeout=60)
    assert r.status_code == 200, r.text[:300]
    items = r.json()
    items = items.get("items") if isinstance(items, dict) else items
    assert items, "No customers available to build a test invoice"
    return str(items[0].get("id") or items[0].get("_id"))


@pytest.fixture(scope="module")
def created_invoice_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(client, created_invoice_ids):
    yield
    if created_invoice_ids:
        r = client.post(f"{API}/invoices/bulk-delete",
                        json={"ids": created_invoice_ids, "password": ADMIN_PASSWORD}, timeout=90)
        print(f"CLEANUP bulk-delete -> {r.status_code} {r.text[:200]}")


def _create(client, customer_id, created_invoice_ids, price, title):
    payload = {
        "customer_id": customer_id,
        "title": title,
        "line_items": [{"description": "TEST_ accounting item", "quantity": 1,
                        "width_in": 12, "height_in": 12, "price_per_sqft": 0,
                        "line_total_override": price}],
        "tax_rate": 0.0,
    }
    r = client.post(f"{API}/invoices", json=payload, timeout=90)
    assert r.status_code in (200, 201), f"Create invoice failed {r.status_code}: {r.text[:400]}"
    inv = r.json()
    iid = str(inv.get("id") or inv.get("_id"))
    created_invoice_ids.append(iid)
    assert "_id" not in inv, "Mongo _id leaked in invoice response"
    assert float(inv["total"]) == pytest.approx(price, abs=0.01), f"total={inv.get('total')}"
    return iid, inv


# --- Settings: accounting_email persistence ---
class TestSettingsAccountingEmail:
    def test_get_settings_accounting_email(self, client):
        r = client.get(f"{API}/settings", timeout=60)
        assert r.status_code == 200, r.text[:300]
        s = r.json()
        assert "accounting_email" in s, "accounting_email field missing from GET /api/settings"
        assert s["accounting_email"] == ACCOUNTING_EMAIL, f"got {s['accounting_email']!r}"

    def test_put_settings_preserves_accounting_email(self, client):
        cur = client.get(f"{API}/settings", timeout=60).json()
        cur.pop("_id", None)
        r = client.put(f"{API}/settings", json=cur, timeout=60)
        assert r.status_code == 200, f"PUT settings failed {r.status_code}: {r.text[:300]}"
        assert r.json().get("accounting_email") == ACCOUNTING_EMAIL
        again = client.get(f"{API}/settings", timeout=60).json()
        assert again.get("accounting_email") == ACCOUNTING_EMAIL, "accounting_email not persisted after PUT"


# --- Manual payment: full payment marks paid + auto accounting email must not 500 ---
class TestManualFullPayment:
    def test_full_payment_marks_paid_no_500(self, client, customer_id, created_invoice_ids):
        iid, inv = _create(client, customer_id, created_invoice_ids, 250.0, "TEST_ auto accounting full pay")
        assert inv.get("status") == "unpaid"
        r = client.post(f"{API}/invoices/{iid}/manual-payment",
                        json={"method": "Check", "reference": "TEST-1001", "notes": "TEST_ full payment"},
                        timeout=180)
        assert r.status_code == 200, f"manual-payment failed {r.status_code}: {r.text[:500]}"
        paid = r.json()
        assert paid["status"] == "paid", f"status={paid.get('status')}"
        assert float(paid["amount_paid"]) == pytest.approx(250.0, abs=0.01)
        assert paid.get("paid_via") == "Check"
        assert paid.get("paid_at")
        # persistence check via list endpoint (no single-invoice GET route exists)
        g = client.get(f"{API}/invoices", timeout=90)
        assert g.status_code == 200, g.text[:300]
        lst = g.json()
        lst = lst.get("items") if isinstance(lst, dict) else lst
        gj = next((i for i in lst if str(i.get("id") or i.get("_id")) == iid), None)
        assert gj, "Paid invoice not found in GET /api/invoices"
        assert gj["status"] == "paid" and float(gj["amount_paid"]) == pytest.approx(250.0, abs=0.01)
        # payment recorded
        p = client.get(f"{API}/invoices/{iid}/payments", timeout=60)
        assert p.status_code == 200
        pays = p.json()
        assert len(pays) >= 1
        assert float(pays[0]["amount"]) == pytest.approx(250.0, abs=0.01)
        assert "Check" in pays[0]["method"]

    def test_double_full_payment_rejected(self, client, customer_id, created_invoice_ids):
        iid, _ = _create(client, customer_id, created_invoice_ids, 100.0, "TEST_ double pay")
        r1 = client.post(f"{API}/invoices/{iid}/manual-payment", json={"method": "Cash"}, timeout=180)
        assert r1.status_code == 200, r1.text[:300]
        r2 = client.post(f"{API}/invoices/{iid}/manual-payment", json={"method": "Cash"}, timeout=120)
        assert r2.status_code == 400, f"expected 400 on already-paid, got {r2.status_code}"
        assert "paid in full" in r2.text.lower()

    def test_overpayment_rejected(self, client, customer_id, created_invoice_ids):
        iid, _ = _create(client, customer_id, created_invoice_ids, 100.0, "TEST_ overpay")
        r = client.post(f"{API}/invoices/{iid}/manual-payment",
                        json={"amount": 500.0, "method": "Check"}, timeout=120)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"


# --- Partial payment must NOT mark paid (auto accounting should not trigger) ---
class TestPartialPayment:
    def test_partial_payment_status_partial(self, client, customer_id, created_invoice_ids):
        iid, _ = _create(client, customer_id, created_invoice_ids, 400.0, "TEST_ partial pay")
        r = client.post(f"{API}/invoices/{iid}/manual-payment",
                        json={"amount": 150.0, "method": "ACH", "reference": "TEST-PART"}, timeout=180)
        assert r.status_code == 200, f"manual-payment failed {r.status_code}: {r.text[:500]}"
        j = r.json()
        assert j["status"] == "partial", f"status={j.get('status')}"
        assert float(j["amount_paid"]) == pytest.approx(150.0, abs=0.01)
        assert not j.get("paid_at"), "paid_at should not be set on partial payment"
        assert not j.get("paid_via"), "paid_via should not be set on partial payment"
        # remaining balance payment makes it paid
        r2 = client.post(f"{API}/invoices/{iid}/manual-payment", json={"method": "Check"}, timeout=180)
        assert r2.status_code == 200, r2.text[:400]
        assert r2.json()["status"] == "paid"


# --- On-demand accounting email endpoint ---
class TestEmailAccountingEndpoint:
    def test_email_accounting_paid_invoice(self, client, customer_id, created_invoice_ids):
        iid, _ = _create(client, customer_id, created_invoice_ids, 199.99, "TEST_ on-demand accounting")
        pr = client.post(f"{API}/invoices/{iid}/manual-payment", json={"method": "Wire"}, timeout=180)
        assert pr.status_code == 200, pr.text[:400]
        r = client.post(f"{API}/invoices/{iid}/email-accounting",
                        json={"email": ACCOUNTING_EMAIL}, timeout=180)
        assert r.status_code == 200, f"email-accounting failed {r.status_code}: {r.text[:500]}"
        j = r.json()
        assert j.get("sent_to") == ACCOUNTING_EMAIL
        assert isinstance(j.get("payments"), int) and j["payments"] >= 1, f"payments={j.get('payments')}"

    def test_email_accounting_defaults_to_settings(self, client, customer_id, created_invoice_ids):
        iid, _ = _create(client, customer_id, created_invoice_ids, 50.0, "TEST_ accounting default email")
        r = client.post(f"{API}/invoices/{iid}/email-accounting", json={}, timeout=180)
        assert r.status_code == 200, f"failed {r.status_code}: {r.text[:400]}"
        assert r.json().get("sent_to") == ACCOUNTING_EMAIL

    def test_email_accounting_404_bad_invoice(self, client):
        r = client.post(f"{API}/invoices/68000000000000000000dead/email-accounting",
                        json={"email": ACCOUNTING_EMAIL}, timeout=60)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:300]}"

    def test_email_accounting_requires_auth(self, customer_id, created_invoice_ids, client):
        anon = requests.Session()
        iid = created_invoice_ids[0] if created_invoice_ids else "68000000000000000000dead"
        r = anon.post(f"{API}/invoices/{iid}/email-accounting", json={"email": ACCOUNTING_EMAIL}, timeout=60)
        assert r.status_code in (401, 403), f"expected 401/403 for anon, got {r.status_code}"

    def test_manual_payment_requires_auth(self, created_invoice_ids, client):
        anon = requests.Session()
        iid = created_invoice_ids[0] if created_invoice_ids else "68000000000000000000dead"
        r = anon.post(f"{API}/invoices/{iid}/manual-payment", json={"method": "Check"}, timeout=60)
        assert r.status_code in (401, 403), f"expected 401/403 for anon, got {r.status_code}"
