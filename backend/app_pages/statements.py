import pandas as pd
import streamlit as st

from personal_banker.store import Library
from personal_banker.streamlit_support import get_library

library: Library = get_library()

st.title("Statements")
st.caption("The e-statements saved in your library. Add new ones on the Document viewer page.")

saved = []
for doc in library.documents():
    budget = library.budget(doc)
    rows = budget["expenses"] + budget["income"] + budget["skipped"] if budget else []
    dates = pd.to_datetime([r["date"] for r in rows], errors="coerce").dropna()
    if budget:
        status = "Categorized"
    elif library.markdown(doc) is not None:
        status = "Transcribed"
    else:
        status = f"{library.transcribed_pages(doc)} of {doc.page_count} pages transcribed"
    saved.append(
        {
            "statement": doc.name,
            "uploaded_as": doc.original_name or doc.name,
            "first": dates.min() if len(dates) else None,
            "last": dates.max() if len(dates) else None,
            "transactions": len(rows) if budget else None,
            "status": status,
            "added": pd.to_datetime(doc.added),
        }
    )

if not saved:
    st.info(f"No statements saved under {library.location} yet.", title="No statements yet")
    st.page_link("app_pages/document_viewer.py", label="Open the document viewer", icon=":material/document_scanner:")
    st.stop()

st.dataframe(
    pd.DataFrame(saved).sort_values("first", na_position="last"),
    hide_index=True,
    alt="E-statements saved in the library with their transaction date ranges",
    column_config={
        "statement": st.column_config.TextColumn("Statement", width="large"),
        "uploaded_as": "Uploaded as",
        "first": st.column_config.DateColumn("First transaction"),
        "last": st.column_config.DateColumn("Last transaction"),
        "transactions": st.column_config.NumberColumn("Transactions", width="small"),
        "status": "Status",
        "added": st.column_config.DatetimeColumn("Uploaded", format="YYYY-MM-DD HH:mm"),
    },
)
st.caption(
    "Transaction dates come from the categorized rows, so they appear once a statement has been "
    "categorized on the Budget categories page."
)
st.page_link("app_pages/document_viewer.py", label="Add a statement in the document viewer", icon=":material/upload_file:")
