"""Deterministic categorization from the workbook's 'Vendor Rules' tab. No LLM."""

import re

from .workbook import VendorRule


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def match_rule(statement_description: str, rules: list[VendorRule]) -> VendorRule | None:
    """The rule whose Match text appears in the description; the longest match wins, then the earliest row."""
    description = _normalize(statement_description)
    best: VendorRule | None = None
    best_length = 0
    for rule in rules:
        match = _normalize(rule.match)
        if match and match in description and len(match) > best_length:
            best, best_length = rule, len(match)
    return best
