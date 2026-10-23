"""Orchestrates the per-page passes: render -> (layout -> transcription) for each page."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import anthropic
import braintrust
from braintrust import TracedThreadPoolExecutor

from ..llm import CallResult, init_tracing
from .agents import analyse_page_layout, transcribe_page
from .render import PageImage, render_pdf
from .schemas import PageLayout, PageTranscription

# Pages are independent, so several run at once; each page's two calls stay
# sequential because the second needs the first's layout.
DEFAULT_CONCURRENCY = 4

# "claude": the two Claude passes below. "paddleocr-vl": the local model in paddle.py.
Engine = Literal["claude", "paddleocr-vl"]
ENGINE_LABELS: dict[Engine, str] = {"claude": "Claude", "paddleocr-vl": "PaddleOCR-VL (local)"}

# The engine the app, the CLI and the library use. Change it here to switch;
# "paddleocr-vl" needs `uv sync --extra paddle`.
EXTRACTION_ENGINE: Engine = "paddleocr-vl"


@dataclass
class PageResult:
    image: PageImage
    layout: CallResult[PageLayout]
    transcription: CallResult[PageTranscription]

    @property
    def markdown(self) -> str:
        order = {r.id: r.reading_order for r in self.layout.output.regions}
        regions = sorted(self.transcription.output.regions, key=lambda r: order.get(r.region_id, len(order) + 1))
        parts = [r.markdown for r in regions if r.markdown.strip()]
        if self.transcription.output.missed_content:
            parts.append(self.transcription.output.missed_content)
        return "\n\n".join(parts)


@dataclass
class DocumentResult:
    pages: list[PageResult]

    @property
    def markdown(self) -> str:
        return "\n\n".join(f"<!-- page {p.image.page_number} -->\n\n{p.markdown}" for p in self.pages)


@braintrust.traced(notrace_io=True)
def process_page(client: anthropic.Anthropic, page: PageImage) -> PageResult:
    braintrust.current_span().log(metadata={"engine": "claude", "page_number": page.page_number})
    layout = analyse_page_layout(client, page)
    transcription = transcribe_page(client, page, layout.output)
    return PageResult(page, layout, transcription)


def extract_page(engine: Engine, client: anthropic.Anthropic | None, page: PageImage) -> PageResult:
    """Run one page through `engine`; `client` is only used (and required) for Claude."""
    if engine == "paddleocr-vl":
        from . import paddle  # imported lazily: the Paddle stack is an optional extra

        init_tracing()  # Claude runs start it in make_client; this engine has no client
        return paddle.process_page(page)
    return process_page(client, page)


def engine_concurrency(engine: Engine) -> int:
    # The local model serialises pages on the GPU, so extra threads would only wait.
    return 1 if engine == "paddleocr-vl" else DEFAULT_CONCURRENCY


@braintrust.traced(notrace_io=True)
def understand_document(
    client: anthropic.Anthropic,
    pdf_bytes: bytes,
    on_page: Callable[[PageResult], None] = lambda _: None,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> DocumentResult:
    """`pdf_bytes` must already be decrypted (see personal_banker.pipeline.prepare_pdf)."""
    images = render_pdf(pdf_bytes)
    braintrust.current_span().log(metadata={"pages": len(images)})

    def run(page: PageImage) -> PageResult:
        result = process_page(client, page)
        on_page(result)
        return result

    # The traced pool carries the current span into the workers, so each page's
    # spans nest under this document's trace.
    with TracedThreadPoolExecutor(max_workers=concurrency) as pool:
        # map() preserves page order even though pages finish out of order.
        return DocumentResult(list(pool.map(run, images)))
