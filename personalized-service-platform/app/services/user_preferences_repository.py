"""UserPreferencesRepository — Supabase-backed CRUD for user preferences.

Provides get, set (upsert), update, and delete operations on the
``user_preferences`` table.  All methods are async-friendly and use the
Supabase Python client (postgrest) rather than raw SQL.

Usage::

    from app.services.user_preferences_repository import UserPreferencesRepository

    repo = UserPreferencesRepository()            # uses default client
    pref = await repo.get(user_id, "vocab.difficulty_level")
    await repo.set(user_id, "vocab.difficulty_level", {"level": "intermediate"})
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client

# Table name — matches the Supabase migration
_TABLE = "user_preferences"

# Type alias for JSON-compatible preference values
PreferenceValue = dict[str, Any] | list[Any] | str | int | float | bool


# ---------------------------------------------------------------------------
# Data transfer object returned by repository methods
# ---------------------------------------------------------------------------

@dataclass
class PreferenceRecord:
    """Lightweight representation of a stored preference row."""

    id: str
    user_id: str
    preference_key: str
    preference_value: Any
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> PreferenceRecord:
        """Build a PreferenceRecord from a Supabase response row."""
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            preference_key=row["preference_key"],
            preference_value=row["preference_value"],
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------

class UserPreferencesRepository:
    """CRUD service layer for the ``user_preferences`` table in Supabase.

    Parameters
    ----------
    client:
        An explicit Supabase ``Client`` instance.  When *None* (the default),
        the shared singleton from :func:`get_supabase_client` is used.
        Passing a client explicitly is useful for testing.
    """

    def __init__(self, client: Client | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Client:
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    @property
    def _table(self):
        return self.client.table(_TABLE)

    # -- Read ---------------------------------------------------------------

    async def get(
        self,
        user_id: str,
        preference_key: str,
    ) -> PreferenceRecord | None:
        """Get a single preference by *user_id* and *preference_key*.

        Returns ``None`` when no matching row exists.
        """
        response = (
            self._table
            .select("*")
            .eq("user_id", user_id)
            .eq("preference_key", preference_key)
            .maybe_single()
            .execute()
        )
        if response.data is None:
            return None
        return PreferenceRecord.from_row(response.data)

    async def get_all(
        self,
        user_id: str,
        *,
        prefix: str | None = None,
    ) -> list[PreferenceRecord]:
        """Return all preferences for *user_id*.

        Parameters
        ----------
        prefix:
            Optional dot-notation prefix to filter keys.  For example,
            ``prefix="vocab"`` matches ``vocab.difficulty_level``,
            ``vocab.topics``, etc.
        """
        query = self._table.select("*").eq("user_id", user_id)
        if prefix:
            # Use Supabase 'like' with a prefix pattern
            query = query.like("preference_key", f"{prefix}%")
        query = query.order("preference_key")
        response = query.execute()
        return [PreferenceRecord.from_row(row) for row in (response.data or [])]

    # -- Write (upsert) -----------------------------------------------------

    async def set(
        self,
        user_id: str,
        preference_key: str,
        preference_value: PreferenceValue,
    ) -> PreferenceRecord:
        """Create or update a preference (upsert semantics).

        If a row with the same ``(user_id, preference_key)`` already exists
        its ``preference_value`` is overwritten; otherwise a new row is
        inserted.
        """
        row = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "preference_key": preference_key,
            "preference_value": preference_value,
        }
        response = (
            self._table
            .upsert(row, on_conflict="user_id,preference_key")
            .execute()
        )
        return PreferenceRecord.from_row(response.data[0])

    async def set_bulk(
        self,
        user_id: str,
        preferences: dict[str, PreferenceValue],
    ) -> list[PreferenceRecord]:
        """Set multiple preferences at once (upsert each key).

        Parameters
        ----------
        preferences:
            Mapping of ``preference_key`` → ``preference_value``.
        """
        if not preferences:
            return []

        rows = [
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "preference_key": key,
                "preference_value": value,
            }
            for key, value in preferences.items()
        ]
        response = (
            self._table
            .upsert(rows, on_conflict="user_id,preference_key")
            .execute()
        )
        return [PreferenceRecord.from_row(r) for r in (response.data or [])]

    # -- Update (partial) ---------------------------------------------------

    async def update(
        self,
        user_id: str,
        preference_key: str,
        preference_value: PreferenceValue,
    ) -> PreferenceRecord | None:
        """Update the value of an existing preference.

        Returns ``None`` if the preference does not exist (no row matches).
        Unlike :meth:`set`, this will **not** create a new row.
        """
        response = (
            self._table
            .update({"preference_value": preference_value})
            .eq("user_id", user_id)
            .eq("preference_key", preference_key)
            .execute()
        )
        if not response.data:
            return None
        return PreferenceRecord.from_row(response.data[0])

    # -- Delete -------------------------------------------------------------

    async def delete(
        self,
        user_id: str,
        preference_key: str,
    ) -> bool:
        """Delete a single preference.

        Returns ``True`` if a row was deleted, ``False`` if nothing matched.
        """
        response = (
            self._table
            .delete()
            .eq("user_id", user_id)
            .eq("preference_key", preference_key)
            .execute()
        )
        return bool(response.data)

    async def delete_all(
        self,
        user_id: str,
        *,
        prefix: str | None = None,
    ) -> int:
        """Delete all preferences for *user_id*.

        Parameters
        ----------
        prefix:
            If provided, only keys starting with this prefix are deleted.

        Returns the number of deleted rows.
        """
        query = self._table.delete().eq("user_id", user_id)
        if prefix:
            query = query.like("preference_key", f"{prefix}%")
        response = query.execute()
        return len(response.data) if response.data else 0
