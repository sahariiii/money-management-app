"""Orchestrates the agents: prepare PDF -> layout pass -> text pass -> reconciliation."""

import io
from collections.abc import Callable
from dataclasses import dataclass

import anthropic
import braintrust
from pypdf import PdfReader, PdfWriter
from pypdf.errors import DependencyError

from .agents import analyse_layout, extract_text
from .llm import CallResult
from .reconcile import Reconciliation, reconcile
from .schemas import StatementData, StatementLayout

MAX_PAGES = 600
# Request limit is 32 MB and base64 adds a third, so keep the raw PDF under 24 MB.
MAX_BYTES = 24 * 1024 * 1024


class StatementError(ValueError):
    pass


class PasswordRequired(StatementError):
    pass


@dataclass
class PipelineResult:
    layout: CallResult[StatementLayout]
    data: CallResult[StatementData]
    reconciliation: Reconciliation


def prepare_pdf(pdf_bytes: bytes, password: str | None = None) -> bytes:
    """Validate the upload and return an unencrypted copy Claude can read."""
    if len(pdf_bytes) > MAX_BYTES:
        raise StatementError("PDF is larger than 24 MB.")
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        raise StatementError(f"Not a readable PDF: {e}") from e

    if reader.is_encrypted:
        # Many statements are encrypted only to restrict printing/copying and
        # open with an empty password; only ask the user when that fails.
        try:
            if not reader.decrypt(""):
                if not password:
                    raise PasswordRequired("This statement is password-protected.")
                if not reader.decrypt(password):
                    raise PasswordRequired("Incorrect password for this statement.")
        except DependencyError as e:
            raise StatementError(f"Can't decrypt this PDF: {e}") from e
        writer = PdfWriter(clone_from=reader)
        out = io.BytesIO()
        writer.write(out)
        pdf_bytes = out.getvalue()

    if len(reader.pages) > MAX_PAGES:
        raise StatementError(f"PDF has {len(reader.pages)} pages; the limit is {MAX_PAGES}.")
    return pdf_bytes


@braintrust.traced(notrace_io=True)
def process_statement(
    client: anthropic.Anthropic,
    pdf_bytes: bytes,
    on_stage: Callable[[str], None] = lambda _: None,
) -> PipelineResult:
    on_stage("Pass 1: analysing layout")
    layout = analyse_layout(client, pdf_bytes)

    on_stage("Pass 2: extracting transactions")
    data = extract_text(client, pdf_bytes, layout.output)

    on_stage("Reconciling balances")
    result = reconcile(data.output, layout.output)
    braintrust.current_span().log(
        output={
            "transactions": len(data.output.transactions),
            "reconciled": result.ok,
            "closing_matches": result.closing_matches,
            "running_balance_breaks": result.running_balance_breaks,
        },
        scores={"reconciled": float(result.ok)},
    )
    return PipelineResult(layout, data, result)
