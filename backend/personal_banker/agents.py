"""The two extraction agents: layout first, then text guided by that layout."""

import anthropic
import braintrust

from .llm import CallResult, run_on_pdf
from .schemas import StatementData, StatementLayout

LAYOUT_INSTRUCTIONS = """\
Stage 1 of 2: layout analysis. Do not extract the transactions yet.

Map how this statement is laid out so that a second pass can read it reliably:
- which bank issued it, whether it is a bank account or credit card, the page \
count and the currency;
- where the statement period and the opening/closing balances are printed;
- every transaction table: the pages it spans, its columns in order and what each \
holds, the date format, how money in and money out are distinguished, whether \
descriptions wrap onto several lines, and whether rows run oldest or newest first;
- regions that resemble transactions but must be skipped, such as balance \
brought/carried forward lines, subtotals, interest or fee summaries and adverts."""

EXTRACTION_TEMPLATE = """\
Stage 2 of 2: text extraction. A first pass produced this layout map of the \
statement:

<layout>
{layout_json}
</layout>

Using that map, extract the account details, the opening and closing balances, \
and every transaction row, in the order printed. Rules:
- dates as YYYY-MM-DD, inferring the year from the statement period when the \
row omits it;
- one signed amount per row: negative for money out or charges, positive for \
money in, payments or refunds;
- join wrapped description lines into one description;
- skip everything the layout lists under sections_to_ignore, including balance \
brought/carried forward rows;
- record only the last 4 digits of the account number.
If the layout map turns out to be wrong about something, follow the document."""


@braintrust.traced(notrace_io=True)
def analyse_layout(client: anthropic.Anthropic, pdf_bytes: bytes) -> CallResult[StatementLayout]:
    return run_on_pdf(client, pdf_bytes, LAYOUT_INSTRUCTIONS, StatementLayout)


@braintrust.traced(notrace_io=True)
def extract_text(
    client: anthropic.Anthropic, pdf_bytes: bytes, layout: StatementLayout
) -> CallResult[StatementData]:
    instructions = EXTRACTION_TEMPLATE.format(layout_json=layout.model_dump_json(indent=2))
    return run_on_pdf(client, pdf_bytes, instructions, StatementData)
