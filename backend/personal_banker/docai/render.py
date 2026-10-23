"""Rasterise PDF pages into images Claude can read."""

import io
from dataclasses import dataclass

import pypdfium2 as pdfium

# Long edge of each rendered page. High enough that small print (statement
# footers, table cells) stays legible, low enough to stay well under the
# 8000 px per-side image limit.
TARGET_LONG_EDGE = 2000
# The API rejects images over 5 MB once base64-encoded; stay under it raw.
MAX_IMAGE_BYTES = 3_750_000


@dataclass
class PageImage:
    page_number: int  # 1-indexed
    data: bytes
    media_type: str
    width: int
    height: int


def _encode(image) -> tuple[bytes, str]:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    if buf.tell() <= MAX_IMAGE_BYTES:
        return buf.getvalue(), "image/png"
    # Photo-heavy pages can make huge PNGs; JPEG keeps them under the limit.
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue(), "image/jpeg"


def render_pdf(pdf_bytes: bytes, long_edge: int = TARGET_LONG_EDGE) -> list[PageImage]:
    """Render every page; `pdf_bytes` must already be decrypted (see pipeline.prepare_pdf)."""
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        pages: list[PageImage] = []
        for index in range(len(pdf)):
            page = pdf[index]
            # Page size is in points (1/72 inch); scale so the long edge hits the target.
            scale = long_edge / max(page.get_width(), page.get_height())
            image = page.render(scale=scale).to_pil()
            data, media_type = _encode(image)
            pages.append(PageImage(index + 1, data, media_type, image.width, image.height))
            page.close()
        return pages
    finally:
        pdf.close()
