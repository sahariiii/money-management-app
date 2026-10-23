"""Shared Claude call used by every agent in the pipeline."""

import base64
import os
from dataclasses import dataclass

import anthropic
import braintrust
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

BRAINTRUST_PROJECT = os.environ.get("BRAINTRUST_PROJECT", "Personal Banker")

MODEL = "claude-opus-5-5"
# Both passes must use the same effort: changing effort between requests
# invalidates the cached PDF prefix.
EFFORT = "medium"
MAX_TOKENS = 64000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

# Identical for every pass so the cached prefix (system + PDF) is shared.
SYSTEM_PROMPT = """\
You are part of a personal-finance pipeline that reads bank and credit-card \
e-statements. Each request gives you one statement as a PDF followed by the task \
for your stage of the pipeline.

Be exact: copy numbers and dates from the document; never estimate, round or \
invent values. If something is not printed on the statement, return null rather \
than guessing."""


class ExtractionError(RuntimeError):
    pass


def make_client(api_key: str | None = None) -> anthropic.Anthropic:
    """Client for every pipeline call. With no `api_key`, the SDK reads ANTHROPIC_API_KEY.

    Keys that aren't scoped to a workspace must name one on every request;
    set ANTHROPIC_WORKSPACE_ID for that.

    With BRAINTRUST_API_KEY set, every call is traced to the BRAINTRUST_PROJECT
    project; without it the plain client is returned and nothing is logged.
    """
    headers = {}
    if workspace_id := os.environ.get("ANTHROPIC_WORKSPACE_ID"):
        headers["anthropic-workspace-id"] = workspace_id
    client = anthropic.Anthropic(api_key=api_key, default_headers=headers)
    if not os.environ.get("BRAINTRUST_API_KEY"):
        return client
    braintrust.init_logger(project=BRAINTRUST_PROJECT)
    return braintrust.wrap_anthropic(client)


@dataclass
class CallResult[T]:
    output: T
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


def pdf_block(pdf_bytes: bytes) -> dict:
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(pdf_bytes).decode("ascii"),
        },
        # Breakpoint after the PDF: the second pass re-reads it from cache.
        "cache_control": {"type": "ephemeral"},
    }


def image_block(image_bytes: bytes, media_type: str) -> dict:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.standard_b64encode(image_bytes).decode("ascii"),
        },
        # Breakpoint after the image: the transcription pass re-reads it from cache.
        "cache_control": {"type": "ephemeral"},
    }


def run_on_pdf[T: BaseModel](
    client: anthropic.Anthropic,
    pdf_bytes: bytes,
    instructions: str,
    output_model: type[T],
) -> CallResult[T]:
    content = [pdf_block(pdf_bytes), {"type": "text", "text": instructions}]
    return run_structured(client, SYSTEM_PROMPT, content, output_model)


def run_structured[T: BaseModel](
    client: anthropic.Anthropic,
    system: str | list[dict],
    content: list[dict],
    output_model: type[T],
) -> CallResult[T]:
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": EFFORT},
        system=system,
        messages=[{"role": "user", "content": content}],
        output_format=output_model,
    ) as stream:
        # Drain the events through the stream itself before asking for the final
        # message: the Braintrust wrapper records the response from these events,
        # and get_final_message() alone would read them past it.
        for _ in stream:
            pass
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        category = message.stop_details.category if message.stop_details else None
        raise ExtractionError(f"Claude declined to process this document (category: {category}).")
    if message.stop_reason == "max_tokens":
        raise ExtractionError("The response hit the output limit; the input may be too long for one pass.")
    if message.parsed_output is None:
        raise ExtractionError(f"No structured output returned (stop reason: {message.stop_reason}).")

    usage = message.usage
    return CallResult(
        output=message.parsed_output,
        model=message.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
        cache_write_tokens=usage.cache_creation_input_tokens or 0,
    )
