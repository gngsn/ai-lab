"""Abstract protocol for user preferences persistence.

Both the SQLAlchemy (local) and Supabase (cloud) backends implement this
protocol, allowing API endpoints and bot command handlers to remain
storage-agnostic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Shared data transfer object
# ---------------------------------------------------------------------------

@dataclass
class PreferenceRecord:
    """Storage-agnostic representation of a user preference row."""

    id: str
    user_id: str
    preference_key: str
    preference_value: Any
    created_at: str | None = None
    updated_at: str | None = None


# Type alias for JSON-compatible values
PreferenceValue = dict[str, Any] | list[Any] | str | int | float | bool


# ---------------------------------------------------------------------------
# Protocol (structural subtyping)
# ---------------------------------------------------------------------------

@runtime_checkable
class PreferencesRepository(Protocol):
    """Minimal contract that any preference backend must satisfy."""

    async def get(
        self,
        user_id: str,
        preference_key: str,
    ) -> PreferenceRecord | None:
        """Return a single preference or ``None``."""
        ...

    async def get_all(
        self,
        user_id: str,
        *,
        prefix: str | None = None,
    ) -> list[PreferenceRecord]:
        """Return all preferences for a user, optionally filtered by key prefix."""
        ...

    async def set(
        self,
        user_id: str,
        preference_key: str,
        preference_value: PreferenceValue,
    ) -> PreferenceRecord:
        """Create or update (upsert) a single preference."""
        ...

    async def set_bulk(
        self,
        user_id: str,
        preferences: dict[str, PreferenceValue],
    ) -> list[PreferenceRecord]:
        """Upsert multiple preferences at once."""
        ...

    async def delete(
        self,
        user_id: str,
        preference_key: str,
    ) -> bool:
        """Delete a single preference. Returns ``True`` if a row was removed."""
        ...
