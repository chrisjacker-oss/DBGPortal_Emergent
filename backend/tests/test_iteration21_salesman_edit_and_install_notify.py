"""Iteration 21: Salesman edit RBAC + install-schedule sales notification.

Covers:
- Salesman can PUT Estimate / SO / Invoice to change ordinary fields.
- Salesman PUT with different customer_id -> 400 (customer locked).
- Salesman edit preserves existing salesman_id / salesman_name / commission_rate.
- Salesman POST duplicate (all 3 doc types) -> 403; admin duplicate still works.
- Admin PUT with different customer_id -> 400 (customer lock applies to admin too).
- Public submit tentative-install flow records sales_notified_at or
  sales_notification_failed_at (one send only, do not spam provider).
- Notification is server-side to sales@dbgsigns.com (recipient not caller supplied).
"""
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_EMAIL = "delivered@resend.dev"


def _creds(regex):
    text = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    m = re.search(regex, text, re.I | re.S)
    return {"email": m.group(1), "password": m.group(2)}


ADMIN = _creds(r"Admin \(DBG\).*?Email:\s*(\S+).*?Password:\s*(\S+)")
SALES = _creds(r"Salesman.*?Email:\s*(\S+).*?Password:\s*(\S+)")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

_registry = {"customers": [], "contacts": [], "estimates": [], "sales_orders": [],
             "invoices": [], "install_schedule_requests": [], "installs": []}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def sales():
    return _login(SALES)


@pytest.fixture(scope="module")
def two_customers(admin):
    out = []
    for suffix in ("A", "B"):
        r = admin.post(f"{API}/customers", json={
            "name": f"TEST_iter21_cust_{suffix}",
            "company": f"TEST_iter21_co_{suffix}",
            "email": TEST_EMAIL, "phone": "555-000-0000",
        }, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        _registry["customers"].append(c["id"])
        out.append(c)
    return out


def _doc_payload(cid, title):
    return {
        "customer_id": cid, "title": title,
        "line_items": [{"description": "widget", "quantity": 1, "price": 10.0}],
        "tax_rate": 0.0, "status": "draft",
    }


@pytest.fixture(scope="module")
def docs(admin, two_customers):
    cid = two_customers[0]["id"]
    created = {}
    for coll, key in [("estimates", "estimate"),
                      ("sales-orders", "sales_order"),
                      ("invoices", "invoice")]:
        r = admin.post(f"{API}/{coll}", json=_doc_payload(cid, f"TEST_iter21_{key}"), timeout=30)
        assert r.status_code == 200, f"{coll}: {r.text}"
        d = r.json()
        created[key] = d
        _registry[coll.replace("-", "_")].append(d["id"])
    return created


# --- Salesman edit RBAC ---
class TestSalesmanEdit:
    def test_salesman_can_edit_fields_customer_locked_and_commission_preserved(
        self, sales, docs, two_customers
    ):
        other = two_customers[1]["id"]
        for coll, key in [("estimates", "estimate"),
                          ("sales-orders", "sales_order"),
                          ("invoices", "invoice")]:
            d = docs[key]
            # ordinary edit should pass
            p = _doc_payload(d["customer_id"], f"TEST_iter21_{key}_edited")
            r = sales.put(f"{API}/{coll}/{d['id']}", json=p, timeout=30)
            assert r.status_code == 200, f"{coll}: {r.status_code} {r.text}"
            updated = r.json()
            assert updated["title"] == f"TEST_iter21_{key}_edited"
            assert str(updated["customer_id"]) == str(d["customer_id"])
            # Commission/salesman assignment preserved
            assert updated.get("salesman_id") == d.get("salesman_id")
            assert updated.get("salesman_name") == d.get("salesman_name")
            assert updated.get("commission_rate") == d.get("commission_rate")

            # customer reassignment denied
            r2 = sales.put(f"{API}/{coll}/{d['id']}",
                           json=_doc_payload(other, "TEST_iter21_attempt_reassign"),
                           timeout=30)
            assert r2.status_code == 400, f"{coll}: expected 400 got {r2.status_code} {r2.text}"

    def test_salesman_duplicate_denied(self, sales, docs):
        for coll, key in [("estimates", "estimate"),
                          ("sales-orders", "sales_order"),
                          ("invoices", "invoice")]:
            r = sales.post(f"{API}/{coll}/{docs[key]['id']}/duplicate", timeout=30)
            assert r.status_code == 403, f"{coll} salesman dup should be 403: {r.status_code}"


# --- Admin RBAC: duplicate still allowed, customer still locked ---
class TestAdminStillWorks:
    def test_admin_can_duplicate_all(self, admin, docs):
        for coll, key in [("estimates", "estimate"),
                          ("sales-orders", "sales_order"),
                          ("invoices", "invoice")]:
            r = admin.post(f"{API}/{coll}/{docs[key]['id']}/duplicate", timeout=30)
            assert r.status_code == 200, f"{coll}: {r.status_code} {r.text}"
            dup = r.json()
            assert dup["id"] != docs[key]["id"]
            _registry[coll.replace("-", "_")].append(dup["id"])

    def test_admin_cannot_change_customer(self, admin, docs, two_customers):
        other = two_customers[1]["id"]
        for coll, key in [("estimates", "estimate"),
                          ("sales-orders", "sales_order"),
                          ("invoices", "invoice")]:
            r = admin.put(f"{API}/{coll}/{docs[key]['id']}",
                          json=_doc_payload(other, "TEST_admin_reassign"), timeout=30)
            assert r.status_code == 400, f"{coll}: {r.status_code}"


# --- Install schedule notification state + server-side recipient ---
def _next_weekday(target, offset=1):
    d = datetime.now(timezone.utc).date() + timedelta(days=offset)
    while d.weekday() != target:
        d += timedelta(days=1)
    return d.isoformat()


class TestInstallScheduleSalesNotification:
    def test_submit_records_sales_notification_state_once(self, admin):
        # create fresh SO so we can run end-to-end once (avoid spamming provider)
        r = admin.post(f"{API}/customers", json={
            "name": "TEST_iter21_notify_cust", "company": "TEST_iter21_notify_co",
            "email": TEST_EMAIL, "phone": "555-222-2222",
        }, timeout=30)
        assert r.status_code == 200
        cust = r.json()
        _registry["customers"].append(cust["id"])

        r = admin.post(f"{API}/sales-orders", json={
            "customer_id": cust["id"], "title": "TEST_iter21_notify_so",
            "line_items": [{"description": "install", "quantity": 1, "price": 10.0}],
            "tax_rate": 0.0, "status": "draft",
        }, timeout=30)
        assert r.status_code == 200, r.text
        so = r.json()
        _registry["sales_orders"].append(so["id"])

        r = admin.patch(f"{API}/sales-orders/{so['id']}/work-status",
                        params={"status": "completed_install_schedule"}, timeout=30)
        assert r.status_code == 200, r.text

        req = db.install_schedule_requests.find_one(
            {"doc_id": so["id"], "doc_collection": "sales_orders"}
        )
        assert req, "schedule request not created"
        token = req["token"]
        _registry["install_schedule_requests"].append(token)

        chosen = _next_weekday(1)  # Tuesday
        anon = requests.Session()
        # Attempt to inject a client-supplied notify_email / recipient — must be ignored
        payload = {
            "preferred_date": chosen, "time_of_day": "morning",
            "notes": "iter21-notify-test",
            "notify_email": "attacker@example.com",
            "recipient": "attacker@example.com",
            "sales_email": "attacker@example.com",
        }
        r = anon.post(f"{API}/pub/install-schedule/{token}", json=payload, timeout=30)
        assert r.status_code == 200, r.text

        # Reload the request doc; sales notification state must be recorded
        req2 = db.install_schedule_requests.find_one({"token": token})
        assert req2["status"] == "submitted"
        assert req2.get("sales_notified_at") or req2.get("sales_notification_failed_at"), (
            "no sales notification state recorded"
        )
        # Recipient-related fields must never carry the caller injected value
        for key, val in req2.items():
            if isinstance(val, str) and "attacker@example.com" in val:
                pytest.fail(f"caller-supplied recipient leaked into field {key}: {val}")

        _registry["installs"].append(req2["tentative_install_id"])


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin):
    yield
    pw = {"password": ADMIN["password"]}
    for coll, key in [("estimates", "estimates"),
                      ("sales-orders", "sales_orders"),
                      ("invoices", "invoices")]:
        for did in _registry[key]:
            try:
                admin.request("DELETE", f"{API}/{coll}/{did}", json=pw, timeout=20)
            except Exception:
                pass
    for iid in _registry["installs"]:
        try:
            db.installs.delete_one({"_id": ObjectId(iid)})
        except Exception:
            pass
    for tok in _registry["install_schedule_requests"]:
        try:
            db.install_schedule_requests.delete_one({"token": tok})
        except Exception:
            pass
    for cid in _registry["customers"]:
        db.installs.delete_many({"customer_id": cid})
        db.install_schedule_requests.delete_many({"customer_id": cid})
        try:
            db.customers.delete_one({"_id": ObjectId(cid)})
        except Exception:
            pass
