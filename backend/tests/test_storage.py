"""Per-user records: stable ids, duplicates across statements, job status, the workbook fallback, memory, conversations."""

import json
from types import SimpleNamespace

import pytest

from personal_banker import api, ledger, service
from personal_banker.docai.render import PageImage
from personal_banker.migrate import MigrationError, migrate_legacy


def row(day, vendor, amount, category="Groceries", description=None):
    return {"date": day, "vendor": vendor, "amount": amount, "category": category, "statement_description": description or vendor.upper()}


def budget(last4, expenses, income=()):
    return {"account": {"type": "credit_card", "institution": "Bank", "name": "Visa", "last4": last4}, "expenses": list(expenses), "income": list(income)}


AUG = [row("2026-08-02", "Loblaws", 82.15), row("2026-08-20", "Shell", 50.0, "Gas"), row("2026-08-25", "Netflix", 16.99, "Subscription")]
# The next statement overlaps the last two rows of AUG.
SEP = [row("2026-08-20", "Shell", 50.0, "Gas"), row("2026-08-25", "Netflix", 16.99, "Subscription"), row("2026-09-03", "Rogers", 65.0, "Telecom")]


def test_overlapping_statements_count_shared_rows_once(storage):
    store = storage.store("user_a")
    ledger.import_statement(store, "aug", budget("1111", AUG))
    sep = ledger.import_statement(store, "sep", budget("1111", SEP))

    txs = ledger.transactions(store)
    assert sorted((t.date, t.merchant) for t in txs) == [
        ("2026-08-02", "Loblaws"), ("2026-08-20", "Shell"), ("2026-08-25", "Netflix"), ("2026-09-03", "Rogers")
    ]
    assert {t.statement_id for t in txs if t.merchant in ("Shell", "Netflix")} == {"aug"}
    assert (sep.row_count, sep.duplicate_count) == (3, 2)


def test_same_rows_on_different_accounts_are_not_duplicates(storage):
    store = storage.store("user_a")
    ledger.import_statement(store, "visa", budget("1111", AUG))
    ledger.import_statement(store, "amex", budget("2222", AUG))
    assert len(ledger.transactions(store)) == 6


def test_identical_rows_on_one_statement_are_both_kept(storage):
    store = storage.store("user_a")
    coffee = row("2026-08-02", "Tim Hortons", 2.5, "Restaurant")
    ledger.import_statement(store, "aug", budget("1111", [coffee, coffee]))
    # Another statement repeating both still only counts them twice, not four times.
    ledger.import_statement(store, "aug-copy", budget("1111", [coffee, coffee]))
    assert [t.merchant for t in ledger.transactions(store)] == ["Tim Hortons", "Tim Hortons"]


def test_reimport_keeps_ids_and_picked_categories(storage):
    store = storage.store("user_a")
    ledger.import_statement(store, "aug", budget("1111", AUG))
    shell = next(t for t in ledger.transactions(store) if t.merchant == "Shell")
    ledger.recategorize(store, shell.id, "Car", always_for_merchant=False)

    # E.g. edited in Streamlit: rows reordered and one vendor renamed. Ids follow the rows, not their places.
    edited = [{**AUG[2], "vendor": "Netflix.com"}, AUG[1], AUG[0]]
    ledger.import_statement(store, "aug", budget("1111", edited))
    again = {t.raw_description: t for t in ledger.transactions(store)}
    assert again["SHELL"].id == shell.id
    assert again["SHELL"].category == "Car"
    assert again["NETFLIX"].merchant == "Netflix.com"
    assert len(again) == 3


def test_new_transactions_get_ids_that_dont_depend_on_position(storage):
    store = storage.store("user_a")
    ledger.import_statement(store, "aug", budget("1111", AUG))
    assert all(t.id.startswith("tx_") for t in ledger.transactions(store))


def test_each_user_sees_only_their_own_data(storage, client_as):
    card = {"institution": "CIBC", "type": "credit", "nickname": "Visa", "last4": "4242", "annualFee": 0, "interestRate": 20, "cycleDay": 1, "rules": []}
    alice = client_as(storage, "user_alice")
    assert alice.post("/api/cards", json=card).status_code == 201
    alice.put("/api/budgets/Food", json={"monthlyLimit": 300})
    ledger.import_statement(storage.store("user_alice"), "aug", budget("1111", AUG))
    assert len(alice.get("/api/transactions").json()) == 3

    bob = client_as(storage, "user_bob")
    assert [c["id"] for c in bob.get("/api/cards").json()] == ["card_dummy"]
    assert bob.get("/api/transactions").json() == []
    assert bob.get("/api/budgets").json() == []
    assert sorted(storage.user_ids()) == ["user_alice", "user_bob"]


def add_doc(store, name="statement.pdf"):
    page = PageImage(1, b"png", "image/png", 1, 1)
    return store.files.add(name, name.encode(), [page])


def test_job_status_survives_a_restart(storage, client_as, monkeypatch):
    store = storage.store("user_a")
    doc = add_doc(store)
    store.update_statement(doc.id, status="running", stage="Reading the pages.")

    # A new process (fresh Storage) still knows it was mid-way.
    reopened = type(storage)(storage.root)
    client = client_as(reopened, "user_a")
    assert client.get(f"/api/statements/{doc.id}").json()["status"] == "processing"

    # At startup it is queued again rather than forgotten.
    queued = []
    monkeypatch.setattr(api, "_jobs", type("Jobs", (), {"submit": lambda self, *a: queued.append(a)})())
    monkeypatch.setattr(api, "has_api_key", lambda: False)
    api._resume_and_backfill(reopened.store("user_a"))
    assert queued == [(api._process, "user_a", doc.id)]


def test_why_a_statement_stopped_is_kept(storage, client_as, monkeypatch):
    store = storage.store("user_a")
    doc = add_doc(store)
    monkeypatch.setattr(api, "storage", storage)
    monkeypatch.setattr(api, "engine_problem", lambda engine: "No engine here.")
    api._process("user_a", doc.id)

    client = client_as(type(storage)(storage.root), "user_a")
    statement = client.get(f"/api/statements/{doc.id}").json()
    assert (statement["status"], statement["message"]) == ("incomplete", "No engine here.")


def test_categorizes_into_app_categories_without_a_workbook(storage, monkeypatch):
    monkeypatch.setattr(service, "budget_workbook", lambda: None)
    store = storage.store("user_a")
    ledger.import_statement(store, "aug", budget("1111", AUG, [{"date": "2026-08-15", "source": "Acme", "amount": 2500, "category": "Job Acme"}]))

    setup, name = service.workbook_setup(store)
    assert name == "app categories"
    assert [c.name for c in setup.expense_categories] == [c for c in ledger.APP_CATEGORIES if c not in ledger.INCOME_CATEGORIES]
    assert [c.name for c in setup.income_categories] == list(ledger.INCOME_CATEGORIES)
    assert {(e.vendor, e.category) for e in setup.past_expenses} == {("Loblaws", "Groceries"), ("Shell", "Gas & EV charging"), ("Netflix", "Subscriptions")}
    assert [(e.vendor, e.category) for e in setup.past_income] == [("Acme", "Work")]
    # The categorizer's answers in app category names map onto themselves.
    assert all(ledger.app_category("expenses", c.name) == c.name for c in setup.expense_categories)
    assert all(ledger.app_category("income", c.name) == c.name for c in setup.income_categories)


def test_memory_store(storage):
    memory = storage.memory("user_a")
    first = memory.remember("Groceries are mostly on the debit card.", kind="pattern")
    assert memory.remember("groceries are mostly on the debit card.").id == first.id  # no duplicates
    goal = memory.remember("Saving for a trip to Japan in 2027.", kind="goal")
    assert [m.id for m in memory.search("japan trip")] == [goal.id]
    assert memory.search("unrelated words") == []
    assert storage.memory("user_b").memories() == []
    assert memory.forget(first.id) and [m.id for m in memory.memories()] == [goal.id]
    with pytest.raises(ValueError):
        memory.remember("   ")


def test_conversations_are_per_user(storage, client_as, monkeypatch):
    # A user's chat.json from before there were several conversations becomes the first of them.
    store = storage.store("user_a")
    old = [
        {"id": "msg_1", "role": "user", "text": "How much on food in August?", "created_at": "2026-09-01T10:00:00+00:00"},
        {"id": "msg_2", "role": "assistant", "text": "$120.00.", "created_at": "2026-09-01T10:00:05+00:00"},
    ]
    (store.folder / "chat.json").write_text(json.dumps({"messages": old}))
    client = client_as(storage, "user_a")
    [moved] = client.get("/api/chats").json()
    assert moved["title"] == "How much on food in August?" and moved["messageCount"] == 2
    assert not (store.folder / "chat.json").exists()

    # Claude stands in: it answers without calling a tool.
    answer = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="You spent $80.00.")])
    runner = SimpleNamespace(until_done=lambda: answer)
    client_stub = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=lambda **_: runner)))
    monkeypatch.setattr(api, "make_client", lambda: client_stub)
    monkeypatch.setattr(api, "has_api_key", lambda: True)

    new = client.post("/api/chats", json={"text": "And in September?"}).json()
    assert new["message"]["text"] == "You spent $80.00." and new["thread"]["title"] == "And in September?"
    more = client.post(f"/api/chats/{moved['id']}/messages", json={"text": "Thanks"}).json()
    assert more["thread"]["messageCount"] == 4
    assert client.post("/api/chats/chat_000000000000/messages", json={"text": "Hi"}).status_code == 404

    assert client.patch(f"/api/chats/{new['thread']['id']}", json={"title": "September food"}).json()["title"] == "September food"
    assert sorted(t["title"] for t in client.get("/api/chats").json()) == ["How much on food in August?", "September food"]
    assert client_as(storage, "user_b").get("/api/chats").json() == []
    assert client_as(storage, "user_b").get(f"/api/chats/{moved['id']}").status_code == 404

    client = client_as(storage, "user_a")
    assert client.delete(f"/api/chats/{moved['id']}").status_code == 204
    assert [t["id"] for t in client.get("/api/chats").json()] == [new["thread"]["id"]]
    assert client.delete(f"/api/chats/{moved['id']}").status_code == 404


def test_migration_refuses_a_user_with_data(legacy_storage):
    store = legacy_storage.store("user_a")
    ledger.import_statement(store, "aug", budget("1111", AUG))
    with pytest.raises(MigrationError):
        migrate_legacy(legacy_storage.root, store)


def test_legacy_data_is_flagged_until_migrated(legacy_storage):
    assert legacy_storage.unmigrated_legacy()
    (legacy_storage.root / ".migrated").write_text("{}")
    assert not legacy_storage.unmigrated_legacy()
