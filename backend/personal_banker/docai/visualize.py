"""Draw a page's detected layout over its image."""

import io

from PIL import Image, ImageDraw, ImageFont

from .render import PageImage
from .schemas import PageLayout

REGION_COLORS = {
    "title": "#d62728",
    "heading": "#ff7f0e",
    "paragraph": "#1f77b4",
    "list": "#17becf",
    "table": "#2ca02c",
    "key_value": "#9467bd",
    "page_header": "#8c564b",
    "page_footer": "#8c564b",
    "figure": "#e377c2",
    "logo": "#e377c2",
    "signature": "#bcbd22",
    "stamp": "#bcbd22",
    "barcode": "#7f7f7f",
    "other": "#7f7f7f",
}


def draw_layout(page: PageImage, layout: PageLayout, highlight: str | None = None) -> Image.Image:
    """Outline every region, labelled with its reading order and type.

    When `highlight` names a region id, that region is filled and the others are dimmed.
    """
    image = Image.open(io.BytesIO(page.data)).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.load_default(size=max(16, image.width // 55))
    line = max(2, image.width // 600)

    for region in layout.regions:
        if len(region.bbox) != 4:
            continue
        x0, y0, x1, y1 = region.bbox
        box = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        color = REGION_COLORS.get(region.type, "#7f7f7f")
        dimmed = highlight is not None and region.id != highlight
        if region.id == highlight:
            draw.rectangle(box, fill=color + "33")
        draw.rectangle(box, outline=color + ("55" if dimmed else "ff"), width=line * (2 if region.id == highlight else 1))
        label = f"{region.reading_order} {region.type}"
        left, top, right, bottom = draw.textbbox((box[0], box[1]), label, font=font)
        label_box = (left, top - (bottom - top) - 4, right + 6, top)
        draw.rectangle(label_box, fill=color + ("55" if dimmed else "ff"))
        draw.text((label_box[0] + 3, label_box[1] + 1), label, fill="white", font=font)

    return Image.alpha_composite(image, overlay).convert("RGB")
