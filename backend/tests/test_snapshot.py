"""The move to per-user records changes nothing the app sees.

Each snapshot holds the API's responses over a legacy library, captured with the
code from before the move. The library is migrated to one user (migrate.py) and
the same requests must give the same responses, ids included.

- fixtures/legacy_expected.json: over the made-up fixtures/legacy_library (committed).
- snapshots/real_library.json: over your real backend/library (git-ignored, as it
  holds real statement data); skipped when either is missing.

Each runs with records in JSON files and in SurrealDB; copying JSON records to
SurrealDB (copy_to_surreal.py) must change nothing either.
"""

import json
import shutil
from pathlib import Path

import pytest

from personal_banker.copy_to_surreal import copy_files, copy_user
from personal_banker.datastore import Storage
from personal_banker.migrate import migrate_legacy
from personal_banker.surreal import SurrealStorage

from .conftest import LEGACY_EXPECTED, LEGACY_FIXTURE, TESTS

REAL_LIBRARY = TESTS.parent / "library"
REAL_SNAPSHOT = TESTS / "snapshots" / "real_library.json"
# Fields added to responses since the snapshots were taken; everything else must match exactly.
ADDED_FIELDS = {"duplicateCount", "refundOf", "refundedAmount", "refundIds"}


def without_added(value):
    if isinstance(value, dict):
        return {k: without_added(v) for k, v in value.items() if k not in ADDED_FIELDS}
    if isinstance(value, list):
        return [without_added(v) for v in value]
    return value


def migrated(tmp_path, make_storage, legacy: Path) -> Storage:
    root = tmp_path / "library"
    # Only the legacy part: a real library may already hold migrated users/ next to it.
    shutil.copytree(legacy, root, ignore=shutil.ignore_patterns("users", ".migrated"))
    storage = make_storage(root)
    migrate_legacy(root, storage.store("user_test"))
    return storage


def check_against_snapshot(client_as, storage: Storage, snapshot: Path) -> None:
    client = client_as(storage, "user_test")

    expected = json.loads(snapshot.read_text(encoding="utf-8"))
    for path, want in expected.items():
        if path == "/api/chat":  # the one conversation then; now one of several, under /api/chats
            threads = client.get("/api/chats").json()
            got = [m for t in threads for m in client.get(f"/api/chats/{t['id']}").json()["messages"]]
            assert got == want, path
            continue
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
        assert without_added(response.json()) == want, path


def test_fixture_library_unchanged_by_migration(tmp_path, make_storage, client_as):
    check_against_snapshot(client_as, migrated(tmp_path, make_storage, LEGACY_FIXTURE), LEGACY_EXPECTED)


def test_fixture_library_unchanged_by_copy_to_surreal(tmp_path, surreal_db, client_as):
    json = migrated(tmp_path, Storage, LEGACY_FIXTURE)
    surreal = SurrealStorage(json.root, surreal_db)
    copy_user(json.store("user_test"), surreal.store("user_test"), json.memory("user_test"), surreal.memory("user_test"))
    copy_files(json.store("user_test").files, surreal.store("user_test").files)
    check_against_snapshot(client_as, surreal, LEGACY_EXPECTED)


@pytest.mark.skipif(not (REAL_SNAPSHOT.exists() and REAL_LIBRARY.exists()), reason="no snapshot of a real library here")
def test_real_library_unchanged_by_migration(tmp_path, make_storage, client_as):
    check_against_snapshot(client_as, migrated(tmp_path, make_storage, REAL_LIBRARY), REAL_SNAPSHOT)
