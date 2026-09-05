"""Iteration 11 retest: invoice manual payment -> paid + accounting email w/ tokenized PDF link,
public invoice PDF endpoint (/api/pub/invoice-pdf/{token})."""
import os
import re
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = backend_env.get("MONGO_URL") or os.environ.get("MONGO_URL")
DB_NAME = backend_env.get("DB_NAME") or os.environ.get("DB_NAME")


def _creds():
    content = Path("/app/memory/test_credentials.md").read_text()
    m = re.search(r"## Admin \(DBG\).*?Email: (\S+).*?Password: (\S+)", content, re.S)
    assert m, "admin creds not found"
    return m.group(1), m.group(2)


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    email, pw = _creds()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    assert any(c.name for c in s.cookies), "no cookies set on login"
    return s


@pytest.fixture(scope="module")
def mongo():
    if not MONGO_URL or not DB_NAME:
        pytest.skip("mongo env missing")
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


# --- module: auth ---
def test_auth_me(admin):
    r = admin.get(f"{API}/auth/me", timeout=30)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d.get("role") == "admin"


def test_bcrypt_hash_and_cookies(mongo):
    u = mongo.users.find_one({"email": _creds()[0]})
    assert u, "admin user not seeded"
    assert str(u.get("password_hash") or u.get("password") or "").startswith("$2b$"), "bcrypt hash format invalid"


# --- module: invoices list (blank-screen bug support API) ---
def test_invoices_list(admin):
    r = admin.get(f"{API}/invoices", timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert isinstance(data, list)
    for inv in data[:5]:
        assert "_id" not in inv
        assert "id" in inv and "number" in inv


# --- module: manual payment + auto accounting email + public pdf link ---
@pytest.fixture(scope="module")
def test_invoice(admin):
    cr = admin.post(f"{API}/customers", json={"name": "TEST_QA_PDFLink", "company": "TEST_QA Co",
                                              "email": "qa-test@example.com"}, timeout=30)
    assert cr.status_code in (200, 201), cr.text[:300]
    cid = cr.json()["id"]
    payload = {
        "customer_id": cid,
        "title": "TEST_QA Invoice",
        "line_items": [{"description": "TEST_QA line", "quantity": 1, "unit_price": 5, "width_in": 12,
                        "height_in": 12, "category": "Other"}],
        "notes": "TEST_QA invoice",
    }
    ir = admin.post(f"{API}/invoices", json=payload, timeout=60)
    assert ir.status_code in (200, 201), f"invoice create failed {ir.status_code}: {ir.text[:400]}"
    inv = ir.json()
    yield inv
    pw = _creds()[1]
    d1 = admin.delete(f"{API}/invoices/{inv['id']}", json={"password": pw}, timeout=30)
    d2 = admin.delete(f"{API}/customers/{cid}", json={"password": pw}, timeout=30)
    print(f"cleanup: invoice={d1.status_code} customer={d2.status_code}")


def test_manual_full_payment_marks_paid(admin, test_invoice, mongo):
    iid = test_invoice["id"]
    total = float(test_invoice.get("total") or 0)
    assert total > 0, f"invoice total should be > 0, got {total}"
    before = mongo.invoice_pdf_tokens.count_documents({"invoice_id": iid})
    r = admin.post(f"{API}/invoices/{iid}/manual-payment",
                   json={"method": "Check", "reference": "TEST_QA-001", "notes": "TEST_QA full payment"},
                   timeout=120)
    assert r.status_code == 200, f"manual-payment failed {r.status_code}: {r.text[:400]}"
    d = r.json()
    assert d["status"] == "paid", d
    assert abs(float(d["amount_paid"]) - total) < 0.01
    assert d.get("paid_at")
    # verify persistence (no single-invoice GET route; use list)
    g = admin.get(f"{API}/invoices", timeout=60)
    assert g.status_code == 200
    match = [x for x in g.json() if x["id"] == iid]
    assert match and match[0]["status"] == "paid", match[:1]
    # accounting/receipt emails should have minted pdf link tokens (proves flow ran)
    time.sleep(1)
    after = mongo.invoice_pdf_tokens.count_documents({"invoice_id": iid})
    assert after > before, "no invoice_pdf_tokens minted -> accounting/receipt email flow did not run"


def test_public_invoice_pdf_valid_token(test_invoice, mongo):
    iid = test_invoice["id"]
    rec = mongo.invoice_pdf_tokens.find_one({"invoice_id": iid}, sort=[("created_at", -1)])
    assert rec, "no token available"
    r = requests.get(f"{API}/pub/invoice-pdf/{rec['token']}", timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
    assert r.content[:4] == b"%PDF", r.content[:20]
    assert len(r.content) > 1000
    assert test_invoice["number"] in r.headers.get("content-disposition", "")


def test_public_invoice_pdf_invalid_token():
    r = requests.get(f"{API}/pub/invoice-pdf/nonexistent-token-xyz", timeout=30)
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"


def test_public_invoice_pdf_no_auth_required(test_invoice, mongo):
    rec = mongo.invoice_pdf_tokens.find_one({"invoice_id": test_invoice["id"]}, sort=[("created_at", -1)])
    s = requests.Session()  # fresh session, no cookies
    r = s.get(f"{API}/pub/invoice-pdf/{rec['token']}", timeout=60)
    assert r.status_code == 200


def test_manual_payment_on_paid_invoice_rejected(admin, test_invoice):
    r = admin.post(f"{API}/invoices/{test_invoice['id']}/manual-payment",
                   json={"amount": 1, "method": "Cash"}, timeout=60)
    assert r.status_code == 400, r.status_code
    assert "paid in full" in r.json().get("detail", "").lower()


def test_email_accounting_endpoint(admin, test_invoice):
    r = admin.post(f"{API}/invoices/{test_invoice['id']}/email-accounting",
                   json={"email": "delivered@resend.dev"}, timeout=120)
    assert r.status_code in (200, 429), f"{r.status_code}: {r.text[:300]}"
    if r.status_code == 200:
        d = r.json()
        assert d["sent_to"] == "delivered@resend.dev"
        assert d["payments"] >= 1
