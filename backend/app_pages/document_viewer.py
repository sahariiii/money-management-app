import hashlib
import itertools

import pandas as pd
import streamlit as st

from personal_banker.docai import PageResult, render_pdf
from personal_banker.docai import paddle
from personal_banker.docai.pipeline import ENGINE_LABELS, EXTRACTION_ENGINE, Engine
from personal_banker.docai.visualize import draw_layout
from personal_banker.llm import start_trace
from personal_banker.pipeline import PasswordRequired, StatementError, prepare_pdf
from personal_banker.service import process_document
from personal_banker.store import Library
from personal_banker.streamlit_support import (
    budget_setup,
    credentials_notice,
    get_client,
    get_library,
    get_store,
    has_credentials,
)


@st.cache_data(max_entries=8)
def load_results(doc_id: str, engine: Engine, transcribed: int) -> dict[int, PageResult]:
    # `transcribed` is part of the cache key, so the cache refreshes whenever a page is added.
    library = get_library()
    return library.page_results(library.get(doc_id), engine)


def escape_math(markdown: str) -> str:
    # st.markdown treats $...$ as LaTeX, which mangles currency amounts.
    return markdown.replace("$", r"\$")


library: Library = get_library()
if "page_errors" not in st.session_state:
    st.session_state.page_errors = {}  # (document id, page number) -> error message from the last run

st.title("Document viewer")
if EXTRACTION_ENGINE == "claude":
    how = "Claude detects its layout, then transcribes it using that layout"
else:
    how = "PaddleOCR-VL detects its layout and transcribes it locally on your GPU"
st.caption(f"Each page is rendered to an image, then {how}. Everything is saved under {library.root}/.")

# --- Add a document -----------------------------------------------------------

upload = st.file_uploader("Add a document (PDF)", type="pdf")
# One Braintrust trace per statement: rendering the upload, every page's extraction and
# the categorization nest under it, so its duration and cost cover the whole run.
trace = None
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
            # Started after any password prompt, so time spent typing it isn't counted.
            trace = start_trace("statement", input={"file": upload.name, "bytes": len(raw)})
            with trace.start_span(name="render_and_save") as span, st.spinner("Rendering pages"):
                doc = library.add(upload.name, raw, render_pdf(pdf))
                span.log(metrics={"pages": doc.page_count})
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

engine: Engine = EXTRACTION_ENGINE

results = load_results(doc.id, engine, library.transcribed_pages(doc, engine))
errors = {n: msg for (d, e, n), msg in st.session_state.page_errors.items() if (d, e) == (doc.id, engine) and n not in results}
todo = [n for n in range(1, doc.page_count + 1) if n not in results]

# --- Run the pipeline -------------------------------------------------------

if engine == "claude":
    can_run = credentials_notice()
else:
    can_run = paddle.is_available()
    if not can_run:
        st.info("Install it with `uv sync --extra paddle`, then restart the app.", title="PaddleOCR-VL isn't installed")
    elif not has_credentials():
        st.caption("No Anthropic API key found: PaddleOCR-VL extraction works, but statements won't be categorized.")
with st.container(horizontal=True, vertical_alignment="center"):
    run = st.button(
        f"Analyse {len(todo)} page{'s' if len(todo) != 1 else ''}"
        if len(todo) < doc.page_count
        else f"Analyse all {doc.page_count} pages",
        icon=":material/play_arrow:",
        type="primary",
        disabled=not todo or not can_run,
    )
    if (markdown := library.markdown(doc, engine)) is not None:
        st.download_button(
            "Download transcription (Markdown)",
            markdown,
            file_name=f"{doc.name.removesuffix('.pdf')}{'' if engine == 'claude' else f'.{engine}'}.md",
            mime="text/markdown",
            icon=":material/download:",
        )

auto_run = st.session_state.get("auto_run") == doc.id and can_run
if auto_run:
    del st.session_state.auto_run
if run or auto_run:
    client = get_client() if has_credentials() else None
    # Pressing "Analyse" on a stored statement starts its own trace, without the upload step.
    if trace is None:
        trace = start_trace("statement", input={"file": doc.name})
    trace.log(metadata={"doc_id": doc.id, "engine": engine, "pages": doc.page_count, "auto_run": auto_run})
    with trace, st.status(f"Processing {doc.name}", expanded=True) as status:
        if todo:
            st.write(f"Extracting text from {len(todo)} page{'s' if len(todo) != 1 else ''} with {ENGINE_LABELS[engine]}")
            if engine == "paddleocr-vl":
                st.caption("The first page waits for the model to load; after that each page takes under a minute.")
            progress = st.progress(0.0)
        finished = itertools.count(1)

        def on_page(page_number: int, error: Exception | None) -> None:
            key = (doc.id, engine, page_number)
            if error is None:
                st.session_state.page_errors.pop(key, None)
            else:
                st.session_state.page_errors[key] = str(error)
            done = next(finished)
            progress.progress(done / len(todo), text=f"Extracted {done} of {len(todo)} pages")

        outcome = process_document(
            get_store(),
            doc,
            engine,
            client,
            on_page=on_page,
            on_categorize=lambda: st.write("Adding the transactions to your budget categories"),
            load=budget_setup,
        )
        trace.log(output={"result": outcome.kind, "message": outcome.message}, metrics={"failed_pages": outcome.failed_pages})
        status.update(label=f"{doc.name}: {outcome.message}", state="error" if outcome.kind == "error" else "complete")
    st.session_state.viewer_notice = (doc.id, outcome.kind, outcome.message)
    st.rerun()
elif trace is not None:
    # Uploaded, but the engine can't run here (e.g. Paddle isn't installed): close the trace.
    trace.log(output={"result": "not_run"})
    trace.end()

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
if engine == "claude":
    st.caption(
        f"{len(regions)} regions · {layout.column_count} column(s) · language {layout.language or 'unknown'} · "
        f"rotation {layout.rotation}°. Select a row to highlight the region."
    )
else:
    st.caption(f"{len(regions)} regions. Select a row to highlight the region.")
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
if engine == "claude":
    if layout.notes:
        st.caption(f"Layout notes: {layout.notes}")
    st.caption(
        f"Model {result.layout.model} · layout: {result.layout.input_tokens + result.layout.cache_write_tokens:,} in / "
        f"{result.layout.output_tokens:,} out · transcription: {result.transcription.input_tokens:,} in "
        f"({result.transcription.cache_read_tokens:,} read from cache) / {result.transcription.output_tokens:,} out"
    )
else:
    st.caption(f"Model {result.layout.model}, run locally. It gives no per-region confidence, so every region shows as legible.")
