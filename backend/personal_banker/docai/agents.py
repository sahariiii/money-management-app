"""The two per-page agents: layout first, then transcription guided by that layout."""

import anthropic
import braintrust

from ..llm import CallResult, image_block, run_structured
from .render import PageImage
from .schemas import PageLayout, PageTranscription

# Identical for both passes so the cached prefix (system + page image) is shared.
SYSTEM_PROMPT = """\
You are part of a document understanding pipeline. Each request gives you one \
page of a document as an image, followed by the task for your stage of the \
pipeline.

Be exact: reproduce what is printed, character for character. Never correct, \
summarise, round or invent text. If something is unreadable, say so rather \
than guessing."""

LAYOUT_INSTRUCTIONS = """\
Stage 1 of 2: layout analysis of page {page_number}. Do not transcribe the text yet.

The image is {width}x{height} pixels. Split the page into regions a reader \
would treat as units (a heading, a paragraph, a whole table, a block of \
label/value pairs, a header or footer line, a logo) and give each one a tight \
bounding box in those pixel coordinates. Number the regions in the order a \
person would read them; for multi-column text, finish one column before the \
next. Keep each table as one region and list its column headers."""

TRANSCRIPTION_TEMPLATE = """\
Stage 2 of 2: transcription of page {page_number}. A first pass produced this \
layout of the page (bounding boxes are pixels in this {width}x{height} image):

<layout>
{layout_json}
</layout>

Transcribe each region in reading order:
- copy text verbatim, keeping numbers, signs, currency symbols and dates \
exactly as printed;
- tables as Markdown tables with the printed headers; keep one row per printed \
row, and join a cell's wrapped lines with a space;
- label/value blocks as '**Label:** value' lines;
- for logos, figures, stamps and signatures, give a short description in \
square brackets, plus any text they contain.
If the layout is wrong (a merged or missed region, a bad box), follow the \
page, and put any text that fits no region in missed_content."""


def _page_content(page: PageImage, instructions: str) -> list[dict]:
    return [image_block(page.data, page.media_type), {"type": "text", "text": instructions}]


@braintrust.traced(notrace_io=True)
def analyse_page_layout(client: anthropic.Anthropic, page: PageImage) -> CallResult[PageLayout]:
    instructions = LAYOUT_INSTRUCTIONS.format(page_number=page.page_number, width=page.width, height=page.height)
    return run_structured(client, SYSTEM_PROMPT, _page_content(page, instructions), PageLayout)


@braintrust.traced(notrace_io=True)
def transcribe_page(
    client: anthropic.Anthropic, page: PageImage, layout: PageLayout
) -> CallResult[PageTranscription]:
    instructions = TRANSCRIPTION_TEMPLATE.format(
        page_number=page.page_number,
        width=page.width,
        height=page.height,
        layout_json=layout.model_dump_json(indent=2),
    )
    return run_structured(client, SYSTEM_PROMPT, _page_content(page, instructions), PageTranscription)
