"""What SurrealDB storage does beyond the DataStore tests every store passes (test_storage.py)."""

import json

from surrealdb import ConnectionUnavailableError

from personal_banker import ledger
from personal_banker.copy_to_surreal import copy_user
from personal_banker.datastore import Storage
from personal_banker.docai.pipeline import DocumentResult, PageResult
from personal_banker.docai.render import PageImage
from personal_banker.docai.schemas import PageLayout, PageTranscription
from personal_banker.llm import CallResult
from personal_banker.records import Card, RewardRule, ScanRecord
from personal_banker.store import Library, copy_document
from personal_banker.surreal import SurrealLibrary, SurrealStorage

from .conftest import LEGACY_FIXTURE


def test_nulls_and_photos_come_back_as_written(tmp_path, surreal_db):
    store = SurrealStorage(tmp_path, surreal_db).store("user_a")
    # NONE would drop these keys; the rewards line needs rate_percent even when it is null.
    rewards = {"program": None, "unit": "dollars", "lines": [{"label": "Bonus", "rate_percent": None, "amount": 1.5}]}
    store.update_statement("doc", categorized=True, account={"type": "credit_card", "last4": None}, rewards=rewards)
    saved = store.statement("doc")
    assert saved.account == {"type": "credit_card", "last4": None} and saved.rewards == rewards
    assert ledger.statement_rewards(saved).earned == 1.5

    scan = ScanRecord(id="scan_1", scanned_at="2026-10-01T10:00:00", merchant="Gusto", date=None, subtotal=None, tax=None,
                      tax_label=None, total=20.0, currency="CAD", items=[{"description": "Pasta", "amount": None}], card_last4=None)
    store.save_scan(scan, b"\xff\xd8jpeg")
    assert store.scan("scan_1") == scan and store.scan_image("scan_1") == b"\xff\xd8jpeg"
    store.delete_scan("scan_1")
    assert store.scan("scan_1") is None and store.scan_image("scan_1") is None


def test_cards_keep_their_order_and_rules(tmp_path, surreal_db):
    store = SurrealStorage(tmp_path, surreal_db).store("user_a")
    fields = {"institution": "CIBC", "type": "credit", "last4": "4242", "annual_fee": 0, "interest_rate": 20, "cycle_day": 1}
    first, second = Card(id="card_1", nickname="Visa", **fields), Card(id="card_2", nickname="Amex", **fields)
    store.save_card(first, [RewardRule(card_id="card_1", category="Groceries", rate_percent=4, cap=None)])
    store.save_card(second, [])
    store.save_card(first.model_copy(update={"nickname": "Dividend"}), [RewardRule(card_id="card_1", category="*", rate_percent=1)])
    assert [c.nickname for c in store.cards()] == ["Dividend", "Amex"]  # an edited card keeps its place
    assert [(r.card_id, r.category, r.cap) for r in store.reward_rules()] == [("card_1", "*", None)]
    assert store.delete_card("card_1") and not store.delete_card("card_1")
    assert store.reward_rules() == []


def test_reconnects_when_the_link_drops(tmp_path, surreal_db):
    store = SurrealStorage(tmp_path, surreal_db).store("user_a")
    store.set_merchant_rule("LOBLAWS", "Groceries")
    conn = surreal_db._conn
    real = conn.query_raw
    calls = []

    def drops_once(*args):
        calls.append(args)
        if len(calls) == 1:
            raise ConnectionUnavailableError("link down")
        return real(*args)

    conn.query_raw, conn.close = drops_once, lambda: None  # keep the in-memory database for the retry
    reconnected = []
    surreal_db._connect = lambda: reconnected.append(1) or conn
    assert store.merchant_rules() == {"LOBLAWS": "Groceries"}
    assert len(calls) == 2 and reconnected == [1]


def test_statement_files_come_back_as_stored(tmp_path, surreal_db):
    disk = Library(LEGACY_FIXTURE)
    surreal = SurrealLibrary(surreal_db, "user_a")
    for doc in reversed(disk.documents()):
        copy_document(disk, surreal, doc)
    back = Library(tmp_path / "back")
    for doc in surreal.documents():
        copy_document(surreal, back, doc)

    assert surreal.documents() == back.documents() == disk.documents()
    for doc in disk.documents():
        assert surreal.budget(doc) == back.budget(doc) == disk.budget(doc)
        assert surreal.stored_results(doc, "claude") == back.stored_results(doc, "claude") == disk.stored_results(doc, "claude")
        assert surreal.markdown(doc) == disk.markdown(doc)
        assert surreal.transcribed_pages(doc) == disk.transcribed_pages(doc)
    assert SurrealLibrary(surreal_db, "user_b").documents() == []

    # A new upload: pages come back, results read back as PageResults, and the same PDF isn't stored twice.
    image = PageImage(1, b"png-1", "image/png", 10, 10)
    doc = surreal.add("new.pdf", b"%PDF-new", [image])
    assert surreal.add("again.pdf", b"%PDF-new", []) == doc and surreal.pdf(doc) == b"%PDF-new"
    assert surreal.markdown(doc) is None and surreal.untranscribed_pages(doc) == [1]
    region = {"id": "r1", "type": "paragraph", "bbox": [0, 0, 10, 10], "reading_order": 1, "description": "text", "table_columns": None}
    call = {"model": "claude", "input_tokens": 1, "output_tokens": 1, "cache_read_tokens": 0, "cache_write_tokens": 0}
    result = PageResult(
        image,
        CallResult(PageLayout.model_validate({"rotation": 0, "column_count": 1, "language": None, "regions": [region], "notes": ""}), **call),
        CallResult(PageTranscription.model_validate({"regions": [{"region_id": "r1", "markdown": "Hello", "legible": True}], "missed_content": None}), **call),
    )
    surreal.save_page_result(doc, result)
    [(n, read)] = surreal.page_results(doc).items()
    assert n == 1 and read.image.data == b"png-1" and read.layout == result.layout and read.transcription == result.transcription
    assert surreal.untranscribed_pages(doc) == [] and surreal.markdown(doc) == DocumentResult([result]).markdown
    renamed = surreal.save_budget(doc, {"title": "Aug 2026", "expenses": [], "income": []})
    assert surreal.get(doc.id) == renamed and renamed.name == "Aug 2026.pdf" and renamed.original_name == "new.pdf"


def test_copy_brings_the_old_chat_and_memories(tmp_path, surreal_db):
    json_storage = Storage(tmp_path)
    source = json_storage.store("user_a")
    old = [{"id": "msg_1", "role": "user", "text": "Food in August?", "created_at": "2026-09-01T10:00:00+00:00"}]
    (source.folder / "chat.json").write_text(json.dumps({"messages": old}))
    first = json_storage.memory("user_a").remember("Groceries go on debit.", kind="pattern")
    second = json_storage.memory("user_a").remember("Saving for Japan.", kind="goal")

    surreal = SurrealStorage(tmp_path, surreal_db)
    assert surreal.uncopied_json_users() == ["user_a"]
    copy_user(source, surreal.store("user_a"), json_storage.memory("user_a"), surreal.memory("user_a"))
    assert [c.title for c in surreal.store("user_a").chats()] == ["Food in August?"]
    assert surreal.memory("user_a").memories() == [first, second]  # ids, dates and order kept
    assert surreal.uncopied_json_users() == []

    surreal.delete_records("user_a")
    assert not surreal.has_records("user_a") and surreal.user_ids() == ["user_a"]
