"""Categorize transcribed statements from the library into budget rows.

    uv run python -m personal_banker.categorize                  # every transcribed statement not yet categorized
    uv run python -m personal_banker.categorize <document id>... # specific statements (re-categorizes them)

Saves each statement's rows to its budget.json and writes all rows to an .xlsx.
"""

import argparse
from pathlib import Path

from ..llm import make_client
from ..store import DEFAULT_ROOT, Library
from . import DEFAULT_WORKBOOK, RulesError, budget_record, categorize_statement, load_budget_setup, to_xlsx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("documents", nargs="*", help="Library document ids (folder names).")
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="Library folder (default: %(default)s).")
    parser.add_argument("--workbook", type=Path, default=Path(DEFAULT_WORKBOOK), help="Budget workbook to follow.")
    parser.add_argument("--out", type=Path, default=Path("output/budget_rows.xlsx"))
    args = parser.parse_args()

    library = Library(args.library)
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
        setup = load_budget_setup(args.workbook)
    except RulesError as e:
        parser.error(str(e))
    print(f"{len(setup.rules)} vendor rules loaded from {args.workbook.name}")
    client = make_client()
    for doc in todo:
        result = categorize_statement(client, library.markdown(doc), setup)
        library.save_budget(doc, budget_record(result, args.workbook.name))
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
