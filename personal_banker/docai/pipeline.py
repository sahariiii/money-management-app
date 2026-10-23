"""Orchestrates the per-page passes: render -> (layout -> transcription) for each page."""

from collections.abc import Callable
from dataclasses import dataclass

import anthropic
import braintrust
from braintrust import TracedThreadPoolExecutor

from ..llm import CallResult
from .agents import analyse_page_layout, transcribe_page
from .render import PageImage, render_pdf
from .schemas import PageLayout, PageTranscription

# Pages are independent, so several run at once; each page's two calls stay
# sequential because the second needs the first's layout.
DEFAULT_CONCURRENCY = 4


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
    braintrust.current_span().log(metadata={"page_number": page.page_number})
    layout = analyse_page_layout(client, page)
    transcription = transcribe_page(client, page, layout.output)
    return PageResult(page, layout, transcription)


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
