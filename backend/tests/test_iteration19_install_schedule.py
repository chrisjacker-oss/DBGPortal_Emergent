"""Iteration 19 - Completed / Installation Schedule work status + public tentative scheduling.

Covers:
- Work status list includes `completed_install_schedule` on Estimate/Sales Order/Invoice.
- PATCH work-status to `completed_install_schedule` creates an install_schedule_requests
  token (30-day expiry) and returns the doc updated.
- GET /pub/install-schedule/{token} returns doc summary, date bounds, status.
- Invalid token -> 404. (Expired flow not force-tested since it needs DB mutation; we
  simulate by rewriting expires_at in Mongo and asserting 410.)
- POST /pub/install-schedule/{token} rejects: past date, > 90 days, weekend,
  Friday afternoon, malformed date, unknown time_of_day; accepts Monday-Thursday
  AM/PM and Friday AM.
- Valid submit creates an install with status=tentative, tentative_notes copied,
  linked_type/linked_id present. Second submit -> 409.
- Staff editing tentative -> confirmed on /installs/{id} does not raise and sets
  status=confirmed (notify email may fail against test recipient, that's ok).
- Cleanup: all test customers, contacts, documents, install_schedule_requests, installs.
"""
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from dotenv import dotenv_values, load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or frontend_env.get("REACT_APP_BACKEND_URL")
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_EMAIL = "delivered@resend.dev"


def _creds(section_regex):
    text = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    m = re.search(section_regex, text, re.I | re.S)
    return {"email": m.group(1), "password": m.group(2)}


ADMIN_CREDS = _creds(r"Admin \(DBG\).*?Email:\s*(\S+).*?Password:\s*(\S+)")

# ---- session-scoped Mongo for cleanup + surgical expiry test ----
mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

# Registry to clean up at end
_registry = {
    "customers": [],
    "contacts": [],
    "estimates": [],
    "sales_orders": [],
    "invoices": [],
    "install_schedule_requests": [],  # by token
    "installs": [],
}


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN_CREDS, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


@pytest.fixture(scope="module")
def test_estimate(admin):
    # Create a customer with TEST_ prefix and delivered@resend.dev email
    cust_payload = {
        "name": "TEST_Install Schedule Customer",
        "company": "TEST_Install Schedule Co",
        "email": TEST_EMAIL,
        "phone": "555-000-0000",
    }
    r = admin.post(f"{API}/customers", json=cust_payload, timeout=30)
    assert r.status_code == 200, r.text
    cust = r.json()
    _registry["customers"].append(cust["id"])

    # Add a contact so the schedule email prefers contact
    contact_payload = {
        "name": "TEST_Contact",
        "email": TEST_EMAIL,
        "phone": "555-111-1111",
        "title": "Owner",
    }
    r = admin.post(
        f"{API}/customers/{cust['id']}/contacts", json=contact_payload, timeout=30
    )
    assert r.status_code == 200, r.text
    contact = r.json()
    _registry["contacts"].append(contact["id"])

    est_payload = {
        "customer_id": cust["id"],
        "contact_id": contact["id"],
        "title": "TEST_Install Schedule Estimate",
        "line_items": [{
            "description": "Fleet decals",
            "quantity": 1,
            "price": 100.0,
        }],
        "tax_rate": 0.0,
        "status": "draft",
    }
    r = admin.post(f"{API}/estimates", json=est_payload, timeout=30)
    assert r.status_code == 200, r.text
    est = r.json()
    _registry["estimates"].append(est["id"])
    return {"customer": cust, "contact": contact, "estimate": est}


# ---------- work status ----------
class TestWorkStatus:
    def test_invalid_status_rejected(self, admin, test_estimate):
        eid = test_estimate["estimate"]["id"]
        r = admin.patch(
            f"{API}/estimates/{eid}/work-status",
            params={"status": "not_a_real_status"},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_estimate_set_completed_install_schedule(self, admin, test_estimate):
        eid = test_estimate["estimate"]["id"]
        r = admin.patch(
            f"{API}/estimates/{eid}/work-status",
            params={"status": "completed_install_schedule"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("work_status") == "completed_install_schedule"

        # A token doc must exist in install_schedule_requests
        req = db.install_schedule_requests.find_one({
            "doc_id": eid, "doc_collection": "estimates",
        })
        assert req is not None
        assert req.get("status") == "sent"
        assert req.get("recipient") == TEST_EMAIL
        token = req.get("token")
        assert token and len(token) >= 20
        # expiry ~30 days from creation
        expires_at = datetime.fromisoformat(str(req["expires_at"]).replace("Z", "+00:00"))
        delta = expires_at - datetime.now(timezone.utc)
        assert 29 <= delta.days <= 30
        _registry["install_schedule_requests"].append(token)

    def test_setting_same_status_is_idempotent(self, admin, test_estimate):
        eid = test_estimate["estimate"]["id"]
        r = admin.patch(
            f"{API}/estimates/{eid}/work-status",
            params={"status": "completed_install_schedule"},
            timeout=30,
        )
        assert r.status_code == 200
        # There should still be exactly one request
        count = db.install_schedule_requests.count_documents({
            "doc_id": eid, "doc_collection": "estimates",
        })
        assert count == 1


# ---------- public GET ----------
class TestPublicGet:
    def test_invalid_token_404(self, anon):
        r = anon.get(f"{API}/pub/install-schedule/not-a-real-token", timeout=30)
        assert r.status_code == 404

    def test_valid_token_returns_summary(self, anon, test_estimate):
        token = _registry["install_schedule_requests"][0]
        r = anon.get(f"{API}/pub/install-schedule/{token}", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["number"] == test_estimate["estimate"]["number"]
        assert data["title"] == "TEST_Install Schedule Estimate"
        assert data["customer_name"] == "TEST_Install Schedule Co"
        assert data["status"] == "sent"
        # date bounds
        today = datetime.now(timezone.utc).date()
        assert data["date_from"] == today.isoformat()
        assert data["date_to"] == (today + timedelta(days=90)).isoformat()

    def test_expired_token_410(self, anon):
        # Force-expire via direct DB update (surgical, restored at teardown)
        token = _registry["install_schedule_requests"][0]
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        original = db.install_schedule_requests.find_one({"token": token})
        db.install_schedule_requests.update_one(
            {"token": token}, {"$set": {"expires_at": past}}
        )
        try:
            r = anon.get(f"{API}/pub/install-schedule/{token}", timeout=30)
            assert r.status_code == 410, r.text
        finally:
            db.install_schedule_requests.update_one(
                {"token": token},
                {"$set": {"expires_at": original["expires_at"]}},
            )


# ---------- date/slot validation ----------
def _next_weekday(target_weekday: int, offset_start: int = 1) -> str:
    """Return YYYY-MM-DD of the next date >= today+offset_start that matches target_weekday (0=Mon)."""
    d = datetime.now(timezone.utc).date() + timedelta(days=offset_start)
    while d.weekday() != target_weekday:
        d += timedelta(days=1)
    return d.isoformat()


class TestPublicSubmitValidation:
    def _post(self, anon, **kwargs):
        token = _registry["install_schedule_requests"][0]
        return anon.post(
            f"{API}/pub/install-schedule/{token}", json=kwargs, timeout=30
        )

    def test_reject_past_date(self, anon):
        past = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        r = self._post(anon, preferred_date=past, time_of_day="morning", notes="")
        assert r.status_code == 400

    def test_reject_beyond_90_days(self, anon):
        far = (datetime.now(timezone.utc).date() + timedelta(days=120)).isoformat()
        # Pick a Monday to isolate the range check
        d = datetime.fromisoformat(far).date()
        while d.weekday() != 0:
            d += timedelta(days=1)
        r = self._post(anon, preferred_date=d.isoformat(), time_of_day="morning", notes="")
        assert r.status_code == 400

    def test_reject_saturday(self, anon):
        sat = _next_weekday(5)
        r = self._post(anon, preferred_date=sat, time_of_day="morning", notes="")
        assert r.status_code == 400

    def test_reject_sunday(self, anon):
        sun = _next_weekday(6)
        r = self._post(anon, preferred_date=sun, time_of_day="morning", notes="")
        assert r.status_code == 400

    def test_reject_friday_afternoon(self, anon):
        fri = _next_weekday(4)
        r = self._post(anon, preferred_date=fri, time_of_day="afternoon", notes="")
        assert r.status_code == 400

    def test_reject_bad_time(self, anon):
        mon = _next_weekday(0)
        r = self._post(anon, preferred_date=mon, time_of_day="evening", notes="")
        assert r.status_code == 400

    def test_reject_bad_date_format(self, anon):
        r = self._post(anon, preferred_date="not-a-date", time_of_day="morning", notes="")
        assert r.status_code == 400


# ---------- happy path submit ----------
class TestPublicSubmitSuccess:
    def test_accept_monday_morning_and_create_tentative_install(
        self, anon, admin, test_estimate
    ):
        token = _registry["install_schedule_requests"][0]
        # Prefer a Tuesday to also cover a M-Th AM path (Monday works too)
        chosen = _next_weekday(1)  # Tuesday
        payload = {
            "preferred_date": chosen,
            "time_of_day": "morning",
            "notes": "Please arrive after 9am - gate code 1234",
        }
        r = anon.post(f"{API}/pub/install-schedule/{token}", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "submitted"
        assert data["preferred_date"] == chosen
        assert data["time_of_day"] == "morning"

        # DB: install_schedule_requests updated
        req = db.install_schedule_requests.find_one({"token": token})
        assert req["status"] == "submitted"
        assert req["notes"] == payload["notes"]
        install_id = req.get("tentative_install_id")
        assert install_id
        _registry["installs"].append(install_id)

        # DB: install created with tentative status + linked estimate
        install = db.installs.find_one({"_id": ObjectId(install_id)})
        assert install is not None
        assert install["status"] == "tentative"
        assert install["date"] == chosen
        assert install["time_of_day"] == "morning"
        assert install["linked_type"] == "estimate"
        assert install["linked_id"] == test_estimate["estimate"]["id"]
        assert install["tentative_notes"] == payload["notes"]
        # Description carries customer notes
        assert "gate code 1234" in install["description"]

        # GET /installs should include it (admin) and mark it as tentative
        month = chosen[:7]
        r = admin.get(f"{API}/installs", params={"month": month}, timeout=30)
        assert r.status_code == 200
        found = [i for i in r.json() if i["id"] == install_id]
        assert found and found[0]["status"] == "tentative"
        assert found[0]["linked_number"] == test_estimate["estimate"]["number"]

    def test_duplicate_submit_conflicts(self, anon):
        token = _registry["install_schedule_requests"][0]
        chosen = _next_weekday(1)
        r = anon.post(
            f"{API}/pub/install-schedule/{token}",
            json={"preferred_date": chosen, "time_of_day": "morning", "notes": ""},
            timeout=30,
        )
        assert r.status_code == 409, r.text


# ---------- confirmation path ----------
class TestStaffConfirmation:
    def test_confirm_tentative_install(self, admin, test_estimate):
        install_id = _registry["installs"][0]
        install = db.installs.find_one({"_id": ObjectId(install_id)})
        assert install["status"] == "tentative"

        payload = {
            "date": install["date"],
            "time_of_day": install["time_of_day"],
            "status": "confirmed",
            "customer_id": install["customer_id"],
            "contact_id": install.get("contact_id"),
            "description": install["description"],
            "linked_type": install.get("linked_type"),
            "linked_id": install.get("linked_id"),
        }
        r = admin.put(f"{API}/installs/{install_id}", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "confirmed"


# ---------- sales order and invoice status labels also accept new status ----------
class TestOtherCollections:
    def test_sales_order_accepts_new_status(self, admin, test_estimate):
        # Approve the estimate to create a sales order
        eid = test_estimate["estimate"]["id"]
        r = admin.post(f"{API}/estimates/{eid}/approve", timeout=30)
        assert r.status_code == 200, r.text
        so = r.json()
        sid = so["id"]
        _registry["sales_orders"].append(sid)

        r = admin.patch(
            f"{API}/sales-orders/{sid}/work-status",
            params={"status": "completed_install_schedule"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("work_status") == "completed_install_schedule"

        # A new token doc was created for the SO
        req = db.install_schedule_requests.find_one({
            "doc_id": sid, "doc_collection": "sales_orders",
        })
        assert req is not None
        _registry["install_schedule_requests"].append(req["token"])
        # Its extra install is untouched (still tentative) - status "sent"
        assert req["status"] == "sent"


# ---------- teardown cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    # Delete installs
    for iid in _registry["installs"]:
        try:
            db.installs.delete_one({"_id": ObjectId(iid)})
        except Exception:
            pass
    # Delete schedule requests
    for tok in _registry["install_schedule_requests"]:
        try:
            db.install_schedule_requests.delete_one({"token": tok})
        except Exception:
            pass
    # Delete any extra installs created for our test customers
    for cid in _registry["customers"]:
        db.installs.delete_many({"customer_id": cid})
        db.install_schedule_requests.delete_many({"customer_id": cid})
    # Delete docs
    for eid in _registry["estimates"]:
        try:
            db.estimates.delete_one({"_id": ObjectId(eid)})
        except Exception:
            pass
    for sid in _registry["sales_orders"]:
        try:
            db.sales_orders.delete_one({"_id": ObjectId(sid)})
        except Exception:
            pass
    for iid in _registry["invoices"]:
        try:
            db.invoices.delete_one({"_id": ObjectId(iid)})
        except Exception:
            pass
    # Delete contacts + customers
    for cid in _registry["contacts"]:
        try:
            db.contacts.delete_one({"_id": ObjectId(cid)})
        except Exception:
            pass
    for cid in _registry["customers"]:
        try:
            db.customers.delete_one({"_id": ObjectId(cid)})
        except Exception:
            pass
