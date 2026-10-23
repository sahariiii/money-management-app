"""Run the document pipeline on a PDF and save the results in the local library.

    uv run python -m personal_banker.docai statement.pdf
    uv run --extra paddle python -m personal_banker.docai statement.pdf --engine paddleocr-vl

Pages already transcribed are skipped, so re-running finishes an interrupted document.
"""

import argparse
import getpass
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import get_args

from ..llm import make_client
from ..pipeline import PasswordRequired, prepare_pdf
from ..store import DEFAULT_ROOT, Library
from .pipeline import EXTRACTION_ENGINE, Engine, engine_concurrency, extract_page
from .render import render_pdf


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--library", type=Path, default=DEFAULT_ROOT, help="Library folder (default: %(default)s).")
    parser.add_argument("--engine", choices=get_args(Engine), default=EXTRACTION_ENGINE, help="Extraction engine (default: %(default)s, set by EXTRACTION_ENGINE in docai/pipeline.py).")
    parser.add_argument("--concurrency", type=int, help="Pages processed in parallel (default: 4 for Claude, 1 for PaddleOCR-VL).")
    args = parser.parse_args()

    library = Library(args.library)
    raw = args.pdf.read_bytes()
    try:
        pdf = prepare_pdf(raw)
    except PasswordRequired:
        pdf = prepare_pdf(raw, getpass.getpass("PDF password: "))
    doc = library.add(args.pdf.name, raw, render_pdf(pdf))

    done = library.page_results(doc, args.engine)
    todo = [library.page_image(doc, n) for n in range(1, doc.page_count + 1) if n not in done]
    client = make_client() if args.engine == "claude" else None
    with ThreadPoolExecutor(max_workers=args.concurrency or engine_concurrency(args.engine)) as pool:
        futures = [pool.submit(extract_page, args.engine, client, page) for page in todo]
        for future in as_completed(futures):
            result = future.result()
            library.save_page_result(doc, result, args.engine)
            line = f"page {result.image.page_number}: {len(result.layout.output.regions)} regions"
            if args.engine == "claude":
                line += f"; transcription read {result.transcription.cache_read_tokens:,} tokens from cache"
            print(line)

    print(f"Saved to {library.root / doc.id}")


if __name__ == "__main__":
    main()
