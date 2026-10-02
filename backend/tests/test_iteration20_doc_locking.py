"""Iteration 20: Document locking tests for Estimates/SOs/Invoices.

Tests:
- Admin and salesmen can edit non-customer fields; no role can change customer_id (400).
- Only an admin can duplicate all 3 document types.
- Salesman PATCH status/void on SO and Invoice return 403.
- Salesman work-status PATCH remains available on Sales Orders and Invoices only.
- Estimate work-status PATCH is removed (404).
"""

import os
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {
    "email": os.environ["TEST_ADMIN_EMAIL"],
    "password": os.environ["TEST_ADMIN_PASSWORD"],
}
SALES = {
    "email": os.environ["TEST_SALESMAN_EMAIL"],
    "password": os.environ["TEST_SALESMAN_PASSWORD"],
}


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return login(ADMIN)


@pytest.fixture(scope="module")
def sales():
    return login(SALES)


@pytest.fixture(scope="module")
def customers(admin):
    r = admin.get(f"{API}/customers", timeout=20)
    assert r.status_code == 200
    cs = r.json()
    assert len(cs) >= 2, "need at least 2 customers for reassignment tests"
    return cs


def _mk_payload(customer_id, title="TEST_locking_doc"):
    return {
        "customer_id": customer_id,
        "title": title,
        "line_items": [
            {"description": "widget", "quantity": 1, "unit_price": 10.0}
        ],
        "tax_rate": 0,
        "discount_rate": 0,
        "shipping_cost": 0,
        "notes": "qa",
    }


@pytest.fixture(scope="module")
def created_docs(admin, customers):
    """Create one estimate, one SO, one invoice for the tests."""
    c0 = customers[0]["id"]
    created = {}
    # Estimate
    r = admin.post(f"{API}/estimates", json=_mk_payload(c0), timeout=20)
    assert r.status_code == 200, r.text
    created["estimate"] = r.json()
    # Sales order
    r = admin.post(f"{API}/sales-orders", json=_mk_payload(c0), timeout=20)
    assert r.status_code == 200, r.text
    created["sales_order"] = r.json()
    # Invoice
    r = admin.post(f"{API}/invoices", json=_mk_payload(c0), timeout=20)
    assert r.status_code == 200, r.text
    created["invoice"] = r.json()
    yield created
    # Cleanup via admin delete w/ password
    pw = {"password": ADMIN["password"]}
    for coll, doc in [("estimates", created["estimate"]),
                      ("sales-orders", created["sales_order"]),
                      ("invoices", created["invoice"])]:
        try:
            admin.request("DELETE", f"{API}/{coll}/{doc['id']}", json=pw, timeout=20)
        except Exception:
            pass


class TestAdminEditLocking:
    def test_admin_edit_same_customer_ok(self, admin, created_docs, customers):
        for coll, doc in [("estimates", created_docs["estimate"]),
                          ("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            payload = _mk_payload(doc["customer_id"], title="TEST_locking_edited")
            r = admin.put(f"{API}/{coll}/{doc['id']}", json=payload, timeout=20)
            assert r.status_code == 200, f"{coll} edit failed: {r.status_code} {r.text}"
            assert r.json()["title"] == "TEST_locking_edited"
            assert str(r.json()["customer_id"]) == str(doc["customer_id"])

    def test_admin_cannot_change_customer(self, admin, created_docs, customers):
        other = customers[1]["id"]
        for coll, doc in [("estimates", created_docs["estimate"]),
                          ("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            payload = _mk_payload(other, title="TEST_locking_reassign")
            r = admin.put(f"{API}/{coll}/{doc['id']}", json=payload, timeout=20)
            assert 400 <= r.status_code < 500, f"{coll} should 4xx got {r.status_code}"
            assert r.status_code == 400, f"{coll} expected 400 got {r.status_code}"
            # Verify customer unchanged by listing
            g = admin.get(f"{API}/{coll}", timeout=20)
            assert g.status_code == 200
            found = next((x for x in g.json() if str(x.get("id")) == str(doc["id"])), None)
            assert found is not None
            assert str(found["customer_id"]) == str(doc["customer_id"])


class TestAdminDuplicate:
    def test_admin_duplicate_all(self, admin, created_docs):
        dups = []
        for coll, doc in [("estimates", created_docs["estimate"]),
                          ("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            r = admin.post(f"{API}/{coll}/{doc['id']}/duplicate", timeout=20)
            assert r.status_code == 200, f"{coll} dup failed: {r.status_code} {r.text}"
            d = r.json()
            assert d["id"] != doc["id"]
            assert d["number"] != doc["number"]
            dups.append((coll, d["id"]))
        # cleanup dups
        pw = {"password": ADMIN["password"]}
        for coll, did in dups:
            admin.request("DELETE", f"{API}/{coll}/{did}", json=pw, timeout=20)


class TestSalesmanEditing:
    def test_salesman_put_allowed_and_customer_remains_locked(self, sales, created_docs, customers):
        for coll, doc in [("estimates", created_docs["estimate"]),
                          ("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            payload = _mk_payload(doc["customer_id"], title="TEST_salesman_edit")
            r = sales.put(f"{API}/{coll}/{doc['id']}", json=payload, timeout=20)
            assert r.status_code == 200, f"{coll} salesman edit failed: {r.status_code} {r.text}"
            assert r.json()["title"] == "TEST_salesman_edit"
            assert str(r.json()["customer_id"]) == str(doc["customer_id"])
            assert r.json().get("salesman_id") == doc.get("salesman_id")

            locked = _mk_payload(customers[1]["id"], title="TEST_salesman_reassign")
            blocked = sales.put(f"{API}/{coll}/{doc['id']}", json=locked, timeout=20)
            assert blocked.status_code == 400, (
                f"{coll} salesman customer change expected 400, got {blocked.status_code}"
            )

    def test_salesman_duplicate_denied(self, sales, created_docs):
        for coll, doc in [("estimates", created_docs["estimate"]),
                          ("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            r = sales.post(f"{API}/{coll}/{doc['id']}/duplicate", timeout=20)
            assert r.status_code == 403, f"{coll} salesman dup should 403 got {r.status_code}"

    def test_salesman_status_denied(self, sales, created_docs):
        # SO status
        sid = created_docs["sales_order"]["id"]
        r = sales.patch(f"{API}/sales-orders/{sid}/status?status=in_production", timeout=20)
        assert r.status_code == 403, f"SO status salesman should 403 got {r.status_code}"
        # Invoice status
        iid = created_docs["invoice"]["id"]
        r = sales.patch(f"{API}/invoices/{iid}/status?status=paid", timeout=20)
        assert r.status_code == 403, f"Invoice status salesman should 403 got {r.status_code}"


class TestSalesmanWorkStatusAllowed:
    def test_salesman_work_status_on_orders_and_invoices(self, sales, created_docs):
        for coll, doc in [("sales-orders", created_docs["sales_order"]),
                          ("invoices", created_docs["invoice"])]:
            # Use a plausible work status; backend validates set — try common ones
            tried = []
            for st in ("waiting", "in_progress", "ready", "on_hold", "done"):
                r = sales.patch(f"{API}/{coll}/{doc['id']}/work-status?status={st}", timeout=20)
                tried.append((st, r.status_code))
                if r.status_code == 200:
                    break
            assert any(code == 200 for _, code in tried), f"{coll} work-status all failed: {tried}"


def test_estimate_work_status_is_removed(sales, created_docs):
    estimate_id = created_docs["estimate"]["id"]
    response = sales.patch(
        f"{API}/estimates/{estimate_id}/work-status?status=in_production",
        timeout=20,
    )
    assert response.status_code == 404
    estimates = sales.get(f"{API}/estimates", timeout=20)
    assert estimates.status_code == 200
    estimate = next(row for row in estimates.json() if row["id"] == estimate_id)
    assert "work_status" not in estimate
