"""Streamlit helpers shared by the app's pages.

Streamlit works on one user's data: PERSONAL_BANKER_LOCAL_USER, or the only user there is (datastore.local_user).
"""

import os

import anthropic
import streamlit as st

from .categorize import BudgetSetup, load_budget_setup
from .datastore import DataStore, Storage, local_user, open_storage
from .llm import make_client
from .store import Library


@st.cache_resource
def _storage() -> Storage:
    return open_storage()


@st.cache_resource
def _store(user_id: str) -> DataStore:
    return _storage().store(user_id)


def get_store() -> DataStore:
    try:
        user_id = local_user(_storage())
    except RuntimeError as e:
        st.error(str(e), title="Whose data?")
        st.stop()
    return _store(user_id)


def get_library() -> Library:
    """The local user's statement files."""
    return get_store().files


@st.cache_resource
def get_client() -> anthropic.Anthropic:
    try:
        api_key = st.secrets.get("ANTHROPIC_API_KEY")
    except FileNotFoundError:
        api_key = None
    # Falls back to ANTHROPIC_API_KEY in the environment (or the root .env) when no secret is set.
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
