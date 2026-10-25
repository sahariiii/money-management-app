"""Where each user's records live: the DataStore interface and its JSON implementation.

Everything the API keeps for a user goes through a DataStore scoped to that user;
nothing else reads or writes their records. JsonDataStore keeps them as JSON files:

    library/                         PERSONAL_BANKER_LIBRARY, git-ignored
      users/<user>/
        user.json                    {"user_id": ...}: the Clerk user id the folder belongs to
        statements/<doc id>/         the statement's files (store.Library): PDF, pages, transcriptions,
                                     the categorizer's budget.json
        statements.json              StatementRecord per statement: processing status, account, period
        transactions.json            TransactionRecord per transaction
        cards.json                   cards (in the order added) and their reward rules
        merchant_rules.json          merchant -> app category ("always categorize" in the app)
        plan.json                    monthly budgets and the savings goal
        chat.json                    the conversation with the assistant
        receipts/<scan id>.json/.jpg scanned receipts and their photos
        memory.json                  the assistant's long-term memory (memory.py)

A database-backed store implements the same DataStore protocol; callers don't change.
"""

import json
import os
import re
import threading
from hashlib import sha256
from pathlib import Path
from typing import Any, Protocol

from .records import (
    Budget,
    Card,
    ChatMessage,
    RewardRule,
    SavingsGoal,
    ScanRecord,
    StatementRecord,
    TransactionRecord,
)
from .store import Library

DEFAULT_ROOT = Path(os.environ.get("PERSONAL_BANKER_LIBRARY", "library"))
# The user Streamlit and the command-line tools act as (see local_user).
LOCAL_USER_ENV = "PERSONAL_BANKER_LOCAL_USER"


class DataStore(Protocol):
    """One user's records. Every method only ever sees that user's data."""

    user_id: str
    files: Library  # the user's statement files

    # --- Statements ------------------------------------------------------------
    def statements(self) -> list[StatementRecord]: ...
    def statement(self, statement_id: str) -> StatementRecord | None: ...
    def update_statement(self, statement_id: str, **fields: Any) -> StatementRecord:
        """Changes the given fields, creating the record if there is none; returns it as stored."""
        ...

    # --- Transactions ----------------------------------------------------------
    def transactions(self) -> list[TransactionRecord]: ...
    def transaction(self, tx_id: str) -> TransactionRecord | None: ...
    def save_transactions(self, records: list[TransactionRecord]) -> None:
        """Adds the records, replacing any with the same id."""
        ...
    def update_transaction(self, tx_id: str, **fields: Any) -> TransactionRecord | None: ...
    def delete_transactions(self, tx_ids: list[str]) -> None: ...

    # --- Cards and reward rules ------------------------------------------------
    def cards(self) -> list[Card]: ...
    def reward_rules(self) -> list[RewardRule]: ...
    def save_card(self, card: Card, rules: list[RewardRule]) -> None:
        """Adds or replaces the card, and replaces all of its reward rules."""
        ...
    def delete_card(self, card_id: str) -> bool: ...

    # --- Merchant rules --------------------------------------------------------
    def merchant_rules(self) -> dict[str, str]: ...
    def set_merchant_rule(self, merchant: str, category: str) -> None: ...

    # --- Budgets and the savings goal ------------------------------------------
    def budgets(self) -> list[Budget]: ...
    def save_budget(self, budget: Budget) -> None:
        """Adds or replaces the budget for its category."""
        ...
    def replace_budgets(self, budgets: list[Budget]) -> None: ...
    def goal(self) -> SavingsGoal | None: ...
    def save_goal(self, goal: SavingsGoal | None) -> None: ...

    # --- Scanned receipts ------------------------------------------------------
    def scans(self) -> list[ScanRecord]: ...
    def scan(self, scan_id: str) -> ScanRecord | None: ...
    def save_scan(self, scan: ScanRecord, image_jpeg: bytes | None = None) -> None: ...
    def scan_image(self, scan_id: str) -> bytes | None: ...
    def delete_scan(self, scan_id: str) -> None: ...

    # --- Assistant chat ----------------------------------------------------------
    def chat(self) -> list[ChatMessage]: ...
    def add_chat_messages(self, messages: list[ChatMessage]) -> None: ...
    def clear_chat(self) -> None: ...


# ---------------------------------------------------------------------------
# JSON files


def write_file(path: Path, data: str | bytes) -> None:
    """Write via a temporary file so a crash never leaves half a file behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
    tmp.replace(path)


def write_json(path: Path, value: Any) -> None:
    write_file(path, json.dumps(value, indent=2, ensure_ascii=False))


def read_json(path: Path, default: Any) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


_locks: dict[Path, threading.RLock] = {}
_locks_guard = threading.Lock()


def folder_lock(folder: Path) -> threading.RLock:
    """One lock per user folder, shared by every store object opened on it in this process."""
    key = folder.resolve()
    with _locks_guard:
        return _locks.setdefault(key, threading.RLock())


class JsonDataStore:
    """DataStore over JSON files in one user's folder. Each change rewrites its collection's file under the folder's lock."""

    def __init__(self, folder: Path, user_id: str):
        self.folder = folder
        self.user_id = user_id
        self.files = Library(folder / "statements")
        self._lock = folder_lock(folder)

    def _path(self, name: str) -> Path:
        return self.folder / name

    # --- Statements ------------------------------------------------------------

    def _statement_map(self) -> dict[str, dict]:
        return read_json(self._path("statements.json"), {})

    def statements(self) -> list[StatementRecord]:
        return [StatementRecord.model_validate(r) for r in self._statement_map().values()]

    def statement(self, statement_id: str) -> StatementRecord | None:
        found = self._statement_map().get(statement_id)
        return StatementRecord.model_validate(found) if found else None

    def update_statement(self, statement_id: str, **fields: Any) -> StatementRecord:
        with self._lock:
            records = self._statement_map()
            current = records.get(statement_id) or {"id": statement_id}
            record = StatementRecord.model_validate({**current, **fields})
            records[statement_id] = record.model_dump(mode="json")
            write_json(self._path("statements.json"), records)
        return record

    # --- Transactions ----------------------------------------------------------

    def _transaction_map(self) -> dict[str, dict]:
        return read_json(self._path("transactions.json"), {})

    def transactions(self) -> list[TransactionRecord]:
        return [TransactionRecord.model_validate(r) for r in self._transaction_map().values()]

    def transaction(self, tx_id: str) -> TransactionRecord | None:
        found = self._transaction_map().get(tx_id)
        return TransactionRecord.model_validate(found) if found else None

    def save_transactions(self, records: list[TransactionRecord]) -> None:
        if not records:
            return
        with self._lock:
            stored = self._transaction_map()
            for r in records:
                stored[r.id] = r.model_dump(mode="json")
            write_json(self._path("transactions.json"), stored)

    def update_transaction(self, tx_id: str, **fields: Any) -> TransactionRecord | None:
        with self._lock:
            stored = self._transaction_map()
            if tx_id not in stored:
                return None
            record = TransactionRecord.model_validate({**stored[tx_id], **fields})
            stored[tx_id] = record.model_dump(mode="json")
            write_json(self._path("transactions.json"), stored)
        return record

    def delete_transactions(self, tx_ids: list[str]) -> None:
        with self._lock:
            stored = self._transaction_map()
            if any(i in stored for i in tx_ids):
                write_json(self._path("transactions.json"), {k: v for k, v in stored.items() if k not in set(tx_ids)})

    # --- Cards and reward rules ------------------------------------------------

    def _cards_file(self) -> dict:
        return read_json(self._path("cards.json"), {"cards": [], "reward_rules": []})

    def cards(self) -> list[Card]:
        return [Card.model_validate(c) for c in self._cards_file()["cards"]]

    def reward_rules(self) -> list[RewardRule]:
        return [RewardRule.model_validate(r) for r in self._cards_file()["reward_rules"]]

    def save_card(self, card: Card, rules: list[RewardRule]) -> None:
        with self._lock:
            data = self._cards_file()
            cards = [c for c in data["cards"] if c["id"] != card.id]
            at = next((i for i, c in enumerate(data["cards"]) if c["id"] == card.id), len(data["cards"]))
            cards.insert(at, card.model_dump())  # an edited card keeps its place
            other_rules = [r for r in data["reward_rules"] if r["card_id"] != card.id]
            write_json(self._path("cards.json"), {"cards": cards, "reward_rules": [*other_rules, *(r.model_dump() for r in rules)]})

    def delete_card(self, card_id: str) -> bool:
        with self._lock:
            data = self._cards_file()
            if not any(c["id"] == card_id for c in data["cards"]):
                return False
            write_json(
                self._path("cards.json"),
                {
                    "cards": [c for c in data["cards"] if c["id"] != card_id],
                    "reward_rules": [r for r in data["reward_rules"] if r["card_id"] != card_id],
                },
            )
        return True

    # --- Merchant rules --------------------------------------------------------

    def merchant_rules(self) -> dict[str, str]:
        return read_json(self._path("merchant_rules.json"), {})

    def set_merchant_rule(self, merchant: str, category: str) -> None:
        with self._lock:
            write_json(self._path("merchant_rules.json"), {**self.merchant_rules(), merchant: category})

    # --- Budgets and the savings goal ------------------------------------------

    def _plan(self) -> dict:
        return read_json(self._path("plan.json"), {"budgets": [], "goal": None})

    def _save_plan(self, budgets: list[Budget], goal: SavingsGoal | None) -> None:
        write_json(
            self._path("plan.json"),
            {"budgets": [b.model_dump(mode="json") for b in budgets], "goal": goal.model_dump(mode="json") if goal else None},
        )

    def budgets(self) -> list[Budget]:
        return [Budget.model_validate(b) for b in self._plan()["budgets"]]

    def save_budget(self, budget: Budget) -> None:
        with self._lock:
            saved = self.budgets()
            if any(b.category == budget.category for b in saved):
                saved = [budget if b.category == budget.category else b for b in saved]
            else:
                saved = [*saved, budget]
            self._save_plan(saved, self.goal())

    def replace_budgets(self, budgets: list[Budget]) -> None:
        with self._lock:
            self._save_plan(budgets, self.goal())

    def goal(self) -> SavingsGoal | None:
        saved = self._plan()["goal"]
        return SavingsGoal.model_validate(saved) if saved else None

    def save_goal(self, goal: SavingsGoal | None) -> None:
        with self._lock:
            self._save_plan(self.budgets(), goal)

    # --- Scanned receipts ------------------------------------------------------
    # Ids are checked by the caller (ledger.is_scan_id) before they reach a path.

    def scans(self) -> list[ScanRecord]:
        folder = self._path("receipts")
        return [ScanRecord.model_validate(read_json(p, None)) for p in sorted(folder.glob("*.json"))] if folder.exists() else []

    def scan(self, scan_id: str) -> ScanRecord | None:
        found = read_json(self._path("receipts") / f"{scan_id}.json", None)
        return ScanRecord.model_validate(found) if found else None

    def save_scan(self, scan: ScanRecord, image_jpeg: bytes | None = None) -> None:
        with self._lock:
            if image_jpeg is not None:
                write_file(self._path("receipts") / f"{scan.id}.jpg", image_jpeg)
            write_json(self._path("receipts") / f"{scan.id}.json", scan.model_dump(mode="json"))

    def scan_image(self, scan_id: str) -> bytes | None:
        path = self._path("receipts") / f"{scan_id}.jpg"
        return path.read_bytes() if path.exists() else None

    def delete_scan(self, scan_id: str) -> None:
        with self._lock:
            for suffix in (".json", ".jpg"):
                (self._path("receipts") / f"{scan_id}{suffix}").unlink(missing_ok=True)

    # --- Assistant chat ----------------------------------------------------------

    def chat(self) -> list[ChatMessage]:
        return [ChatMessage.model_validate(m) for m in read_json(self._path("chat.json"), {"messages": []})["messages"]]

    def add_chat_messages(self, messages: list[ChatMessage]) -> None:
        with self._lock:
            saved = read_json(self._path("chat.json"), {"messages": []})["messages"]
            write_json(self._path("chat.json"), {"messages": [*saved, *(m.model_dump() for m in messages)]})

    def clear_chat(self) -> None:
        with self._lock:
            write_json(self._path("chat.json"), {"messages": []})


# ---------------------------------------------------------------------------
# Opening a user's store

_SAFE_USER = re.compile(r"[A-Za-z0-9_-]{1,100}")


def user_folder_name(user_id: str) -> str:
    """Clerk ids (user_...) are used as they are; anything else gets a name that is safe as a folder."""
    return user_id if _SAFE_USER.fullmatch(user_id) else f"u-{sha256(user_id.encode()).hexdigest()[:24]}"


class Storage:
    """Opens each user's stores. The one place that knows how users map to storage."""

    def __init__(self, root: Path | str = DEFAULT_ROOT):
        self.root = Path(root)

    def _folder(self, user_id: str) -> Path:
        return self.root / "users" / user_folder_name(user_id)

    def store(self, user_id: str) -> JsonDataStore:
        folder = self._folder(user_id)
        if not (folder / "user.json").exists():
            write_json(folder / "user.json", {"user_id": user_id})
        return JsonDataStore(folder, user_id)

    def memory(self, user_id: str):
        from .memory import JsonMemoryStore

        return JsonMemoryStore(self.store(user_id).folder / "memory.json", user_id)

    def user_ids(self) -> list[str]:
        """Every user with a folder, e.g. to resume their statements at startup."""
        users = self.root / "users"
        return sorted(read_json(p, {})["user_id"] for p in users.glob("*/user.json")) if users.exists() else []

    def has_data(self, user_id: str) -> bool:
        folder = self._folder(user_id)
        return folder.exists() and any(p.name != "user.json" for p in folder.iterdir())

    def unmigrated_legacy(self) -> bool:
        """The library still holds data from before it was kept per user (see migrate.py)."""
        if (self.root / ".migrated").exists():
            return False
        legacy = ("cards.json", "merchant_rules.json", "receipts.json", "chat.json", "plan.json")
        return any((self.root / name).exists() for name in legacy) or any(self.root.glob("*/meta.json"))


def local_user(storage: Storage) -> str:
    """The user Streamlit and the command-line tools act as: PERSONAL_BANKER_LOCAL_USER, else the only user there is."""
    if user := os.environ.get(LOCAL_USER_ENV):
        return user
    users = storage.user_ids()
    if len(users) == 1:
        return users[0]
    raise RuntimeError(
        f"Set {LOCAL_USER_ENV} in .env to the Clerk user id to work as"
        + (f" (one of: {', '.join(users)})." if users else " (no user has data yet).")
    )
