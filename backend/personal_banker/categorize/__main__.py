"""Categorize a user's transcribed statements into budget rows and the app's ledger.

    uv run python -m personal_banker.categorize                  # every transcribed statement not yet categorized
    uv run python -m personal_banker.categorize <document id>... # specific statements (re-categorizes them)

Saves each statement's rows to its budget.json, imports them into the ledger and writes all rows to an .xlsx.
Without a budget workbook, statements are sorted into the app's own categories.
"""

import argparse
from pathlib import Path

from ..datastore import DEFAULT_ROOT, local_user, open_storage
from ..llm import make_client
from ..service import CategorizeSkipped, save_categorized, workbook_setup
from . import DEFAULT_WORKBOOK, budget_record, categorize_statement, load_budget_setup, to_xlsx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("documents", nargs="*", help="Library document ids (folder names).")
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="Library folder (default: %(default)s).")
    parser.add_argument("--user", help="Whose statements (default: PERSONAL_BANKER_LOCAL_USER).")
    parser.add_argument("--workbook", type=Path, default=Path(DEFAULT_WORKBOOK), help="Budget workbook to follow, if it exists.")
    parser.add_argument("--out", type=Path, default=Path("output/budget_rows.xlsx"))
    args = parser.parse_args()

    storage = open_storage(args.library)
    store = storage.store(args.user or local_user(storage))
    library = store.files
    transcribed = [d for d in library.documents() if library.markdown(d) is not None]
    if args.documents:
        by_id = {d.id: d for d in transcribed}
        missing = [i for i in args.documents if i not in by_id]
        if missing:
            parser.error(f"not in the library or not fully transcribed: {', '.join(missing)}")
        todo = [by_id[i] for i in args.documents]
    else:
        todo = [d for d in transcribed if library.budget(d) is None]

    try:
        if args.workbook.exists():
            setup, setup_name = load_budget_setup(args.workbook.read_bytes()), args.workbook.name
        else:
            setup, setup_name = workbook_setup(store)
    except (CategorizeSkipped, ValueError) as e:
        parser.error(str(e))
    print(f"Categorizing with {setup_name}: {len(setup.rules)} vendor rules")
    client = make_client()
    for doc in todo:
        result = categorize_statement(client, library.markdown(doc), setup)
        save_categorized(store, doc, budget_record(result, setup_name))
        print(
            f"{doc.id}: {len(result.expenses)} expenses, {len(result.income)} income, {len(result.skipped)} skipped "
            f"({result.rule_matches} by vendor rules)"
        )

    expenses, income, skipped = [], [], []
    for doc in todo if args.documents else transcribed:
        if budget := library.budget(doc):
            expenses += [{**r, "statement": doc.name} for r in budget["expenses"]]
            income += [{**r, "statement": doc.name} for r in budget["income"]]
            skipped += [{**r, "statement": doc.name} for r in budget["skipped"]]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(to_xlsx(expenses, income, skipped, setup))
    print(f"Wrote {len(expenses)} expenses and {len(income)} income rows to {args.out}")


if __name__ == "__main__":
    main()
