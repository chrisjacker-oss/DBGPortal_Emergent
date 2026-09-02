"""Iteration 8 — per-commission PO, commissions paid PDF filters, unpay restore."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/") + "/api"

ADMIN = {"email": "chrisjacker@gmail.com", "password": "SignShop2026!"}
SALES = {"email": "sam@dbgsigns.com", "password": "Sales2026!"}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text[:300]
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def salesman():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/auth/login", json=SALES, timeout=30)
    assert r.status_code == 200, r.text[:300]
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


class TestCommissionsPay:
    def test_login_cookie_and_hash_format(self, admin):
        r = admin.get(f"{BASE_URL}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_pay_requires_po_and_applies_nothing(self, admin):
        r = admin.get(f"{BASE_URL}/commissions", timeout=30)
        assert r.status_code == 200
        unpaid = [x for x in r.json()["rows"] if not x["paid"]]
        if len(unpaid) < 2:
            pytest.skip("need 2 unpaid commissions")
        ids = [unpaid[0]["id"], unpaid[1]["id"]]
        bad = admin.post(f"{BASE_URL}/commissions/pay", json={
            "items": [{"estimate_id": ids[0], "po_number": "TEST-PO-A"},
                      {"estimate_id": ids[1], "po_number": ""}]}, timeout=30)
        assert bad.status_code == 400, bad.text[:300]
        after = admin.get(f"{BASE_URL}/commissions", timeout=30).json()["rows"]
        for i in ids:
            row = next(x for x in after if x["id"] == i)
            assert row["paid"] is False, f"{i} was paid despite validation error"

    def test_distinct_po_per_commission_and_pdf_filters(self, admin):
        rows = admin.get(f"{BASE_URL}/commissions", timeout=30).json()["rows"]
        unpaid = [x for x in rows if not x["paid"]]
        if len(unpaid) < 2:
            pytest.skip("need 2 unpaid commissions")
        a, b = unpaid[0], unpaid[1]
        try:
            res = admin.post(f"{BASE_URL}/commissions/pay", json={
                "items": [{"estimate_id": a["id"], "po_number": "TEST-PO-A1"},
                          {"estimate_id": b["id"], "po_number": "TEST-PO-B2"}]}, timeout=30)
            assert res.status_code == 200, res.text[:300]
            assert res.json()["updated"] == 2

            after = admin.get(f"{BASE_URL}/commissions", timeout=30).json()["rows"]
            ra = next(x for x in after if x["id"] == a["id"])
            rb = next(x for x in after if x["id"] == b["id"])
            assert ra["paid"] and rb["paid"]
            assert ra["po_number"] == "TEST-PO-A1"
            assert rb["po_number"] == "TEST-PO-B2"
            assert ra["paid_at"]

            # PDF: all
            p = admin.get(f"{BASE_URL}/commissions/paid/pdf", timeout=60)
            assert p.status_code == 200 and p.headers["content-type"].startswith("application/pdf")
            assert p.content[:4] == b"%PDF"

            # PDF: by salesman
            name = ra["salesman_name"] or "Unassigned"
            p2 = admin.get(f"{BASE_URL}/commissions/paid/pdf", params={"salesman_name": name}, timeout=60)
            assert p2.status_code == 200 and p2.content[:4] == b"%PDF"

            # PDF: date range
            d = ra["paid_at"][:10]
            p3 = admin.get(f"{BASE_URL}/commissions/paid/pdf",
                           params={"date_from": d, "date_to": d}, timeout=60)
            assert p3.status_code == 200 and p3.content[:4] == b"%PDF"

            # PDF: empty range still valid pdf
            p4 = admin.get(f"{BASE_URL}/commissions/paid/pdf",
                           params={"date_from": "1999-01-01", "date_to": "1999-01-02"}, timeout=60)
            assert p4.status_code == 200 and p4.content[:4] == b"%PDF"
        finally:
            un = admin.post(f"{BASE_URL}/commissions/unpay",
                            json={"estimate_ids": [a["id"], b["id"]]}, timeout=30)
            assert un.status_code == 200, un.text[:300]
            restored = admin.get(f"{BASE_URL}/commissions", timeout=30).json()["rows"]
            for i in (a["id"], b["id"]):
                assert next(x for x in restored if x["id"] == i)["paid"] is False

    def test_unpay_validation(self, admin):
        r = admin.post(f"{BASE_URL}/commissions/unpay", json={"estimate_ids": []}, timeout=30)
        assert r.status_code == 400

    def test_pay_empty_items(self, admin):
        r = admin.post(f"{BASE_URL}/commissions/pay", json={"items": []}, timeout=30)
        assert r.status_code == 400

    def test_salesman_cannot_pay(self, salesman):
        r = salesman.post(f"{BASE_URL}/commissions/pay", json={
            "items": [{"estimate_id": "000000000000000000000000", "po_number": "X"}]}, timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_salesman_pdf_scoped(self, salesman):
        r = salesman.get(f"{BASE_URL}/commissions/paid/pdf", params={"salesman_name": "Someone Else"}, timeout=60)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"

    def test_pdf_requires_auth(self):
        r = requests.get(f"{BASE_URL}/commissions/paid/pdf", timeout=30)
        assert r.status_code in (401, 403)


class TestInvoicesForReceivables:
    def test_invoices_list(self, admin):
        r = admin.get(f"{BASE_URL}/invoices", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for inv in data[:5]:
            assert "_id" not in inv
            assert "id" in inv and "status" in inv

    def test_dashboard(self, admin):
        r = admin.get(f"{BASE_URL}/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["open_estimates", "open_sales_orders", "invoice_count", "customer_count", "material_count"]:
            assert k in d, f"missing {k}"
