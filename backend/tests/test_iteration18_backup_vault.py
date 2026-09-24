"""Iteration 18 - CRM backup vault + monthly cron tests.

Covers:
- Admin can list, run, and download a vault backup; downloaded file is valid
  dbg-signs-crm-backup Extended JSON with core collections.
- Salesman is denied all backup-vault endpoints.
- Records contain metadata only (no raw payload).
- Soft-remove requires admin password; hides only test-created backups.
- Monthly cron endpoint rejects missing/wrong bearer and accepts correct bearer.
- Cron _run_monthly_crm_backup is idempotent for the same run_id and
  reaches status "complete" with a linked stored backup (invoked in-process
  via asyncio to avoid duplicating a production-like external cron trigger).
"""
import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests
from bson import json_util
from dotenv import dotenv_values, load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or frontend_env.get("REACT_APP_BACKEND_URL")
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")


# ---------- helpers ----------
def _creds(section_regex):
    text = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    m = re.search(section_regex, text, re.I | re.S)
    return {"email": m.group(1), "password": m.group(2)}


ADMIN_CREDS = _creds(r"Admin \(DBG\).*?Email:\s*(\S+).*?Password:\s*(\S+)")
SALESMAN_CREDS = _creds(r"Salesman.*?Email:\s*(\S+).*?Password:\s*(\S+)")


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN_CREDS, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def salesman():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=SALESMAN_CREDS, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ---------- role gating ----------
class TestRoleGating:
    def test_anon_denied_list(self, anon):
        r = anon.get(f"{API}/settings/backup-vault", timeout=30)
        assert r.status_code in (401, 403), r.text

    def test_salesman_denied_list(self, salesman):
        r = salesman.get(f"{API}/settings/backup-vault", timeout=30)
        assert r.status_code == 403, r.text

    def test_salesman_denied_run(self, salesman):
        r = salesman.post(f"{API}/settings/backup-vault/run", timeout=30)
        assert r.status_code == 403, r.text

    def test_salesman_denied_download(self, salesman, admin):
        # need a real id to hit
        listing = admin.get(f"{API}/settings/backup-vault", timeout=30).json()
        assert isinstance(listing, list) and len(listing) > 0, "no existing backups"
        bid = listing[0]["id"]
        r = salesman.get(f"{API}/settings/backup-vault/{bid}/download", timeout=30)
        assert r.status_code == 403, r.text

    def test_salesman_denied_delete(self, salesman, admin):
        listing = admin.get(f"{API}/settings/backup-vault", timeout=30).json()
        bid = listing[0]["id"]
        r = salesman.request(
            "DELETE",
            f"{API}/settings/backup-vault/{bid}",
            json={"password": SALESMAN_CREDS["password"]},
            timeout=30,
        )
        assert r.status_code == 403, r.text


# ---------- admin listing + metadata ----------
class TestListing:
    def test_admin_list_returns_metadata_only(self, admin):
        r = admin.get(f"{API}/settings/backup-vault", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0, "expected at least one retained backup from prior main-agent run"
        for rec in data:
            assert "id" in rec
            assert "filename" in rec and rec["filename"].startswith("dbg-signs-crm-backup-")
            assert rec.get("content_type") == "application/json"
            assert isinstance(rec.get("size"), int) and rec["size"] > 0
            assert rec.get("source") in ("manual", "monthly")
            assert isinstance(rec.get("collection_count"), int) and rec["collection_count"] > 0
            assert isinstance(rec.get("document_count"), int) and rec["document_count"] > 0
            assert "created_at" in rec
            # Metadata only - no raw payload / cleartext content
            assert "collections" not in rec
            assert "content" not in rec
            # Storage paths stay server-only; downloads flow through the protected API.
            assert "storage_path" not in rec


# ---------- manual run + download validate ----------
_created_test_backup_id = {"id": None}


class TestManualRunAndDownload:
    def test_admin_manual_run_creates_backup(self, admin):
        r = admin.post(f"{API}/settings/backup-vault/run", timeout=120)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec.get("source") == "manual"
        assert rec.get("filename", "").startswith("dbg-signs-crm-backup-")
        assert rec.get("collection_count", 0) > 0
        assert rec.get("document_count", 0) > 0
        assert rec.get("id")
        _created_test_backup_id["id"] = rec["id"]

    def test_download_is_valid_extended_json_backup(self, admin):
        bid = _created_test_backup_id["id"]
        assert bid, "manual run did not populate id"
        r = admin.get(f"{API}/settings/backup-vault/{bid}/download", timeout=120)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/json")
        cd = r.headers.get("content-disposition", "")
        assert "dbg-signs-crm-backup-" in cd
        # Parse Extended JSON via bson.json_util
        parsed = json_util.loads(r.content.decode("utf-8"))
        assert parsed.get("format") == "dbg-signs-crm-backup"
        assert parsed.get("version") == 1
        assert "exported_at" in parsed
        collections = parsed.get("collections")
        assert isinstance(collections, dict) and len(collections) > 0
        # Core collections should be present
        for expected in ("users", "settings", "customers"):
            assert expected in collections, f"missing core collection: {expected}"
        # No system.* collections leaked
        for name in collections:
            assert not name.startswith("system."), name


# ---------- soft remove ----------
@pytest.fixture(scope="class")
def disposable_backup_id(admin):
    """Creates a fresh TEST backup dedicated to soft-remove flow so it works
    under pytest-xdist (each worker gets its own module state)."""
    r = admin.post(f"{API}/settings/backup-vault/run", timeout=120)
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestSoftRemove:
    def test_delete_requires_admin_password(self, admin, disposable_backup_id):
        r = admin.request(
            "DELETE",
            f"{API}/settings/backup-vault/{disposable_backup_id}",
            json={"password": "wrong-password"},
            timeout=30,
        )
        assert r.status_code in (400, 401, 403), r.text

    def test_delete_with_correct_password_hides_backup(self, admin, disposable_backup_id):
        r = admin.request(
            "DELETE",
            f"{API}/settings/backup-vault/{disposable_backup_id}",
            json={"password": ADMIN_CREDS["password"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        listing = admin.get(f"{API}/settings/backup-vault", timeout=30).json()
        ids = [rec["id"] for rec in listing]
        assert disposable_backup_id not in ids, "soft-deleted backup should not appear in list"

    def test_download_soft_deleted_backup_returns_404(self, admin, disposable_backup_id):
        r = admin.get(f"{API}/settings/backup-vault/{disposable_backup_id}/download", timeout=30)
        assert r.status_code == 404, r.text


# ---------- cron auth + idempotency ----------
class TestCronAuth:
    def test_cron_missing_bearer_rejected(self):
        r = requests.post(f"{API}/cron/monthly-crm-backup", timeout=30)
        assert r.status_code == 401, r.text

    def test_cron_wrong_bearer_rejected(self):
        r = requests.post(
            f"{API}/cron/monthly-crm-backup",
            headers={"Authorization": "Bearer not-the-secret"},
            timeout=30,
        )
        assert r.status_code == 401, r.text

    def test_cron_correct_bearer_accepts(self):
        """Accepts and enqueues (idempotency verified via direct call below)."""
        assert WEBHOOK_CRON_SECRET, "WEBHOOK_CRON_SECRET missing in backend env"
        run_id = f"TEST_reject_probe_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/cron/monthly-crm-backup",
            headers={
                "Authorization": f"Bearer {WEBHOOK_CRON_SECRET}",
                "x-webhook-id": run_id,
            },
            json={},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "accepted"
        assert body.get("run_id") == run_id


class TestCronIdempotency:
    """Directly invoke the internal _run_monthly_crm_backup to verify
    idempotency + terminal 'complete' status without triggering an
    additional production-like external cron round-trip."""

    def test_run_is_idempotent_and_completes(self):
        # Direct backend invocation (per review_request: "direct backend
        # validation/mocking is acceptable for idempotency").
        import sys
        sys.path.insert(0, "/app/backend")
        import importlib
        server = importlib.import_module("server")

        run_id = f"TEST_iter18_idem_{uuid.uuid4().hex[:8]}"

        async def _drive():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            try:
                # Sanity: run_id must be unique
                pre = await db.cron_runs.find_one({"run_id": run_id})
                assert pre is None
                # First invocation should perform the work and reach 'complete'
                await server._run_monthly_crm_backup(run_id)
                first = await db.cron_runs.find_one({"run_id": run_id})
                assert first is not None
                assert first.get("status") == "complete", first
                backup_id = first.get("backup_id")
                assert backup_id, "backup_id missing on cron_runs record"
                # Linked stored backup exists in crm_backups
                from bson import ObjectId
                stored = await db.crm_backups.find_one({"_id": ObjectId(backup_id)})
                assert stored is not None
                assert stored.get("source") == "monthly"
                assert stored.get("is_deleted") is not True

                # Second invocation with same run_id must be a no-op (idempotent)
                cron_count_before = await db.cron_runs.count_documents({"run_id": run_id})
                backups_before = await db.crm_backups.count_documents({})
                await server._run_monthly_crm_backup(run_id)
                cron_count_after = await db.cron_runs.count_documents({"run_id": run_id})
                backups_after = await db.crm_backups.count_documents({})
                assert cron_count_after == cron_count_before, "duplicate cron_run inserted"
                assert backups_after == backups_before, "duplicate backup created on re-run"

                # Cleanup: soft-remove the TEST backup we created here
                await db.crm_backups.update_one(
                    {"_id": ObjectId(backup_id)},
                    {"$set": {"is_deleted": True, "deleted_at": server.now_iso(),
                              "deleted_by": "TEST_iter18"}},
                )
                await db.cron_runs.delete_one({"run_id": run_id})
            finally:
                client.close()

        asyncio.get_event_loop().run_until_complete(_drive()) if False else asyncio.run(_drive())
