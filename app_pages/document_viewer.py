import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
import pandas as pd
import streamlit as st

from personal_banker.docai import PageResult, render_pdf
from personal_banker.docai.pipeline import DEFAULT_CONCURRENCY, process_page
from personal_banker.docai.visualize import draw_layout
from personal_banker.llm import ExtractionError
from personal_banker.pipeline import PasswordRequired, StatementError, prepare_pdf
from personal_banker.categorize import DEFAULT_WORKBOOK, RulesError, budget_record, categorize_statement
from personal_banker.store import Library, StoredDocument
from personal_banker.streamlit_support import (
    budget_setup,
    budget_workbook,
    credentials_notice,
    get_client,
    get_library,
)


@st.cache_data(max_entries=8)
def load_results(doc_id: str, transcribed: int) -> dict[int, PageResult]:
    # `transcribed` is part of the cache key, so the cache refreshes whenever a page is added.
    library = get_library()
    return library.page_results(library.get(doc_id))


def escape_math(markdown: str) -> str:
    # st.markdown treats $...$ as LaTeX, which mangles currency amounts.
    return markdown.replace("$", r"\$")


library: Library = get_library()
if "page_errors" not in st.session_state:
    st.session_state.page_errors = {}  # (document id, page number) -> error message from the last run

st.title("Document viewer")
st.caption(
    "Each page is rendered to an image, Claude detects its layout, then transcribes it using that layout. "
    f"Everything is saved under {library.root}/."
)

# --- Add a document -----------------------------------------------------------

upload = st.file_uploader("Add a document (PDF)", type="pdf")
if upload is not None:
    raw = upload.getvalue()
    digest = hashlib.sha256(raw).hexdigest()
    # The uploader keeps its file across reruns; only add (and switch to) it once.
    if st.session_state.get("last_upload") != digest:
        doc = library.find(digest)
        if doc is None:
            try:
                try:
                    pdf = prepare_pdf(raw)
                except PasswordRequired:
                    password = st.text_input(f"Password for {upload.name}", type="password", key=f"pw_{digest}")
                    if not password:
                        st.stop()
                    pdf = prepare_pdf(raw, password)
            except StatementError as e:
                st.error(str(e), title=upload.name)
                st.stop()
            with st.spinner("Rendering pages"):
                doc = library.add(upload.name, raw, render_pdf(pdf))
            st.session_state.auto_run = doc.id  # extract and categorize a new statement right away
        st.session_state.last_upload = digest
        st.session_state.viewer_doc = doc.id

docs = {d.id: d for d in library.documents()}
if not docs:
    st.stop()
if st.session_state.get("viewer_doc") not in docs:
    st.session_state.viewer_doc = next(iter(docs))
doc = docs[
    st.selectbox(
        "Document",
        list(docs),
        key="viewer_doc",
        format_func=lambda i: f"{docs[i].name} · {docs[i].page_count} pages · added {docs[i].added[:10]}",
    )
]

results = load_results(doc.id, library.transcribed_pages(doc))
errors = {n: msg for (d, n), msg in st.session_state.page_errors.items() if d == doc.id and n not in results}
todo = [n for n in range(1, doc.page_count + 1) if n not in results]

# --- Run the pipeline -------------------------------------------------------

has_credentials = credentials_notice()
with st.container(horizontal=True, vertical_alignment="center"):
    run = st.button(
        f"Analyse {len(todo)} page{'s' if len(todo) != 1 else ''}"
        if len(todo) < doc.page_count
        else f"Analyse all {doc.page_count} pages",
        icon=":material/play_arrow:",
        type="primary",
        disabled=not todo or not has_credentials,
    )
    if (markdown := library.markdown(doc)) is not None:
        st.download_button(
            "Download transcription (Markdown)",
            markdown,
            file_name=f"{doc.name.removesuffix('.pdf')}.md",
            mime="text/markdown",
            icon=":material/download:",
        )

class CategorizeSkipped(Exception):
    pass


def categorize(client: anthropic.Anthropic, doc: StoredDocument) -> None:
    """Add a fully transcribed statement to the budget, with the same workbook the Budget categories page uses."""
    if (found := budget_workbook()) is None:
        raise CategorizeSkipped(f"No budget workbook found at {DEFAULT_WORKBOOK}.")
    workbook, workbook_name = found
    try:
        setup = budget_setup(workbook)
    except RulesError as e:
        raise CategorizeSkipped(f"Problem with the Vendor Rules tab: {e}") from e
    except (KeyError, StopIteration) as e:
        raise CategorizeSkipped(f"Couldn't read the budget workbook: {e}") from e
    library.save_budget(doc, budget_record(categorize_statement(client, library.markdown(doc), setup), workbook_name))


auto_run = st.session_state.get("auto_run") == doc.id and has_credentials
if auto_run:
    del st.session_state.auto_run
if run or auto_run:
    client = get_client()
    with st.status(f"Processing {doc.name}", expanded=True) as status:
        if todo:
            st.write(f"Extracting text from {len(todo)} page{'s' if len(todo) != 1 else ''}")
            progress = st.progress(0.0)
            with ThreadPoolExecutor(max_workers=DEFAULT_CONCURRENCY) as pool:
                futures = {pool.submit(process_page, client, library.page_image(doc, n)): n for n in todo}
                for finished, future in enumerate(as_completed(futures), start=1):
                    page_number = futures[future]
                    try:
                        library.save_page_result(doc, future.result())
                        st.session_state.page_errors.pop((doc.id, page_number), None)
                    except (ExtractionError, anthropic.APIError) as e:
                        st.session_state.page_errors[(doc.id, page_number)] = str(e)
                    progress.progress(finished / len(todo), text=f"Extracted {finished} of {len(todo)} pages")

        if library.markdown(doc) is None:
            notice = ("error", "Some pages failed, so the statement wasn't added to your budget. Run the analysis again.")
        elif library.budget(doc) is not None:
            notice = ("success", "Extraction finished. This statement was already in your budget categories.")
        else:
            st.write("Adding the transactions to your budget categories")
            try:
                categorize(client, doc)
                notice = ("success", "Extracted and added to your budget categories.")
            except CategorizeSkipped as e:
                notice = ("warning", f"Extracted, but not categorized. {e}")
            except (ExtractionError, anthropic.APIError) as e:
                notice = ("warning", f"Extracted, but categorizing failed: {e}")
        status.update(label=f"{doc.name}: {notice[1]}", state="error" if notice[0] == "error" else "complete")
    st.session_state.viewer_notice = (doc.id, *notice)
    st.rerun()

if (notice := st.session_state.get("viewer_notice")) and notice[0] == doc.id:
    del st.session_state.viewer_notice
    _, kind, message = notice
    with st.container(horizontal=True, vertical_alignment="center"):
        getattr(st, kind)(message)
        if library.budget(doc) is not None:
            st.page_link("app_pages/categorize.py", label="Open budget categories", icon=":material/category:")

# --- Page viewer ------------------------------------------------------------

if doc.page_count > 1:
    page_number = st.select_slider("Page", options=range(1, doc.page_count + 1), key=f"page_{doc.id}")
else:
    page_number = 1
page = library.page_image(doc, page_number)
result = results.get(page_number)

if page_number in errors:
    st.error(errors[page_number], title=f"Page {page_number} failed. Run the analysis again to retry it.")
if result is None:
    st.image(page.data, caption=f"Page {page_number} ({page.width}x{page.height} px)", alt=f"Page {page_number}")
    st.stop()

layout, transcription = result.layout.output, result.transcription.output
regions = sorted(layout.regions, key=lambda r: r.reading_order)
texts = {t.region_id: t for t in transcription.regions}

# The region table sits below the image, but its selection drives the overlay, so read it first.
table_key = f"regions_{doc.id}_{page_number}"
selected_rows = st.session_state[table_key].selection.rows if table_key in st.session_state else []
selected = regions[selected_rows[0]] if selected_rows else None

image_col, text_col = st.columns(2, gap="medium")

with image_col:
    view = st.segmented_control(
        "Image", ["Layout", "Original"], default="Layout", required=True, key="image_view", label_visibility="collapsed"
    )
    if view == "Layout":
        st.image(
            draw_layout(page, layout, highlight=selected.id if selected else None),
            alt=f"Page {page_number} with {len(regions)} detected layout regions outlined",
        )
    else:
        st.image(page.data, alt=f"Page {page_number}")

with text_col:
    text_view = st.segmented_control(
        "Text", ["Rendered", "Markdown"], default="Rendered", required=True, key="text_view", label_visibility="collapsed"
    )
    if selected:
        region_text = texts.get(selected.id)
        markdown = region_text.markdown if region_text else ""
        st.caption(f"Region {selected.reading_order} ({selected.type}). Clear the row selection to see the whole page.")
    else:
        markdown = result.markdown
    with st.container(border=True):
        if not markdown.strip():
            st.caption("No text transcribed.")
        elif text_view == "Rendered":
            st.markdown(escape_math(markdown))
        else:
            st.code(markdown, language="markdown", wrap_lines=True)

    illegible = [r.reading_order for r in regions if r.id in texts and not texts[r.id].legible]
    if illegible:
        st.warning(f"Claude couldn't read every part of region(s) {', '.join(map(str, illegible))} with confidence.")
    missing = [r.reading_order for r in regions if r.id not in texts]
    if missing:
        st.warning(f"No transcription returned for region(s) {', '.join(map(str, missing))}.")
    if transcription.missed_content:
        st.info("Text outside every layout region was added at the end of the page.")

# --- Layout details ---------------------------------------------------------

st.subheader("Layout regions")
st.caption(
    f"{len(regions)} regions · {layout.column_count} column(s) · language {layout.language or 'unknown'} · "
    f"rotation {layout.rotation}°. Select a row to highlight the region."
)
st.dataframe(
    pd.DataFrame(
        [
            {
                "order": r.reading_order,
                "type": r.type,
                "description": r.description,
                "columns": ", ".join(r.table_columns or []),
                "legible": texts[r.id].legible if r.id in texts else None,
                "bbox": str(r.bbox),
            }
            for r in regions
        ]
    ),
    key=table_key,
    on_select="rerun",
    selection_mode="single-row",
    hide_index=True,
    alt=f"Layout regions detected on page {page_number}",
    column_config={
        "order": st.column_config.NumberColumn("Order", width="small"),
        "type": "Type",
        "description": st.column_config.TextColumn("Description", width="large"),
        "columns": "Table columns",
        "legible": st.column_config.CheckboxColumn("Legible", width="small"),
        "bbox": "Box (px)",
    },
)
if layout.notes:
    st.caption(f"Layout notes: {layout.notes}")

st.caption(
    f"Model {result.layout.model} · layout: {result.layout.input_tokens + result.layout.cache_write_tokens:,} in / "
    f"{result.layout.output_tokens:,} out · transcription: {result.transcription.input_tokens:,} in "
    f"({result.transcription.cache_read_tokens:,} read from cache) / {result.transcription.output_tokens:,} out"
)
