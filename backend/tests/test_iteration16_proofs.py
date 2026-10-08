"""
Backend tests for Artwork Proofs feature (iteration 16).
Covers: create proof, list, get file (content-type), send, public info,
public request-changes, versioning v2, public approve, admin delete.
"""
import os
import io
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://signshop-crm.preview.emergentagent.com").rstrip("/")
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "")
SALESMAN_EMAIL = os.environ.get("TEST_SALESMAN_EMAIL", "")
SALESMAN_PASSWORD = os.environ.get("TEST_SALESMAN_PASSWORD", "")

# 1x1 transparent PNG
PNG_BYTES = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
    "0000000D49444154789C6360000002000001E221BC330000000049454E44AE426082"
)


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="module")
def admin_session():
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        pytest.skip("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required")
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def salesman_session():
    if not SALESMAN_EMAIL or not SALESMAN_PASSWORD:
        pytest.skip("TEST_SALESMAN_EMAIL and TEST_SALESMAN_PASSWORD are required")
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SALESMAN_EMAIL, "password": SALESMAN_PASSWORD})
    assert r.status_code == 200, f"salesman login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def a_customer(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/customers")
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) > 0, "no customers seeded"
    return lst[0]


created_proof_ids = []


class TestProofsBackend:
    def test_create_proof_png(self, admin_session, a_customer):
        files = {"file": ("test.png", io.BytesIO(PNG_BYTES), "image/png")}
        data = {
            "customer_id": a_customer["id"],
            "title": "TEST_Proof Iteration16",
            "notes": "unit test",
        }
        r = admin_session.post(f"{BASE_URL}/api/proofs", files=files, data=data)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        p = r.json()
        assert p.get("status") == "draft"
        assert p.get("current_version") == 1 or p.get("version") == 1
        assert "id" in p
        created_proof_ids.append(p["id"])

    def test_list_proofs(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/proofs")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert any(p["id"] == created_proof_ids[0] for p in arr)

    def test_file_content_type_png(self, admin_session):
        pid = created_proof_ids[0]
        r = admin_session.get(f"{BASE_URL}/api/proofs/{pid}/file")
        assert r.status_code == 200
        assert "image/png" in r.headers.get("content-type", "").lower()
        assert len(r.content) > 0

    def test_send_proof(self, admin_session):
        pid = created_proof_ids[0]
        r = admin_session.post(
            f"{BASE_URL}/api/proofs/{pid}/send",
            json={"recipients": ["delivered@resend.dev"]},
        )
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        # Verify status set to sent
        r2 = admin_session.get(f"{BASE_URL}/api/proofs/{pid}")
        assert r2.status_code == 200
        assert r2.json().get("status") == "sent"

    def test_public_get_and_request_changes(self, db, admin_session):
        pid = created_proof_ids[0]
        tok = db.proof_tokens.find_one({"proof_id": pid}, sort=[("_id", -1)])
        assert tok, "no public token created after send"
        token = tok["token"]

        r = requests.get(f"{BASE_URL}/api/pub/proof/{token}")
        assert r.status_code == 200
        pub = r.json()
        assert pub.get("title", "").startswith("TEST_")

        rf = requests.get(f"{BASE_URL}/api/pub/proof/{token}/file")
        assert rf.status_code == 200
        assert "image/png" in rf.headers.get("content-type", "").lower()

        rc = requests.post(
            f"{BASE_URL}/api/pub/proof/{token}/changes",
            json={"notes": "please make it bigger"},
        )
        assert rc.status_code in (200, 201), f"{rc.status_code} {rc.text}"

        # Verify status
        r2 = admin_session.get(f"{BASE_URL}/api/proofs/{pid}")
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("status") == "changes_requested"

    def test_new_version_v2(self, admin_session):
        pid = created_proof_ids[0]
        files = {"file": ("test_v2.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = admin_session.post(f"{BASE_URL}/api/proofs/{pid}/version", files=files, data={"notes": "v2 update"})
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        # Verify current version becomes 2 and status resets to draft
        r2 = admin_session.get(f"{BASE_URL}/api/proofs/{pid}")
        d = r2.json()
        assert d.get("current_version") == 2 or d.get("version") == 2
        assert d.get("status") == "draft"

    def test_send_and_approve_v2(self, admin_session, db):
        pid = created_proof_ids[0]
        r = admin_session.post(
            f"{BASE_URL}/api/proofs/{pid}/send",
            json={"recipients": ["delivered@resend.dev"]},
        )
        assert r.status_code in (200, 201)
        tok = db.proof_tokens.find_one({"proof_id": pid, "version": 2}, sort=[("_id", -1)])
        assert tok, "no v2 token"
        token = tok["token"]

        ra = requests.post(f"{BASE_URL}/api/pub/proof/{token}/approve", json={})
        assert ra.status_code in (200, 201), f"{ra.status_code} {ra.text}"

        r2 = admin_session.get(f"{BASE_URL}/api/proofs/{pid}")
        assert r2.json().get("status") == "approved"

    def test_salesman_cannot_delete(self, salesman_session):
        pid = created_proof_ids[0]
        r = salesman_session.request(
            "DELETE",
            f"{BASE_URL}/api/proofs/{pid}",
            json={"password": ADMIN_PASSWORD},
        )
        # Should be forbidden for salesman regardless of correct password
        assert r.status_code in (401, 403), f"expected forbidden, got {r.status_code} {r.text}"

    def test_admin_delete(self, admin_session):
        pid = created_proof_ids[0]
        r = admin_session.request(
            "DELETE",
            f"{BASE_URL}/api/proofs/{pid}",
            json={"password": ADMIN_PASSWORD},
        )
        assert r.status_code in (200, 204), f"{r.status_code} {r.text}"

        r2 = admin_session.get(f"{BASE_URL}/api/proofs/{pid}")
        assert r2.status_code == 404
