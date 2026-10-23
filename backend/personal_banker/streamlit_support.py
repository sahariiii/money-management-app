"""Streamlit helpers shared by the app's pages."""

import os

import anthropic
import streamlit as st

from .categorize import BudgetSetup, load_budget_setup
from .llm import make_client
from .store import Library


@st.cache_resource
def get_library() -> Library:
    return Library()


@st.cache_resource
def get_client() -> anthropic.Anthropic:
    try:
        api_key = st.secrets.get("ANTHROPIC_API_KEY")
    except FileNotFoundError:
        api_key = None
    # Falls back to ANTHROPIC_API_KEY in the environment (or .env) when no secret is set.
    return make_client(api_key)


@st.cache_data(max_entries=4)
def budget_setup(workbook: bytes) -> BudgetSetup:
    return load_budget_setup(workbook)


def has_credentials() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    try:
        return "ANTHROPIC_API_KEY" in st.secrets
    except FileNotFoundError:
        return False


def credentials_notice() -> bool:
    """Show a hint when no API key is configured; returns whether one is."""
    if has_credentials():
        return True
    st.info(
        "Set ANTHROPIC_API_KEY in your environment or in .streamlit/secrets.toml.",
        title="No Anthropic API key found",
    )
    return False
