"""Each user's records and statement files in SurrealDB, behind the same protocols as the JSON files.

Set SURREALDB_URL and the other SURREALDB_* settings in .env, and open_storage()
(datastore.py) opens a SurrealStorage instead of JSON files. Nothing is kept on disk
then, so the server can run where disks don't last (e.g. Render).

Each table holds every user's records. A record's id starts with the user id, e.g.
transaction:['user_2abc', 'tx_1f2e'], and its indexed `user` field scopes every query:

    app_user         one per user who has opened their store (id: the user id)
    statement        StatementRecord
    transaction      TransactionRecord
    card             Card, its reward rules (`rules`) and its place in the order added (`n`)
    merchant_rule    `category` for the merchant in the id ("always categorize" in the app)
    budget           Budget and its place (`n`)
    goal             SavingsGoal (id: the user id)
    receipt          ScanRecord; receipt_photo: its photo (`jpeg`)
    chat             ChatRecord: title and messages
    memory           Memory (memory.py) and its place (`n`)
  Statement files (SurrealLibrary; store.py has the same as files), each with the document id in `doc`:
    document         StoredDocument: name, hash, when added, page info
    document_pdf     the upload (`pdf`)
    page_image       a rendered page (`data`); id [user, doc, page number]
    page_result      a page's layout + transcription and its `markdown`; id [user, doc, engine, page number]
    document_text    the whole transcription (`markdown`) once every page is done; id [user, doc, engine]
    document_budget  the categorizer's rows (`budget`, budget.json in a library folder)

copy_to_surreal.py copies records and statement files kept on disk into it.
"""

import hashlib
import os
import secrets
import threading
from dataclasses import asdict, replace
from datetime import datetime, timezone
from functools import cache
from pathlib import Path
from typing import Any

import websockets
from pydantic import BaseModel
from surrealdb import (
    BlockingEmbeddedSurrealConnection,
    ConnectionUnavailableError,
    RecordID,
    Surreal,
    SurrealError,
    UnexpectedResponseError,
)
from surrealdb.cbor import CBORSimpleValue

from .datastore import DataStore, Storage
from .memory import _words
from .records import (
    Budget,
    Card,
    ChatMessage,
    ChatRecord,
    Memory,
    MemoryKind,
    RewardRule,
    SavingsGoal,
    ScanRecord,
    StatementRecord,
    TransactionRecord,
)
from .docai.pipeline import EXTRACTION_ENGINE, DocumentResult, Engine, PageResult
from .docai.render import PageImage
from .docai.schemas import PageLayout, PageTranscription
from .store import EXTENSIONS, StatementFiles, StoredDocument, StoredPage, _dump_call, _load_call, document_id

URL_ENV = "SURREALDB_URL"

FILE_TABLES = ("document", "document_pdf", "page_image", "page_result", "document_text", "document_budget")
TABLES = ("app_user", "statement", "transaction", "card", "merchant_rule", "budget", "goal", "receipt", "receipt_photo", "chat", "memory", *FILE_TABLES)

# The SDK sends None as NONE, which drops the field (even inside nested objects); CBOR null is stored as NULL.
NULL = CBORSimpleValue(22)


def _nulls(value: Any) -> Any:
    if value is None:
        return NULL
    if isinstance(value, dict):
        return {k: _nulls(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_nulls(v) for v in value]
    return value


class SurrealDBError(RuntimeError):
    pass


def _check(response: dict) -> list[Any]:
    """Each statement's result from a raw response; raises if any failed."""
    if "error" in response:
        raise SurrealDBError(str(response["error"]))
    results = response["result"]
    if failed := next((r for r in results if r.get("status") != "OK"), None):
        raise SurrealDBError(str(failed.get("result")))
    return [r["result"] for r in results]


# Tables without a schema (pydantic checks records), each indexed by user (and the files by document). Run on every connect.
SCHEMA = "".join(
    f"DEFINE TABLE IF NOT EXISTS {t} SCHEMALESS;"
    + (f"DEFINE INDEX IF NOT EXISTS {t}_user ON TABLE {t} FIELDS user;" if t != "app_user" else "")
    + (f"DEFINE INDEX IF NOT EXISTS {t}_doc ON TABLE {t} FIELDS user, doc;" if t in FILE_TABLES[1:] else "")
    for t in TABLES
)


# Failures of the link rather than of the query: reconnect and try once more (every write here can be repeated).
_LINK_ERRORS = (ConnectionUnavailableError, UnexpectedResponseError, websockets.exceptions.WebSocketException, OSError)


class SurrealDB:
    """One connection, shared by every user's store in this process (the SDK sends one request at a time).

    Connects on first use and again whenever the link drops.
    """

    def __init__(self, url: str, namespace: str, database: str, username: str | None = None, password: str | None = None):
        self.url, self.namespace, self.database = url, namespace, database
        self._username, self._password = username, password
        self._conn: Any = None
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "SurrealDB | None":
        """The database the SURREALDB_* settings name; None without SURREALDB_URL."""
        if not (url := os.environ.get(URL_ENV)):
            return None
        missing = [n for n in ("SURREALDB_NAMESPACE", "SURREALDB_DATABASE") if not os.environ.get(n)]
        if missing:
            raise SurrealDBError(f"{URL_ENV} is set, so .env also needs {' and '.join(missing)}.")
        return _shared(
            url,
            os.environ["SURREALDB_NAMESPACE"],
            os.environ["SURREALDB_DATABASE"],
            os.environ.get("SURREALDB_USERNAME") or None,
            os.environ.get("SURREALDB_PASSWORD") or None,
        )

    def _connect(self) -> Any:
        conn = Surreal(self.url)
        if isinstance(conn, BlockingEmbeddedSurrealConnection):
            conn.connect()  # the others connect on their first request
        if self._username:
            self._signin(conn)
        conn.use(self.namespace, self.database)
        _check(conn.query_raw(SCHEMA))
        return conn

    def _signin(self, conn: Any) -> None:
        """As a database user (the usual one for an app), else a namespace user, else a root user."""
        creds = {"username": self._username, "password": self._password}
        levels = [{"namespace": self.namespace, "database": self.database}, {"namespace": self.namespace}, {}]
        for level in levels:
            try:
                conn.signin({**level, **creds})
                return
            except _LINK_ERRORS:
                raise
            except SurrealError:
                continue
        raise SurrealDBError(
            f"SurrealDB at {self.url} rejected SURREALDB_USERNAME/SURREALDB_PASSWORD as a database, namespace "
            "and root user. Check them, and that the user is defined on this namespace and database."
        )

    def _connection(self) -> Any:
        with self._lock:
            if self._conn is None:
                self._conn = self._connect()
            return self._conn

    def _drop(self, conn: Any) -> None:
        with self._lock:
            if self._conn is conn:
                self._conn = None
        try:
            conn.close()
        except Exception:
            pass

    def run(self, sql: str, vars: dict[str, Any] | None = None) -> list[Any]:
        """Runs the statements in `sql`; returns each one's result."""
        params = _nulls(vars or {})
        for attempt in (1, 2):
            conn = self._connection()
            try:
                response = conn.query_raw(sql, params)
                break
            except _LINK_ERRORS:
                self._drop(conn)
                if attempt == 2:
                    raise
        return _check(response)

    def query(self, sql: str, vars: dict[str, Any] | None = None) -> Any:
        """The result of the last statement in `sql`."""
        return self.run(sql, vars)[-1]

    def close(self) -> None:
        with self._lock:
            conn, self._conn = self._conn, None
        if conn is not None:
            conn.close()


@cache
def _shared(url: str, namespace: str, database: str, username: str | None, password: str | None) -> SurrealDB:
    return SurrealDB(url, namespace, database, username, password)


def _key(row: dict) -> str:
    """The record's own id: the second part of [user id, id]."""
    return row["id"].id[1]


def _fields(row: dict, *internal: str) -> dict:
    return {k: v for k, v in row.items() if k not in ("id", "user", *internal)}


def _with_id(model: type[BaseModel], row: dict, *internal: str) -> Any:
    return model.model_validate({**_fields(row, *internal), "id": _key(row)})


def _content(record: BaseModel, **extra: Any) -> dict:
    return {**record.model_dump(mode="json", exclude={"id"}), **extra}


_user_locks: dict[str, threading.RLock] = {}
_user_locks_guard = threading.Lock()


def _user_lock(user_id: str) -> threading.RLock:
    """One lock per user for read-change-write, shared by every store opened for them in this process."""
    with _user_locks_guard:
        return _user_locks.setdefault(user_id, threading.RLock())


class _UserRecords:
    def __init__(self, db: SurrealDB, user_id: str):
        self.db = db
        self.user_id = user_id
        self._lock = _user_lock(user_id)

    def _id(self, table: str, key: str) -> RecordID:
        return RecordID(table, [self.user_id, key])

    def _all(self, table: str, order: str = "id") -> list[dict]:
        return self.db.query(f"SELECT * FROM {table} WHERE user = $user ORDER BY {order}", {"user": self.user_id})

    def _get(self, table: str, key: str) -> dict | None:
        return self.db.query("SELECT * FROM ONLY $id", {"id": self._id(table, key)})

    def _put(self, table: str, key: str, content: dict) -> None:
        self.db.query("UPSERT $id CONTENT $content", {"id": self._id(table, key), "content": {**content, "user": self.user_id}})

    def _put_many(self, table: str, rows: list[tuple[str, dict]], *, replace_all: bool = False) -> None:
        """Adds or replaces the records in one transaction; with replace_all, the user's others in the table go."""
        sql = (f"DELETE {table} WHERE user = $user; " if replace_all else "") + "FOR $row IN $rows { UPSERT $row.id CONTENT $row.content; };"
        rows_param = [{"id": self._id(table, key), "content": {**content, "user": self.user_id}} for key, content in rows]
        self.db.run(f"BEGIN; {sql} COMMIT;", {"user": self.user_id, "rows": rows_param})

    def _delete(self, table: str, key: str) -> bool:
        """Whether there was such a record."""
        return bool(self.db.query("DELETE $id RETURN BEFORE", {"id": self._id(table, key)}))

    @staticmethod
    def _next_n(rows: list[dict]) -> int:
        return max((r.get("n", 0) for r in rows), default=0) + 1


class SurrealDataStore(_UserRecords):
    """DataStore over SurrealDB for one user; their statement files are in `files` (SurrealLibrary)."""

    def __init__(self, db: SurrealDB, user_id: str, files: StatementFiles):
        super().__init__(db, user_id)
        self.files = files

    # --- Statements ------------------------------------------------------------

    def statements(self) -> list[StatementRecord]:
        return [_with_id(StatementRecord, r) for r in self._all("statement")]

    def statement(self, statement_id: str) -> StatementRecord | None:
        found = self._get("statement", statement_id)
        return _with_id(StatementRecord, found) if found else None

    def update_statement(self, statement_id: str, **fields: Any) -> StatementRecord:
        with self._lock:
            current = self.statement(statement_id)
            record = StatementRecord.model_validate({**(current.model_dump() if current else {"id": statement_id}), **fields})
            self._put("statement", statement_id, _content(record))
        return record

    # --- Transactions ----------------------------------------------------------

    def transactions(self) -> list[TransactionRecord]:
        return [_with_id(TransactionRecord, r) for r in self._all("transaction")]

    def transaction(self, tx_id: str) -> TransactionRecord | None:
        found = self._get("transaction", tx_id)
        return _with_id(TransactionRecord, found) if found else None

    def save_transactions(self, records: list[TransactionRecord]) -> None:
        if records:
            self._put_many("transaction", [(r.id, _content(r)) for r in records])

    def update_transaction(self, tx_id: str, **fields: Any) -> TransactionRecord | None:
        with self._lock:
            if (current := self.transaction(tx_id)) is None:
                return None
            record = TransactionRecord.model_validate({**current.model_dump(), **fields})
            self._put("transaction", tx_id, _content(record))
        return record

    def delete_transactions(self, tx_ids: list[str]) -> None:
        if tx_ids:
            self.db.query("FOR $id IN $ids { DELETE $id; };", {"ids": [self._id("transaction", i) for i in tx_ids]})

    # --- Cards and reward rules ------------------------------------------------

    def _card_rows(self) -> list[dict]:
        return self._all("card", "n")

    def cards(self) -> list[Card]:
        return [_with_id(Card, r, "rules", "n") for r in self._card_rows()]

    def reward_rules(self) -> list[RewardRule]:
        return [RewardRule.model_validate({**rule, "card_id": _key(r)}) for r in self._card_rows() for rule in r.get("rules", [])]

    def save_card(self, card: Card, rules: list[RewardRule]) -> None:
        with self._lock:
            rows = self._card_rows()
            # An edited card keeps its place.
            n = next((r["n"] for r in rows if _key(r) == card.id), None) or self._next_n(rows)
            content = _content(card, rules=[r.model_dump(mode="json", exclude={"card_id"}) for r in rules], n=n)
            self._put("card", card.id, content)

    def delete_card(self, card_id: str) -> bool:
        return self._delete("card", card_id)

    # --- Merchant rules --------------------------------------------------------

    def merchant_rules(self) -> dict[str, str]:
        return {_key(r): r["category"] for r in self._all("merchant_rule")}

    def set_merchant_rule(self, merchant: str, category: str) -> None:
        self._put("merchant_rule", merchant, {"category": category})

    # --- Budgets and the savings goal ------------------------------------------

    def budgets(self) -> list[Budget]:
        return [Budget.model_validate(_fields(r, "n")) for r in self._all("budget", "n")]

    def save_budget(self, budget: Budget) -> None:
        with self._lock:
            rows = self._all("budget", "n")
            n = next((r["n"] for r in rows if r["category"] == budget.category), None) or self._next_n(rows)
            self._put("budget", budget.category, {**budget.model_dump(mode="json"), "n": n})

    def replace_budgets(self, budgets: list[Budget]) -> None:
        with self._lock:
            rows = [(b.category, {**b.model_dump(mode="json"), "n": n}) for n, b in enumerate(budgets, 1)]
            self._put_many("budget", rows, replace_all=True)

    def goal(self) -> SavingsGoal | None:
        found = self.db.query("SELECT * FROM ONLY $id", {"id": RecordID("goal", self.user_id)})
        return SavingsGoal.model_validate(_fields(found)) if found else None

    def save_goal(self, goal: SavingsGoal | None) -> None:
        goal_id = RecordID("goal", self.user_id)
        if goal is None:
            self.db.query("DELETE $id", {"id": goal_id})
        else:
            self.db.query("UPSERT $id CONTENT $content", {"id": goal_id, "content": {**goal.model_dump(mode="json"), "user": self.user_id}})

    # --- Scanned receipts ------------------------------------------------------

    def scans(self) -> list[ScanRecord]:
        return [_with_id(ScanRecord, r) for r in self._all("receipt")]

    def scan(self, scan_id: str) -> ScanRecord | None:
        found = self._get("receipt", scan_id)
        return _with_id(ScanRecord, found) if found else None

    def save_scan(self, scan: ScanRecord, image_jpeg: bytes | None = None) -> None:
        if image_jpeg is not None:
            self._put("receipt_photo", scan.id, {"jpeg": image_jpeg})
        self._put("receipt", scan.id, _content(scan))

    def scan_image(self, scan_id: str) -> bytes | None:
        found = self._get("receipt_photo", scan_id)
        return found["jpeg"] if found else None

    def delete_scan(self, scan_id: str) -> None:
        self.db.query("DELETE $ids", {"ids": [self._id("receipt", scan_id), self._id("receipt_photo", scan_id)]})

    # --- Assistant chat ----------------------------------------------------------

    def chats(self) -> list[ChatRecord]:
        return [_with_id(ChatRecord, r) for r in self._all("chat")]

    def chat(self, chat_id: str) -> ChatRecord | None:
        found = self._get("chat", chat_id)
        return _with_id(ChatRecord, found) if found else None

    def save_chat(self, chat: ChatRecord) -> None:
        self._put("chat", chat.id, _content(chat))

    def add_chat_messages(self, chat_id: str, messages: list[ChatMessage]) -> ChatRecord | None:
        with self._lock:
            if (chat := self.chat(chat_id)) is None:
                return None
            chat.messages = [*chat.messages, *messages]
            self.save_chat(chat)
        return chat

    def rename_chat(self, chat_id: str, title: str) -> ChatRecord | None:
        with self._lock:
            if (chat := self.chat(chat_id)) is None:
                return None
            chat.title = title
            self.save_chat(chat)
        return chat

    def delete_chat(self, chat_id: str) -> bool:
        return self._delete("chat", chat_id)

    # The single chat.json from before there were several conversations only exists in JSON
    # libraries; copy_to_surreal.py turns it into a conversation.
    def legacy_chat(self) -> list[ChatMessage] | None:
        return None

    def remove_legacy_chat(self) -> None:
        pass


class SurrealMemoryStore(_UserRecords):
    """MemoryStore (memory.py) over SurrealDB. Search ranks by words shared with the query, like JsonMemoryStore."""

    def memories(self) -> list[Memory]:
        return [_with_id(Memory, r, "n") for r in self._all("memory", "n")]

    def remember(self, text: str, kind: MemoryKind = "fact", source: str | None = None) -> Memory:
        text = text.strip()
        if not text:
            raise ValueError("A memory needs some text.")
        with self._lock:
            saved = self.memories()
            if existing := next((m for m in saved if m.text.casefold() == text.casefold()), None):
                return existing
            memory = Memory(
                id=f"mem_{secrets.token_hex(6)}",
                text=text,
                kind=kind,
                created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                source=source,
            )
            self.keep(memory)
        return memory

    def keep(self, memory: Memory) -> None:
        """Stores the memory as it is, id and date included (e.g. copied from JSON), after the others."""
        with self._lock:
            rows = self._all("memory", "n")
            n = next((r["n"] for r in rows if _key(r) == memory.id), None) or self._next_n(rows)
            self._put("memory", memory.id, _content(memory, n=n))

    def forget(self, memory_id: str) -> bool:
        return self._delete("memory", memory_id)

    def search(self, query: str, limit: int = 10) -> list[Memory]:
        wanted = _words(query)
        scored = [(len(wanted & _words(m.text)), i, m) for i, m in enumerate(self.memories())]
        # Most shared words first; newer first among equals.
        return [m for score, _, m in sorted(scored, key=lambda s: (-s[0], -s[1])) if score > 0][:limit]


class SurrealLibrary(_UserRecords):
    """One user's statement files (StatementFiles in store.py) in SurrealDB."""

    def __init__(self, db: SurrealDB, user_id: str):
        super().__init__(db, user_id)
        self.location = f"SurrealDB ({db.namespace}/{db.database})"

    def _rid(self, table: str, *parts: Any) -> RecordID:
        return RecordID(table, [self.user_id, *parts])

    def _write(self, rid: RecordID, doc: StoredDocument, **content: Any) -> None:
        self.db.query("UPSERT $id CONTENT $content", {"id": rid, "content": {**content, "doc": doc.id, "user": self.user_id}})

    def _read(self, rid: RecordID) -> dict | None:
        return self.db.query("SELECT * FROM ONLY $id", {"id": rid})

    @staticmethod
    def _document(row: dict) -> StoredDocument:
        data = _fields(row)
        return StoredDocument(**{**data, "id": _key(row), "pages": tuple(StoredPage(**p) for p in data["pages"])})

    # --- Documents -------------------------------------------------------------

    def documents(self) -> list[StoredDocument]:
        return [self._document(r) for r in self._all("document", "added DESC")]

    def get(self, doc_id: str) -> StoredDocument | None:
        found = self._get("document", doc_id)
        return self._document(found) if found else None

    def find(self, sha256: str) -> StoredDocument | None:
        return next((d for d in self.documents() if d.sha256 == sha256), None)

    def add(self, name: str, pdf_bytes: bytes, pages: list[PageImage]) -> StoredDocument:
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        if existing := self.find(sha256):
            return existing
        stored_pages = tuple(
            StoredPage(f"pages/{p.page_number:03d}.{EXTENSIONS[p.media_type]}", p.media_type, p.width, p.height) for p in pages
        )
        doc = StoredDocument(document_id(name, sha256), name, sha256, datetime.now().isoformat(timespec="seconds"), stored_pages)
        self.put(doc, pdf_bytes, {p.page_number: p.data for p in pages})
        return doc

    def put(self, doc: StoredDocument, pdf_bytes: bytes | None, pages: dict[int, bytes]) -> None:
        for n, data in pages.items():  # one at a time: each can be close to a megabyte
            self._write(self._rid("page_image", doc.id, n), doc, data=data)
        if pdf_bytes is not None:
            self._write(self._rid("document_pdf", doc.id), doc, pdf=pdf_bytes)
        self._write_document(doc)  # last: a document without it is an interrupted add and is ignored

    def _write_document(self, doc: StoredDocument) -> None:
        content = {"name": doc.name, "sha256": doc.sha256, "added": doc.added, "pages": [asdict(p) for p in doc.pages], "original_name": doc.original_name}
        self._put("document", doc.id, content)

    def rename(self, doc: StoredDocument, name: str) -> StoredDocument:
        if name == doc.name:
            return doc
        renamed = replace(doc, name=name, original_name=doc.original_name or doc.name)
        self._write_document(renamed)
        return renamed

    def pdf(self, doc: StoredDocument) -> bytes | None:
        found = self._read(self._rid("document_pdf", doc.id))
        return found["pdf"] if found else None

    # --- Pages -----------------------------------------------------------------

    def page_data(self, doc: StoredDocument, page_number: int) -> bytes | None:
        found = self._read(self._rid("page_image", doc.id, page_number))
        return found["data"] if found else None

    def page_image(self, doc: StoredDocument, page_number: int) -> PageImage:
        page = doc.pages[page_number - 1]
        if (data := self.page_data(doc, page_number)) is None:
            raise FileNotFoundError(f"Page {page_number} of {doc.id} isn't stored.")
        return PageImage(page_number, data, page.media_type, page.width, page.height)

    def page_images(self, doc: StoredDocument) -> list[PageImage]:
        return [self.page_image(doc, n) for n in range(1, doc.page_count + 1)]

    def save_page_result(self, doc: StoredDocument, result: PageResult, engine: Engine = EXTRACTION_ENGINE) -> None:
        n = result.image.page_number
        self._write(
            self._rid("page_result", doc.id, engine, n),
            doc,
            engine=engine,
            n=n,
            layout=_dump_call(result.layout),
            transcription=_dump_call(result.transcription),
            markdown=result.markdown,
        )
        results = self.page_results(doc, engine)
        if len(results) == doc.page_count:
            markdown = DocumentResult([results[n] for n in sorted(results)]).markdown
            self._write(self._rid("document_text", doc.id, engine), doc, engine=engine, markdown=markdown)

    def _result_rows(self, doc: StoredDocument, engine: Engine, fields: str) -> list[dict]:
        return self.db.query(
            f"SELECT {fields} FROM page_result WHERE user = $user AND doc = $doc AND engine = $engine",
            {"user": self.user_id, "doc": doc.id, "engine": engine},
        )

    def page_results(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> dict[int, PageResult]:
        return {
            r["n"]: PageResult(self.page_image(doc, r["n"]), _load_call(r["layout"], PageLayout), _load_call(r["transcription"], PageTranscription))
            for r in sorted(self._result_rows(doc, engine, "n, layout, transcription"), key=lambda r: r["n"])
        }

    def stored_results(self, doc: StoredDocument, engine: Engine) -> dict[int, dict]:
        return {r["n"]: _fields(r, "n", "doc", "engine") for r in self._result_rows(doc, engine, "*")}

    def put_results(self, doc: StoredDocument, engine: Engine, results: dict[int, dict], markdown: str | None) -> None:
        for n, result in results.items():
            self._write(self._rid("page_result", doc.id, engine, n), doc, engine=engine, n=n, **result)
        if markdown is not None:
            self._write(self._rid("document_text", doc.id, engine), doc, engine=engine, markdown=markdown)

    def transcribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> int:
        return doc.page_count - len(self.untranscribed_pages(doc, engine))

    def untranscribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> list[int]:
        done = {r["n"] for r in self._result_rows(doc, engine, "n")}
        return [n for n in range(1, doc.page_count + 1) if n not in done]

    def markdown(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> str | None:
        found = self._read(self._rid("document_text", doc.id, engine))
        return found["markdown"] if found else None

    # --- Budget rows -------------------------------------------------------------

    def save_budget(self, doc: StoredDocument, budget: dict) -> StoredDocument:
        self._write(self._rid("document_budget", doc.id), doc, budget=budget)
        return self.rename(doc, f"{title}.pdf") if (title := budget.get("title")) else doc

    def budget(self, doc: StoredDocument) -> dict | None:
        found = self._read(self._rid("document_budget", doc.id))
        return found["budget"] if found else None


class SurrealStorage(Storage):
    """Opens each user's records and statement files in SurrealDB. `root` only matters for JSON data to copy in."""

    def __init__(self, root: Path | str, db: SurrealDB):
        super().__init__(root)
        self.db = db
        self._registered: set[str] = set()

    def _register(self, user_id: str) -> None:
        if user_id not in self._registered:
            self.db.query("UPSERT $id", {"id": RecordID("app_user", user_id)})
            self._registered.add(user_id)

    def store(self, user_id: str) -> SurrealDataStore:
        self._register(user_id)
        return SurrealDataStore(self.db, user_id, SurrealLibrary(self.db, user_id))

    def memory(self, user_id: str) -> SurrealMemoryStore:
        self._register(user_id)
        return SurrealMemoryStore(self.db, user_id)

    def user_ids(self) -> list[str]:
        return sorted(rid.id for rid in self.db.query("SELECT VALUE id FROM app_user"))

    @staticmethod
    def _user_tables(files: bool) -> list[str]:
        return [t for t in TABLES if t != "app_user" and (files or t not in FILE_TABLES)]

    def has_records(self, user_id: str, files: bool = True) -> bool:
        """Whether SurrealDB holds any of the user's records (or, with `files`, statement files)."""
        found = self.db.run("".join(f"SELECT VALUE id FROM {t} WHERE user = $user LIMIT 1;" for t in self._user_tables(files)), {"user": user_id})
        return any(found)

    def delete_records(self, user_id: str, files: bool = True) -> None:
        """Deletes the user's records (and, with `files`, their statement files) from SurrealDB."""
        self.db.run("".join(f"DELETE {t} WHERE user = $user;" for t in self._user_tables(files)), {"user": user_id})

    def has_data(self, user_id: str) -> bool:
        return self.has_records(user_id)

    def uncopied_json_users(self) -> list[str]:
        """Users with records or statement files on disk (from before SurrealDB was set up) that SurrealDB lacks."""
        json = Storage(self.root)

        def uncopied(user_id: str) -> bool:
            disk = json.store(user_id)
            if has_records(disk) and not self.has_records(user_id, files=False):
                return True
            return bool({d.id for d in disk.files.documents()} - {d.id for d in SurrealLibrary(self.db, user_id).documents()})

        return [u for u in json.user_ids() if uncopied(u)]


def has_records(store: DataStore) -> bool:
    """Whether the store holds any records (statement files aside)."""
    return bool(
        store.statements() or store.transactions() or store.cards() or store.merchant_rules() or store.budgets()
        or store.goal() or store.scans() or store.chats() or store.legacy_chat()
    )
