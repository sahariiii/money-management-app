"""Local PaddleOCR-VL engine: one model run per page, mapped onto the same layout and
transcription schemas the Claude passes produce, so the library and viewer treat both alike.

Needs the optional dependencies: uv sync --extra paddle
"""

import functools
import glob
import importlib.util
import io
import os
import re
import sysconfig
import threading
import time
from html.parser import HTMLParser

import braintrust
import numpy as np
from PIL import Image

from ..llm import CallResult, ExtractionError
from .render import PageImage
from .schemas import PageLayout, PageTranscription, Region, RegionTranscription, RegionType

MODEL = "PaddleOCR-VL-1.6"
PIPELINE_VERSION = "v1.6"

# PP-DocLayoutV3 labels -> the region types the Claude layout pass uses.
REGION_TYPES: dict[str, RegionType] = {
    "doc_title": "title",
    "paragraph_title": "heading",
    "figure_title": "heading",
    "text": "paragraph",
    "content": "paragraph",
    "abstract": "paragraph",
    "reference": "paragraph",
    "reference_content": "paragraph",
    "vertical_text": "paragraph",
    "table": "table",
    "header": "page_header",
    "footer": "page_footer",
    "number": "page_footer",
    "header_image": "logo",
    "footer_image": "logo",
    "image": "figure",
    "chart": "figure",
    "seal": "stamp",
}
# Picture blocks come back as an <img> tag pointing at a crop; show a placeholder instead.
PICTURE_LABELS = {"image", "chart", "header_image", "footer_image"}

# One model on one GPU: pages run one at a time, and the pipeline loads once per process.
_lock = threading.Lock()
_pipeline = None


def is_available() -> bool:
    return importlib.util.find_spec("paddleocr") is not None


@functools.cache
def _add_cuda_dlls() -> None:
    """On Windows, paddlepaddle-gpu loads cuDNN/cuBLAS by name from PATH; the nvidia-* wheels put them here."""
    if os.name != "nt":
        return
    bins = glob.glob(os.path.join(sysconfig.get_paths()["purelib"], "nvidia", "*", "bin"))
    os.environ["PATH"] = os.pathsep.join([*bins, os.environ.get("PATH", "")])


def _enable_dynamic_mode() -> None:
    """Switch Paddle to dynamic-graph mode in the calling thread.

    Paddle keeps this mode per thread, and a new thread starts from a process-wide
    default that an earlier run can leave switched off. Both loading the model and
    predict() (which starts its own worker threads) need it on; without it, loading
    fails with "Place(undefined:0)" and predicting with "int(Tensor) is not
    supported in static graph mode". Each Streamlit run is a new thread, so this
    runs before every page.
    """
    if not is_available():
        raise ExtractionError("PaddleOCR-VL isn't installed. Run: uv sync --extra paddle")
    _add_cuda_dlls()
    import paddle

    paddle.disable_static()


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        from paddleocr import PaddleOCRVL

        # format_block_content turns titles into Markdown headings and tables into HTML.
        _pipeline = PaddleOCRVL(pipeline_version=PIPELINE_VERSION, format_block_content=True)
    return _pipeline


class _TableParser(HTMLParser):
    """Collects an HTML table's cells row by row. A colspan cell is padded with empty
    cells; a rowspan cell only appears in its first row."""

    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._cell: list[str] | None = None
        self._span = 1

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.rows.append([])
        elif tag in ("td", "th"):
            self._cell = []
            span = dict(attrs).get("colspan") or "1"
            self._span = int(span) if span.isdigit() else 1

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None:
            if not self.rows:
                self.rows.append([])
            text = " ".join("".join(self._cell).split()).replace("|", r"\|")
            self.rows[-1].extend([text] + [""] * (self._span - 1))
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _html_table_to_markdown(html: str) -> tuple[str, list[str] | None]:
    """Returns the table as Markdown plus its header row; falls back to the raw text if it isn't a table."""
    parser = _TableParser()
    parser.feed(html)
    rows = [r for r in parser.rows if r]
    if not rows:
        return _strip_tags(html), None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = [f"| {' | '.join(rows[0])} |", f"|{' --- |' * width}"]
    lines += [f"| {' | '.join(r)} |" for r in rows[1:]]
    return "\n".join(lines), rows[0]


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def _block_markdown(label: str, content: str) -> tuple[str, list[str] | None]:
    if label == "table":
        return _html_table_to_markdown(content)
    if label in PICTURE_LABELS:
        return f"[{label.replace('_', ' ')}]", None
    if label == "seal":
        return f"[stamp] {_strip_tags(content)}".strip(), None
    return _strip_tags(content), None


def to_schemas(blocks: list[dict]) -> tuple[PageLayout, PageTranscription]:
    """Map PaddleOCR-VL's parsing_res_list (already in reading order) onto the shared schemas."""
    regions, texts = [], []
    for order, block in enumerate(blocks, start=1):
        label = block["block_label"]
        markdown, columns = _block_markdown(label, block.get("block_content") or "")
        region_id = f"r{order}"
        regions.append(
            Region(
                id=region_id,
                type=REGION_TYPES.get(label, "other"),
                bbox=[int(v) for v in block["block_bbox"]],
                reading_order=order,
                description=f"PaddleOCR-VL block: {label}",
                table_columns=columns,
            )
        )
        # PaddleOCR-VL gives no per-block confidence, so every block counts as legible.
        texts.append(RegionTranscription(region_id=region_id, markdown=markdown, legible=True))
    layout = PageLayout(
        rotation=0,
        column_count=1,
        language=None,
        regions=regions,
        notes="Produced by PaddleOCR-VL, which doesn't report rotation, column count or language.",
    )
    return layout, PageTranscription(regions=texts, missed_content=None)


@braintrust.traced(name="paddleocr_vl_page", notrace_io=True)
def process_page(page: PageImage):
    from .pipeline import PageResult  # pipeline imports this module lazily

    span = braintrust.current_span()
    span.log(metadata={"engine": "paddleocr-vl", "model": MODEL, "page_number": page.page_number})
    image = np.array(Image.open(io.BytesIO(page.data)).convert("RGB"))[:, :, ::-1]  # PaddleOCR wants BGR
    # A local model has no token usage, so time is its cost: waiting for the GPU,
    # loading the model (first page of a process only), then the prediction itself.
    metrics = {}
    started = time.perf_counter()
    with _lock:
        metrics["queue_seconds"] = time.perf_counter() - started
        _enable_dynamic_mode()
        try:
            if _pipeline is None:
                loading = time.perf_counter()
                _get_pipeline()
                metrics["model_load_seconds"] = time.perf_counter() - loading
            predicting = time.perf_counter()
            result = next(iter(_get_pipeline().predict(image)))
            metrics["predict_seconds"] = time.perf_counter() - predicting
        except Exception as e:  # Paddle raises bare RuntimeErrors/TypeErrors for CUDA and model failures
            raise ExtractionError(f"PaddleOCR-VL failed on page {page.page_number}: {e}") from e
    blocks = result.json["res"]["parsing_res_list"]
    layout, transcription = to_schemas(blocks)
    metrics["regions"] = len(layout.regions)
    metrics["tables"] = sum(b["block_label"] == "table" for b in blocks)
    span.log(metrics=metrics, metadata={"block_labels": [b["block_label"] for b in blocks]})
    # Same CallResult wrapper as the Claude passes; a local model has no token usage.
    return PageResult(
        page,
        CallResult(layout, MODEL, 0, 0, 0, 0),
        CallResult(transcription, MODEL, 0, 0, 0, 0),
    )
