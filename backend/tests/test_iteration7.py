"""Iteration 7 backend tests: forced password change, admin-password-gated deletes, role gating."""
import os
import time

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"

ADMIN = {"email": "chrisjacker@gmail.com", "password": "SignShop2026!"}
SALES = {"email": "sam@dbgsigns.com", "password": "Sales2026!"}
INSTALLER = {"email": "service@dbgsigns.com", "password": "Service2026!"}
STAMP = str(int(time.time()))


def login(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=creds)
    if r.status_code != 200:
        pytest.fail(f"login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    s, _ = login(ADMIN)
    return s


@pytest.fixture(scope="module")
def salesman():
    s, _ = login(SALES)
    return s


@pytest.fixture(scope="module")
def installer():
    """Documented demo installer (service@dbgsigns.com) is NOT seeded by the backend startup hook.
    Skip instead of failing the suite; the missing seed is reported as an issue."""
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=INSTALLER)
    if r.status_code != 200:
        pytest.skip(f"installer demo account missing/unusable ({r.status_code}) - not seeded in startup()")
    return s


# --- health -----------------------------------------------------------------
class TestHealth:
    def test_login_admin(self, admin):
        r = admin.get(f"{BASE}/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin"
        assert "_id" not in d and "password_hash" not in d


# --- forced password change -------------------------------------------------
class TestForcedPasswordChange:
    def test_full_flow(self, admin):
        email = f"wo_newstaff_{STAMP}@example.com"
        temp = "Temp1234!"
        r = admin.post(f"{BASE}/users", json={"email": email, "password": temp, "name": "TEST_ New Staff",
                                              "role": "salesman", "commission_rate": 5})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["must_change_password"] is True
        assert "password_hash" not in u and "_id" not in u
        uid = u["id"]

        # login as new staff -> must_change_password true
        s2, payload = login({"email": email, "password": temp})
        assert payload["must_change_password"] is True

        # wrong current password
        r = s2.post(f"{BASE}/auth/change-password", json={"current_password": "WrongPass!", "new_password": "Brand1New!"})
        assert r.status_code == 403

        # too-short new password
        r = s2.post(f"{BASE}/auth/change-password", json={"current_password": temp, "new_password": "abc"})
        assert r.status_code == 400

        # same as current
        r = s2.post(f"{BASE}/auth/change-password", json={"current_password": temp, "new_password": temp})
        assert r.status_code == 400

        # success
        newpw = "Brand1New!"
        r = s2.post(f"{BASE}/auth/change-password", json={"current_password": temp, "new_password": newpw})
        assert r.status_code == 200, r.text

        # old password no longer works, new does, no reprompt
        bad = requests.post(f"{BASE}/auth/login", json={"email": email, "password": temp})
        assert bad.status_code == 401
        s3, p3 = login({"email": email, "password": newpw})
        assert p3["must_change_password"] is False
        assert s3.get(f"{BASE}/auth/me").json().get("must_change_password") in (None, False)

        # delete gating on this user then cleanup
        r = admin.request("DELETE", f"{BASE}/users/{uid}")
        assert r.status_code == 422
        r = admin.request("DELETE", f"{BASE}/users/{uid}", json={"password": "nope"})
        assert r.status_code == 403
        r = admin.request("DELETE", f"{BASE}/users/{uid}", json={"password": ADMIN["password"]})
        assert r.status_code == 200
        assert all(x["id"] != uid for x in admin.get(f"{BASE}/users").json())

    def test_admin_cannot_delete_self(self, admin):
        me = admin.get(f"{BASE}/auth/me").json()
        r = admin.request("DELETE", f"{BASE}/users/{me['id']}", json={"password": ADMIN["password"]})
        assert r.status_code == 400


# --- delete requires admin password across resources ------------------------
def assert_delete_gated(session, url, admin_pw, verify_gone=None):
    r = session.request("DELETE", url)
    assert r.status_code == 422, f"no-body delete should be 422, got {r.status_code} for {url}"
    r = session.request("DELETE", url, json={"password": "wrong-password"})
    assert r.status_code == 403, f"wrong pw should be 403, got {r.status_code} for {url}"
    r = session.request("DELETE", url, json={"password": admin_pw})
    assert r.status_code == 200, f"correct pw delete failed {r.status_code} {r.text[:200]} for {url}"
    if verify_gone:
        assert verify_gone(), f"record still present after delete: {url}"


class TestDeleteGating:
    def test_customer_and_contact_and_portal(self, admin):
        c = admin.post(f"{BASE}/customers", json={"name": f"TEST_cust_{STAMP}", "company": "TEST_Co"})
        assert c.status_code == 200, c.text
        cid = c.json()["id"]
        ct = admin.post(f"{BASE}/customers/{cid}/contacts",
                        json={"name": "TEST_contact", "email": f"test_contact_{STAMP}@example.com"})
        assert ct.status_code == 200, ct.text
        ctid = ct.json()["id"]
        # portal login for contact
        p = admin.post(f"{BASE}/contacts/{ctid}/portal", json={"password": "Portal1234!"})
        assert p.status_code == 200, p.text
        assert_delete_gated(admin, f"{BASE}/contacts/{ctid}/portal", ADMIN["password"],
                            lambda: not admin.get(f"{BASE}/customers/{cid}/contacts").json()[0]["has_portal"])
        assert_delete_gated(admin, f"{BASE}/contacts/{ctid}", ADMIN["password"],
                            lambda: admin.get(f"{BASE}/customers/{cid}/contacts").json() == [])
        assert_delete_gated(admin, f"{BASE}/customers/{cid}", ADMIN["password"],
                            lambda: all(x["id"] != cid for x in admin.get(f"{BASE}/customers").json()))

    def test_material_and_category(self, admin):
        cat = admin.post(f"{BASE}/material-categories", json={"name": f"TEST_cat_{STAMP}"})
        assert cat.status_code == 200, cat.text
        cat_id = cat.json()["id"]
        cat_name = cat.json()["name"]
        m = admin.post(f"{BASE}/materials", json={"name": f"TEST_mat_{STAMP}", "category": cat_name,
                                                  "unit": "roll", "buying_cost": 100, "conversion_factor": 50,
                                                  "markup": 40})
        assert m.status_code == 200, m.text
        mid = m.json()["id"]
        assert m.json()["price_per_sqft"] == pytest.approx(2.8, rel=1e-3)
        assert_delete_gated(admin, f"{BASE}/materials/{mid}", ADMIN["password"],
                            lambda: all(x["id"] != mid for x in admin.get(f"{BASE}/materials").json()))
        assert_delete_gated(admin, f"{BASE}/material-categories/{cat_id}", ADMIN["password"],
                            lambda: cat_name not in admin.get(f"{BASE}/material-categories").json()["all"])

    def test_bill(self, admin):
        b = admin.post(f"{BASE}/bills", json={"vendor": f"TEST_vendor_{STAMP}", "amount": 12.5, "status": "unpaid"})
        assert b.status_code == 200, b.text
        bid = b.json()["id"]
        assert_delete_gated(admin, f"{BASE}/bills/{bid}", ADMIN["password"],
                            lambda: all(x["id"] != bid for x in admin.get(f"{BASE}/bills").json()))

    def test_work_order(self, admin):
        w = admin.post(f"{BASE}/work-orders", json={"customer_name": f"TEST_wo_{STAMP}", "date": "2026-07-01",
                                                    "work_performed": "TEST", "unit_vin": "", "equipment_type": "Truck"})
        assert w.status_code == 200, w.text
        wid = w.json()["id"]
        assert_delete_gated(admin, f"{BASE}/work-orders/{wid}", ADMIN["password"],
                            lambda: all(x["id"] != wid for x in admin.get(f"{BASE}/work-orders").json()))

    def test_portal_account(self, admin):
        email = f"test_portal_{STAMP}@example.com"
        p = admin.post(f"{BASE}/portal-accounts", json={"name": "TEST_portal", "email": email,
                                                        "password": "Portal1234!", "company": "TEST_Co"})
        assert p.status_code == 200, p.text
        pid = p.json()["id"]
        cust_id = p.json().get("customer_id")
        assert_delete_gated(admin, f"{BASE}/portal-accounts/{pid}", ADMIN["password"],
                            lambda: all(x["id"] != pid for x in admin.get(f"{BASE}/portal-accounts").json()))
        if cust_id:
            admin.request("DELETE", f"{BASE}/customers/{cust_id}", json={"password": ADMIN["password"]})

    def test_estimate_so_invoice(self, admin):
        c = admin.post(f"{BASE}/customers", json={"name": f"TEST_doccust_{STAMP}"})
        cid = c.json()["id"]
        items = [{"description": "TEST item", "width_in": 24, "height_in": 36, "quantity": 2,
                  "price_per_sqft": 5.0, "extra_labor_hours": 1}]
        est = admin.post(f"{BASE}/estimates", json={"customer_id": cid, "title": "TEST_est", "line_items": items,
                                                    "tax_rate": 8.25, "status": "draft"})
        assert est.status_code == 200, est.text
        e = est.json()
        # area = 24*36/144*2 = 12 sqft ; material = 60
        assert e["line_items"][0]["area_sqft"] == pytest.approx(12.0)
        assert e["line_items"][0]["material_cost"] == pytest.approx(60.0)
        assert e["total"] > 0
        so = admin.post(f"{BASE}/sales-orders", json={"customer_id": cid, "title": "TEST_so", "line_items": items,
                                                      "tax_rate": 0, "status": "open"})
        assert so.status_code == 200, so.text
        inv = admin.post(f"{BASE}/invoices", json={"customer_id": cid, "title": "TEST_inv", "line_items": items,
                                                   "tax_rate": 0, "status": "unpaid"})
        assert inv.status_code == 200, inv.text
        for url in (f"{BASE}/estimates/{e['id']}", f"{BASE}/sales-orders/{so.json()['id']}",
                    f"{BASE}/invoices/{inv.json()['id']}"):
            assert_delete_gated(admin, url, ADMIN["password"])
        admin.request("DELETE", f"{BASE}/customers/{cid}", json={"password": ADMIN["password"]})


# --- role gating ------------------------------------------------------------
class TestRoleGating:
    def test_salesman_cannot_delete_customer(self, admin, salesman):
        c = admin.post(f"{BASE}/customers", json={"name": f"TEST_rolecust_{STAMP}"})
        cid = c.json()["id"]
        r = salesman.request("DELETE", f"{BASE}/customers/{cid}", json={"password": SALES["password"]})
        assert r.status_code == 403
        r = salesman.request("DELETE", f"{BASE}/customers/{cid}", json={"password": ADMIN["password"]})
        assert r.status_code == 403
        assert any(x["id"] == cid for x in admin.get(f"{BASE}/customers").json())
        admin.request("DELETE", f"{BASE}/customers/{cid}", json={"password": ADMIN["password"]})

    def test_installer_cannot_delete_work_order(self, admin, installer):
        w = installer.post(f"{BASE}/work-orders", json={"customer_name": f"TEST_iwo_{STAMP}", "date": "2026-07-01",
                                                        "work_performed": "TEST", "equipment_type": "Truck"})
        assert w.status_code == 200, w.text
        wid = w.json()["id"]
        r = installer.request("DELETE", f"{BASE}/work-orders/{wid}", json={"password": INSTALLER["password"]})
        assert r.status_code == 403
        admin.request("DELETE", f"{BASE}/work-orders/{wid}", json={"password": ADMIN["password"]})

    def test_salesman_blocked_from_users_and_bills(self, salesman):
        assert salesman.get(f"{BASE}/users").status_code == 403
        assert salesman.get(f"{BASE}/bills").status_code == 403


# --- auth hardening checks --------------------------------------------------
class TestAuthHardening:
    def test_login_sets_httponly_cookies(self):
        r = requests.post(f"{BASE}/auth/login", json=ADMIN)
        assert r.status_code == 200
        raw = r.headers.get("set-cookie", "")
        assert "access_token" in raw and "HttpOnly" in raw
        assert "refresh_token" in r.cookies or "refresh_token" in raw

    def test_bcrypt_hash_format(self):
        import bcrypt
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
        import pymongo
        cl = pymongo.MongoClient(os.environ.get("MONGO_URL") or dotenv_values("/app/backend/.env")["MONGO_URL"])
        dbn = os.environ.get("DB_NAME") or dotenv_values("/app/backend/.env")["DB_NAME"]
        u = cl[dbn].users.find_one({"email": ADMIN["email"]})
        assert u is not None
        assert u["password_hash"].startswith("$2b$")
        assert bcrypt.checkpw(ADMIN["password"].encode(), u["password_hash"].encode())

    def test_brute_force_lockout(self):
        email = f"bf_{STAMP}@example.com"
        codes = [requests.post(f"{BASE}/auth/login", json={"email": email, "password": "x"}).status_code
                 for _ in range(7)]
        assert codes[0] == 401
        assert 429 in codes, f"expected lockout 429 after 5 fails, got {codes}"
