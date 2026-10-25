import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from personal_banker import api
from personal_banker.datastore import Storage
from personal_banker.surreal import SurrealDB, SurrealStorage

TESTS = Path(__file__).parent
# A made-up library in the layout from before data was kept per user, and the API's responses
# over it, captured from the code as it was before the move to per-user records.
LEGACY_FIXTURE = TESTS / "fixtures" / "legacy_library"
LEGACY_EXPECTED = TESTS / "fixtures" / "legacy_expected.json"


@pytest.fixture
def surreal_db():
    """An empty SurrealDB, in memory."""
    db = SurrealDB("mem://", "test", "test")
    yield db
    db.close()


@pytest.fixture(params=["json", "surreal"])
def make_storage(request):
    """make_storage(root): a Storage over that folder, with records in JSON files or in SurrealDB.

    Called again on the same root, it opens the same records afresh, as a new process would.
    """
    if request.param == "json":
        return Storage
    db = request.getfixturevalue("surreal_db")
    return lambda root: SurrealStorage(root, db)


@pytest.fixture
def storage(tmp_path, make_storage) -> Storage:
    return make_storage(tmp_path / "library")


@pytest.fixture
def legacy_storage(tmp_path, make_storage) -> Storage:
    """A copy of the made-up legacy library, not yet migrated."""
    shutil.copytree(LEGACY_FIXTURE, tmp_path / "library")
    return make_storage(tmp_path / "library")


@pytest.fixture
def client_as(monkeypatch):
    """client_as(storage, user_id): a test client whose requests come from that user. Startup tasks don't run."""
    monkeypatch.setattr(api, "_hinted", set())

    def make(storage: Storage, user_id: str) -> TestClient:
        monkeypatch.setattr(api, "storage", storage)
        api.app.dependency_overrides[api.require_user] = lambda: user_id
        return TestClient(api.app)

    yield make
    api.app.dependency_overrides.clear()
