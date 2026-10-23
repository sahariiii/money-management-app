"""Structured outputs for the two per-page passes."""

from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pass 1: layout
# ---------------------------------------------------------------------------

RegionType = Literal[
    "title",
    "heading",
    "paragraph",
    "list",
    "table",
    "key_value",  # label/value pairs, e.g. "Account number: ...", "Statement date: ..."
    "page_header",
    "page_footer",
    "figure",
    "logo",
    "signature",
    "stamp",
    "barcode",
    "other",
]


class Region(BaseModel):
    id: str = Field(description="Short unique id on this page, e.g. 'r1', 'r2'.")
    type: RegionType
    bbox: list[int] = Field(
        description="[x0, y0, x1, y1] in pixels of the given image, origin top-left."
    )
    reading_order: int = Field(description="1-based position in natural reading order.")
    description: str = Field(
        description="What the region holds, e.g. 'transactions table, 5 columns: Date, Details, Out, In, Balance'."
    )
    table_columns: list[str] | None = Field(
        description="For tables only: column headers left to right as printed; null otherwise."
    )


class PageLayout(BaseModel):
    rotation: Literal[0, 90, 180, 270] = Field(
        description="Clockwise rotation needed to make the text upright; 0 if already upright."
    )
    column_count: int = Field(description="Number of text columns in the main body.")
    language: str | None = Field(description="Main language as an ISO 639-1 code.")
    regions: list[Region] = Field(description="Every content region on the page, ordered by reading_order.")
    notes: str = Field(description="Anything that will make transcription tricky: faint text, handwriting, overlaps.")


# ---------------------------------------------------------------------------
# Pass 2: transcription
# ---------------------------------------------------------------------------


class RegionTranscription(BaseModel):
    region_id: str = Field(description="Id of the layout region this text belongs to.")
    markdown: str = Field(
        description="Verbatim content as Markdown. Tables as Markdown tables; key/value pairs as '**Label:** value' lines."
    )
    legible: bool = Field(description="False if any part of the region could not be read with confidence.")


class PageTranscription(BaseModel):
    regions: list[RegionTranscription] = Field(description="One entry per layout region, in reading order.")
    missed_content: str | None = Field(
        description="Verbatim text that is on the page but in no layout region, or null."
    )
