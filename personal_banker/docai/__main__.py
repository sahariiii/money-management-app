"""Run the document pipeline on a PDF and save the results in the local library.

    uv run python -m personal_banker.docai statement.pdf

Pages already transcribed are skipped, so re-running finishes an interrupted document.
"""

import argparse
import getpass
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from ..llm import make_client
from ..pipeline import PasswordRequired, prepare_pdf
from ..store import DEFAULT_ROOT, Library
from .pipeline import DEFAULT_CONCURRENCY, process_page
from .render import render_pdf


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="Library folder (default: %(default)s).")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Pages processed in parallel.")
    args = parser.parse_args()

    library = Library(args.library)
    raw = args.pdf.read_bytes()
    try:
        pdf = prepare_pdf(raw)
    except PasswordRequired:
        pdf = prepare_pdf(raw, getpass.getpass("PDF password: "))
    doc = library.add(args.pdf.name, raw, render_pdf(pdf))

    done = library.page_results(doc)
    todo = [library.page_image(doc, n) for n in range(1, doc.page_count + 1) if n not in done]
    client = make_client()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(process_page, client, page) for page in todo]
        for future in as_completed(futures):
            result = future.result()
            library.save_page_result(doc, result)
            print(
                f"page {result.image.page_number}: {len(result.layout.output.regions)} regions; "
                f"transcription read {result.transcription.cache_read_tokens:,} tokens from cache"
            )

    print(f"Saved to {library.root / doc.id}")


if __name__ == "__main__":
    main()
