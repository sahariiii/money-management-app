"""Copies each user's records (JSON files) and statement files from library/users/ into SurrealDB.

    cd backend
    uv run python -m personal_banker.copy_to_surreal                   # every user
    uv run python -m personal_banker.copy_to_surreal --user user_2abc...

Fill in the SURREALDB_* settings in .env first. Ids are kept, so the app's links
still work. Records are copied only for a user who has none in SurrealDB yet; statement
files only when SurrealDB doesn't have that statement yet, so running it again is safe.
Nothing on disk is changed, so taking SURREALDB_URL out of .env goes back to it.
Stop the API server first.
"""

import argparse
from pathlib import Path

from . import assistant
from .datastore import DEFAULT_ROOT, DataStore, JsonDataStore, Storage
from .memory import MemoryStore
from .store import StatementFiles, copy_document
from .surreal import SurrealDB, SurrealMemoryStore, SurrealStorage


def copy_user(source: JsonDataStore, target: DataStore, source_memory: MemoryStore, target_memory: SurrealMemoryStore) -> dict[str, int]:
    """Copies one user's records; returns how many of each kind it copied."""
    for statement in source.statements():
        target.update_statement(statement.id, **statement.model_dump(exclude={"id"}))
    target.save_transactions(source.transactions())

    rules = source.reward_rules()
    for card in source.cards():  # in the order added
        target.save_card(card, [r for r in rules if r.card_id == card.id])
    for merchant, category in source.merchant_rules().items():
        target.set_merchant_rule(merchant, category)

    target.replace_budgets(source.budgets())
    target.save_goal(source.goal())

    for scan in source.scans():
        target.save_scan(scan, source.scan_image(scan.id))

    chats = source.chats()
    if old := source.legacy_chat():  # the one conversation from before there were several
        chats.append(assistant.legacy_conversation(old))
    for chat in chats:
        target.save_chat(chat)

    for memory in source_memory.memories():
        target_memory.keep(memory)

    return {
        "statements": len(source.statements()),
        "transactions": len(source.transactions()),
        "cards": len(source.cards()),
        "receipt scans": len(source.scans()),
        "conversations": len(chats),
        "memories": len(source_memory.memories()),
    }


def copy_files(source: StatementFiles, target: StatementFiles) -> int:
    """Copies the statements `target` doesn't have yet, oldest first; returns how many."""
    have = {d.id for d in target.documents()}
    todo = [d for d in reversed(source.documents()) if d.id not in have]
    for i, doc in enumerate(todo, 1):
        print(f"  statement files {i}/{len(todo)}: {doc.name}", flush=True)
        copy_document(source, target, doc)
    return len(todo)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", help="Only this Clerk user id (default: every user in the library).")
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="The library folder (default: %(default)s).")
    args = parser.parse_args()

    if (db := SurrealDB.from_env()) is None:
        raise SystemExit("Set SURREALDB_URL and the other SURREALDB_* settings in .env first (see .env.example).")
    json, surreal = Storage(args.library), SurrealStorage(args.library, db)
    users = [args.user] if args.user else json.user_ids()
    if not users:
        raise SystemExit(f"No user has data in {json.root / 'users'}.")
    for user_id in users:
        if surreal.has_records(user_id, files=False):
            print(f"{user_id}: already has records in SurrealDB; not copying them again.")
        else:
            try:
                counts = copy_user(json.store(user_id), surreal.store(user_id), json.memory(user_id), surreal.memory(user_id))
            except BaseException:
                surreal.delete_records(user_id, files=False)  # they had none before, so a rerun starts clean
                raise
            print(f"{user_id}: copied " + ", ".join(f"{n} {kind}" for kind, n in counts.items()) + ".")
        copied = copy_files(json.store(user_id).files, surreal.store(user_id).files)
        print(f"{user_id}: copied the files of {copied} statement(s).")
    print(f"Everything is in SurrealDB at {db.url} ({db.namespace}/{db.database}); nothing on disk was changed.")
    db.close()


if __name__ == "__main__":
    main()
