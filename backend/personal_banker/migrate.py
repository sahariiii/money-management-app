"""Gives the data from before the library was kept per user to one user.

    cd backend
    uv run python -m personal_banker.migrate --user user_2abc...

The old layout (statement folders, cards.json, receipts.json, ... at the top of
library/) is copied into that user's folder (datastore.py), so nothing is deleted.
Transactions keep the ids the app knew them by, so links and attached receipts
still work; transactions added from now on get ids of their own. Afterwards
library/.migrated records who got the data, and the old files can be deleted.
Stop the API server first.
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from . import assistant, ledger
from .datastore import DEFAULT_ROOT, DataStore, Storage, read_json, write_json
from .records import Budget, Card, ChatMessage, ChatRecord, RewardRule, SavingsGoal, ScanRecord, TransactionRecord
from .store import Library


class MigrationError(RuntimeError):
    pass


def migrate_legacy(legacy_root: Path, store: DataStore) -> dict[str, int]:
    """Copies the old shared library at `legacy_root` into `store`; returns how many of each kind of record it moved."""
    if store.statements() or store.transactions() or store.cards():
        raise MigrationError(f"{store.user_id} already has data; refusing to mix the old library into it.")
    legacy = Library(legacy_root)
    counts = {"statements": 0, "transactions": 0, "cards": 0, "receipt scans": 0, "conversations": 0}

    # Oldest first, so a row two statements share belongs to the one that brought it first.
    for doc in reversed(legacy.documents()):
        shutil.copytree(legacy_root / doc.id, store.files.root / doc.id, dirs_exist_ok=True)
        counts["statements"] += 1
        if (budget := legacy.budget(doc)) is not None:
            # The old ids were the row's place in budget.json; keeping them as plain ids keeps the app's links.
            ledger.import_statement(store, doc.id, budget, id_for=lambda position: position)

    cards = read_json(legacy_root / "cards.json", {"cards": [], "reward_rules": []})
    rules = [RewardRule.model_validate(r) for r in cards.get("reward_rules", [])]
    for c in cards.get("cards", []):
        card = Card.model_validate(c)
        store.save_card(card, [r for r in rules if r.card_id == card.id])
        counts["cards"] += 1

    for merchant, category in read_json(legacy_root / "merchant_rules.json", {}).items():
        store.set_merchant_rule(merchant, category)

    receipts = read_json(legacy_root / "receipts.json", {"expenses": []})["expenses"]
    store.save_transactions(
        [
            TransactionRecord(
                id=row["id"],
                source="receipt",
                date=row["date"],
                amount=row["amount"],
                is_income=False,
                currency=row.get("currency") or ledger.CURRENCY,
                merchant=row["merchant"],
                raw_description=f"Receipt from {row['merchant']}",
                auto_category="Other",
                user_category=row.get("app_category") if row.get("app_category") in ledger.APP_CATEGORIES else None,
                card_id=row["card_id"],
                position=row["id"],
                created_at=row.get("added_at") or datetime.now().isoformat(timespec="seconds"),
            )
            for row in receipts
        ]
    )
    counts["transactions"] = len(store.transactions())

    scans = legacy_root / "receipts"
    for path in sorted(scans.glob("*.json")) if scans.exists() else []:
        scan = ScanRecord.model_validate(json.loads(path.read_text(encoding="utf-8")))
        image = path.with_suffix(".jpg")
        store.save_scan(scan, image.read_bytes() if image.exists() else None)
        counts["receipt scans"] += 1

    plan = read_json(legacy_root / "plan.json", {"budgets": [], "goal": None})
    store.replace_budgets([Budget.model_validate(b) for b in plan.get("budgets", [])])
    if plan.get("goal"):
        store.save_goal(SavingsGoal.model_validate(plan["goal"]))

    # Conversations in chats/, and chat.json: the one conversation kept before there were several.
    chats = legacy_root / "chats"
    conversations = [ChatRecord.model_validate(read_json(p, None)) for p in sorted(chats.glob("*.json"))] if chats.exists() else []
    if messages := [ChatMessage.model_validate(m) for m in read_json(legacy_root / "chat.json", {"messages": []})["messages"]]:
        conversations.append(assistant.legacy_conversation(messages))
    for chat in conversations:
        store.save_chat(chat)
    counts["conversations"] = len(conversations)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", required=True, help="The Clerk user id to give the data to (the server logs it).")
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="The library folder (default: %(default)s).")
    args = parser.parse_args()

    storage = Storage(args.library)
    if not storage.unmigrated_legacy():
        raise SystemExit(f"Nothing to migrate in {args.library}.")
    try:
        counts = migrate_legacy(storage.root, storage.store(args.user))
    except MigrationError as e:
        raise SystemExit(str(e)) from e
    write_json(storage.root / ".migrated", {"user_id": args.user, "migrated_at": datetime.now().isoformat(timespec="seconds")})
    print(f"Gave {args.user}: " + ", ".join(f"{n} {kind}" for kind, n in counts.items()) + ".")
    print(f"The old files in {storage.root} are untouched; delete them once the app looks right.")


if __name__ == "__main__":
    main()
