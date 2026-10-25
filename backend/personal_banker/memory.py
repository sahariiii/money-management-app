"""The assistant's long-term memory: what it should keep in mind about a user across conversations.

MemoryStore is the interface; JsonMemoryStore keeps one user's memories in a JSON
file (Storage.memory opens it). A store backed by SurrealDB Agent Memory implements
the same protocol, so the assistant doesn't change when the storage does.

The chat transcript itself isn't memory: it is app data the Chat tab shows (DataStore.chat).
"""

import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from .datastore import folder_lock, read_json, write_json
from .records import Memory, MemoryKind


class MemoryStore(Protocol):
    """One user's memories."""

    user_id: str

    def memories(self) -> list[Memory]:
        """Every memory, oldest first."""
        ...

    def remember(self, text: str, kind: MemoryKind = "fact", source: str | None = None) -> Memory:
        """Keeps `text`; an identical memory is returned instead of being stored twice."""
        ...

    def forget(self, memory_id: str) -> bool: ...

    def search(self, query: str, limit: int = 10) -> list[Memory]:
        """The memories most relevant to `query`, best first."""
        ...


_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.casefold()))


class JsonMemoryStore:
    """MemoryStore in a JSON file. Search ranks by words shared with the query (a database store would use embeddings)."""

    def __init__(self, path: Path, user_id: str):
        self.path = path
        self.user_id = user_id
        self._lock = folder_lock(path.parent)

    def memories(self) -> list[Memory]:
        return [Memory.model_validate(m) for m in read_json(self.path, {"memories": []})["memories"]]

    def remember(self, text: str, kind: MemoryKind = "fact", source: str | None = None) -> Memory:
        text = text.strip()
        if not text:
            raise ValueError("A memory needs some text.")
        with self._lock:
            saved = self.memories()
            if existing := next((m for m in saved if m.text.casefold() == text.casefold()), None):
                return existing
            memory = Memory(
                id=f"mem_{secrets.token_hex(6)}",
                text=text,
                kind=kind,
                created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                source=source,
            )
            write_json(self.path, {"memories": [m.model_dump() for m in [*saved, memory]]})
        return memory

    def forget(self, memory_id: str) -> bool:
        with self._lock:
            saved = self.memories()
            kept = [m for m in saved if m.id != memory_id]
            if len(kept) == len(saved):
                return False
            write_json(self.path, {"memories": [m.model_dump() for m in kept]})
        return True

    def search(self, query: str, limit: int = 10) -> list[Memory]:
        wanted = _words(query)
        scored = [(len(wanted & _words(m.text)), i, m) for i, m in enumerate(self.memories())]
        # Most shared words first; newer first among equals.
        return [m for score, _, m in sorted(scored, key=lambda s: (-s[0], -s[1])) if score > 0][:limit]
