"""Reading a receipt photo with Claude: the merchant, date, amounts and the card it was paid with.

The photo is only sent to Claude, never saved. Matching the receipt to the ledger
and adding it as an expense live in ledger.py.
"""

import io
import re

import anthropic
import braintrust
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from .ledger import ExpenseCategory
from .llm import CallResult, image_block, run_structured

# Claude scales larger images down to this anyway, so sending more only costs upload time.
MAX_SIDE = 1568
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

INSTRUCTIONS = """\
You read shop and restaurant receipts for a personal budget. Each request gives \
you a photo of one receipt. Copy amounts and dates exactly as printed; never \
estimate. If the photo isn't a receipt, still fill the fields as best you can and \
say so in the merchant name."""


class ReceiptItem(BaseModel):
    description: str = Field(description="The line as printed, e.g. '2 x Margherita'.")
    amount: float = Field(description="The line's total as printed.")


class ReceiptData(BaseModel):
    merchant: str = Field(
        description="The shop or restaurant as people call it, e.g. 'Gusto 101', not the company's legal name."
    )
    date: str | None = Field(description="The purchase date as YYYY-MM-DD; null if not printed.")
    subtotal: float | None = Field(description="The amount before tax; null if not printed.")
    tax: float | None = Field(description="All tax together; null if not printed.")
    tax_label: str | None = Field(description="How the tax is labelled, e.g. 'HST 13%'; null if not printed.")
    total: float = Field(description="The amount paid, including tax and any tip.")
    currency: str = Field(description="ISO 4217 code; CAD when none is shown and the receipt looks Canadian.")
    items: list[ReceiptItem] = Field(description="The purchased items, in the order printed.")
    card_last4: str | None = Field(
        description="The last 4 digits of the payment card number printed on the receipt (e.g. from "
        "'MASTERCARD ************1234'). Exactly those 4 digits, never more; null if paid in cash or not printed."
    )
    category: ExpenseCategory = Field(
        description="The budget category the purchase belongs in. Car is for the user's car (repairs, parts, "
        "parking, car wash); fuel and EV charging are Gas & EV charging."
    )


class ReceiptError(ValueError):
    """The upload can't be read as an image."""


def prepare_image(raw: bytes) -> bytes:
    """The photo upright (phones store rotation separately), at most MAX_SIDE pixels, as JPEG."""
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except (UnidentifiedImageError, OSError) as e:
        raise ReceiptError("That file isn't a photo we can read. Use a JPEG or PNG image.") from e
    image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=85)
    return out.getvalue()


@braintrust.traced(notrace_io=True)
def read_receipt(client: anthropic.Anthropic, image_jpeg: bytes) -> CallResult[ReceiptData]:
    content = [image_block(image_jpeg, "image/jpeg"), {"type": "text", "text": "Read this receipt."}]
    return run_structured(client, INSTRUCTIONS, content, ReceiptData)


def last4(number: str | None) -> str | None:
    """At most the last 4 digits of a card number, whatever the model returned."""
    digits = re.sub(r"\D", "", number or "")
    return digits[-4:] if len(digits) >= 4 else None
