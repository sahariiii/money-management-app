import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
import pandas as pd
import streamlit as st

from personal_banker.categorize import budget_record, categorize_statement, to_xlsx
from personal_banker.llm import ExtractionError
from personal_banker.service import CategorizeSkipped, save_categorized, workbook_setup
from personal_banker.store import Library
from personal_banker.streamlit_support import (
    budget_setup,
    credentials_notice,
    get_client,
    get_library,
    get_store,
)

# app_category is the category picked in the mobile app; it isn't shown here but must survive saving edits.
EXPENSE_COLUMNS = ["date", "vendor", "amount", "category", "likely_shared", "statement_description", "review_note", "categorized_by", "app_category", "statement", "doc"]
INCOME_COLUMNS = ["date", "source", "amount", "category", "statement_description", "review_note", "categorized_by", "app_category", "statement", "doc"]
SKIPPED_COLUMNS = ["date", "statement_description", "amount", "reason", "categorized_by", "statement", "doc"]
# Columns the page adds for display; they are not stored in budget.json.
DISPLAY_ONLY = ("statement", "doc")
HIDDEN = ("doc", "app_category")
BY_COLUMN = st.column_config.TextColumn(
    "By", width="small", help="rule: your Vendor Rules tab · agent: Claude · you: edited here"
)


def to_records(df: pd.DataFrame) -> list[dict]:
    """Table rows back to plain JSON-safe dicts with ISO date strings."""
    df = df.copy()
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    return json.loads(df.to_json(orient="records"))


def frame(rows: list[dict], columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=columns)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    return df


store = get_store()
library: Library = store.files
if "cat_errors" not in st.session_state:
    st.session_state.cat_errors = {}  # document id -> error message from the last run

st.title("Budget categories")
st.caption(
    "Sorts the transactions in your transcribed statements into the categories from your budget workbook "
    "(or the app's own, without one). Results and your edits are saved with each statement under "
    f"{library.location} and go into the app's ledger."
)

# --- Inputs: transcribed documents and the budget workbook -------------------

ready = {d.id: d for d in library.documents() if library.markdown(d) is not None}
if not ready:
    st.info("Analyse every page of a statement on the Document viewer page first.", title="No transcribed statements yet")
    st.page_link("app_pages/document_viewer.py", label="Open the document viewer", icon=":material/document_scanner:")
    st.stop()

try:
    setup, workbook_name = workbook_setup(store, budget_setup)
except CategorizeSkipped as e:
    st.error(str(e), title="Problem with the budget workbook")
    st.stop()
st.caption(
    f"Using {workbook_name}: {len(setup.expense_categories)} expense and {len(setup.income_categories)} income "
    f"categories, {len(setup.rules)} vendor rules, and {len(setup.past_expenses) + len(setup.past_income)} past "
    "entries as examples. Rows a vendor rule matches are categorized without Claude."
)

selected = st.pills(
    "Statements",
    options=list(ready),
    format_func=lambda i: ready[i].name,
    selection_mode="multi",
    default=list(ready),
)
budgets = {doc_id: library.budget(ready[doc_id]) for doc_id in selected}

has_credentials = credentials_notice()
with st.container(horizontal=True, vertical_alignment="center"):
    redo = st.toggle(
        "Redo categorized statements",
        help="Categorize the selected statements again. This replaces their saved rows and any edits you made.",
    )
    todo = [doc_id for doc_id in selected if redo or budgets[doc_id] is None]
    run = st.button(
        f"Categorize {len(todo)} statement{'s' if len(todo) != 1 else ''}",
        icon=":material/category:",
        type="primary",
        disabled=not todo or not has_credentials,
    )

if run:
    client = get_client()
    progress = st.progress(0.0, text=f"Categorizing {len(todo)} statements")
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(categorize_statement, client, library.markdown(ready[doc_id]), setup): doc_id
            for doc_id in todo
        }
        for finished, future in enumerate(as_completed(futures), start=1):
            doc_id = futures[future]
            try:
                save_categorized(store, ready[doc_id], budget_record(future.result(), workbook_name))
                st.session_state.cat_errors.pop(doc_id, None)
            except (ExtractionError, anthropic.APIError) as e:
                st.session_state.cat_errors[doc_id] = str(e)
            progress.progress(finished / len(todo), text=f"Categorized {finished} of {len(todo)} statements")
    st.rerun()

for doc_id in selected:
    if doc_id in st.session_state.cat_errors:
        st.error(st.session_state.cat_errors[doc_id], title=f"{ready[doc_id].name} failed. Press the button again to retry.")

done = [doc_id for doc_id in selected if budgets[doc_id] is not None]
if not done:
    st.stop()

# --- Review, save edits and export ----------------------------------------------

expenses, income, skipped = [], [], []
for doc_id in done:
    tag = {"statement": ready[doc_id].name, "doc": doc_id}
    expenses += [{**row, **tag} for row in budgets[doc_id]["expenses"]]
    income += [{**row, **tag} for row in budgets[doc_id]["income"]]
    skipped += [{**row, **tag} for row in budgets[doc_id]["skipped"]]
base_expenses, base_income = frame(expenses, EXPENSE_COLUMNS), frame(income, INCOME_COLUMNS)

# Editor state is tied to the selection; it is cleared after saving so the saved rows show.
editor_key = hashlib.sha256("|".join(done).encode()).hexdigest()[:12]
expense_key, income_key = f"expenses_{editor_key}", f"income_{editor_key}"

expense_tab, income_tab, skipped_tab = st.tabs(
    [f"Expenses ({len(expenses)})", f"Income ({len(income)})", f"Skipped ({len(skipped)})"]
)

with expense_tab:
    edited_expenses = st.data_editor(
        base_expenses,
        key=expense_key,
        column_order=[c for c in EXPENSE_COLUMNS if c not in (*HIDDEN, "likely_shared")],
        hide_index=True,
        disabled=["statement_description", "review_note", "categorized_by", "statement"],
        alt="Categorized expenses",
        column_config={
            "date": st.column_config.DateColumn("Date", format="MM-DD-YYYY"),
            "vendor": "Store / vendor",
            "amount": st.column_config.NumberColumn("$ Amount", format="%.2f"),
            "category": st.column_config.SelectboxColumn(
                "Category", options=[c.name for c in setup.expense_categories], required=True
            ),
            "statement_description": st.column_config.TextColumn("Statement description", width="large"),
            "review_note": st.column_config.TextColumn("Review note", width="medium"),
            "categorized_by": BY_COLUMN,
            "statement": "Statement",
        },
    )
    st.caption(
        f"Amounts are the full amounts on the statement. "
        f"With a review note: {edited_expenses['review_note'].notna().sum()}. "
        "Edit vendors or categories in the table before downloading."
    )

with income_tab:
    edited_income = st.data_editor(
        base_income,
        key=income_key,
        column_order=[c for c in INCOME_COLUMNS if c not in HIDDEN],
        hide_index=True,
        disabled=["statement_description", "review_note", "categorized_by", "statement"],
        alt="Categorized income",
        column_config={
            "date": st.column_config.DateColumn("Date", format="MM-DD-YYYY"),
            "source": "Source",
            "amount": st.column_config.NumberColumn("$ Amount", format="%.2f"),
            "category": st.column_config.SelectboxColumn(
                "Category", options=[c.name for c in setup.income_categories], required=True
            ),
            "statement_description": st.column_config.TextColumn("Statement description", width="large"),
            "review_note": st.column_config.TextColumn("Review note", width="medium"),
            "categorized_by": BY_COLUMN,
            "statement": "Statement",
        },
    )

with skipped_tab:
    st.caption("Card payments, transfers between your own accounts and similar lines, left out of the budget.")
    skipped_df = frame(skipped, SKIPPED_COLUMNS)
    st.dataframe(
        skipped_df,
        column_order=[c for c in SKIPPED_COLUMNS if c != "doc"],
        hide_index=True,
        alt="Statement lines that were neither expenses nor income",
        column_config={
            "date": st.column_config.DateColumn("Date", format="MM-DD-YYYY"),
            "statement_description": st.column_config.TextColumn("Statement description", width="large"),
            "amount": st.column_config.NumberColumn("Amount", format="%.2f"),
            "reason": st.column_config.TextColumn("Reason", width="medium"),
            "categorized_by": BY_COLUMN,
            "statement": "Statement",
        },
    )

def mark_edits(edited: list[dict], base: list[dict]) -> list[dict]:
    """Rows the user changed are theirs now, whatever rule or agent filled them in."""
    return [e if e == b else {**e, "categorized_by": "you"} for e, b in zip(edited, base)]


edited_expense_rows = mark_edits(to_records(edited_expenses), to_records(base_expenses))
edited_income_rows = mark_edits(to_records(edited_income), to_records(base_income))
if edited_expense_rows != to_records(base_expenses) or edited_income_rows != to_records(base_income):
    with st.container(horizontal=True, vertical_alignment="center"):
        st.warning("You have unsaved edits.")
        if st.button("Save edits", icon=":material/save:"):
            for doc_id in done:
                def own(rows: list[dict]) -> list[dict]:
                    return [{k: v for k, v in r.items() if k not in DISPLAY_ONLY} for r in rows if r["doc"] == doc_id]

                save_categorized(
                    store,
                    ready[doc_id],
                    {**budgets[doc_id], "edited": True,
                     "expenses": own(edited_expense_rows), "income": own(edited_income_rows)},
                )
            del st.session_state[expense_key], st.session_state[income_key]
            st.rerun()

with st.container(horizontal=True):
    st.metric("Expenses", f"{edited_expenses['amount'].sum():,.2f}")
    st.metric("Income", f"{edited_income['amount'].sum():,.2f}")
    st.metric("Net", f"{edited_income['amount'].sum() - edited_expenses['amount'].sum():,.2f}")

st.subheader("Spending by category")
by_category = (
    edited_expenses.groupby("category", as_index=False)["amount"].sum().sort_values("amount", ascending=False)
)
st.dataframe(
    by_category,
    hide_index=True,
    alt="Total spending per expense category",
    column_config={
        "category": "Category",
        "amount": st.column_config.ProgressColumn(
            "$ Amount", format="%.2f", min_value=0, max_value=float(by_category["amount"].max() or 1)
        ),
    },
)

st.download_button(
    "Download for budget workbook (.xlsx)",
    to_xlsx(edited_expense_rows, edited_income_rows, to_records(skipped_df), setup),
    file_name="budget_rows.xlsx",
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    icon=":material/download:",
    type="primary",
)
st.caption(
    "In the download, columns A-F match your Expenses / Income sheets. Copy them and paste as values at B8; "
    "the shared suggestion, statement description and review note columns are there for checking."
)
