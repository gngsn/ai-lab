"""Tests for UserPreferencesRepository using a mock Supabase client.

These tests verify the repository's CRUD logic without requiring a live
Supabase instance.  The mock replaces the ``supabase.Client.table()`` call
chain with a simple in-memory store.
"""

from __future__ import annotations

import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import pytest

from app.services.user_preferences_repository import (
    PreferenceRecord,
    UserPreferencesRepository,
)


# ---------------------------------------------------------------------------
# Lightweight mock that mimics supabase-py's fluent query builder
# ---------------------------------------------------------------------------


@dataclass
class _MockResponse:
    data: list[dict[str, Any]] | dict[str, Any] | None


class _MockQueryBuilder:
    """Simulates the Supabase table().select/insert/upsert/update/delete chain."""

    def __init__(self, store: dict[tuple[str, str], dict[str, Any]]) -> None:
        self._store = store
        self._filters: dict[str, Any] = {}
        self._like_filters: dict[str, str] = {}
        self._operation: str = "select"
        self._payload: list[dict[str, Any]] | dict[str, Any] | None = None
        self._on_conflict: str | None = None
        self._columns: str = "*"
        self._order_col: str | None = None
        self._single: bool = False
        self._maybe_single: bool = False

    # -- Operation starters -------------------------------------------------

    def select(self, columns: str = "*") -> _MockQueryBuilder:
        self._operation = "select"
        self._columns = columns
        return self

    def insert(self, payload: dict | list) -> _MockQueryBuilder:
        self._operation = "insert"
        self._payload = payload
        return self

    def upsert(self, payload: dict | list, *, on_conflict: str = "") -> _MockQueryBuilder:
        self._operation = "upsert"
        self._payload = payload if isinstance(payload, list) else [payload]
        self._on_conflict = on_conflict
        return self

    def update(self, payload: dict) -> _MockQueryBuilder:
        self._operation = "update"
        self._payload = payload
        return self

    def delete(self) -> _MockQueryBuilder:
        self._operation = "delete"
        return self

    # -- Filters ------------------------------------------------------------

    def eq(self, column: str, value: Any) -> _MockQueryBuilder:
        self._filters[column] = value
        return self

    def like(self, column: str, pattern: str) -> _MockQueryBuilder:
        self._like_filters[column] = pattern
        return self

    # -- Modifiers ----------------------------------------------------------

    def order(self, column: str, **kwargs) -> _MockQueryBuilder:
        self._order_col = column
        return self

    def single(self) -> _MockQueryBuilder:
        self._single = True
        return self

    def maybe_single(self) -> _MockQueryBuilder:
        self._maybe_single = True
        return self

    # -- Matching helpers ---------------------------------------------------

    def _matches(self, row: dict[str, Any]) -> bool:
        for col, val in self._filters.items():
            if row.get(col) != val:
                return False
        for col, pattern in self._like_filters.items():
            prefix = pattern.rstrip("%")
            if not str(row.get(col, "")).startswith(prefix):
                return False
        return True

    # -- Execute ------------------------------------------------------------

    def execute(self) -> _MockResponse:
        now = datetime.now(timezone.utc).isoformat()

        if self._operation == "select":
            rows = [deepcopy(r) for r in self._store.values() if self._matches(r)]
            if self._order_col:
                rows.sort(key=lambda r: r.get(self._order_col, ""))
            if self._maybe_single:
                return _MockResponse(data=rows[0] if rows else None)
            return _MockResponse(data=rows)

        if self._operation == "upsert":
            results = []
            for item in self._payload:
                key = (item["user_id"], item["preference_key"])
                if key in self._store:
                    # update existing
                    existing = self._store[key]
                    existing["preference_value"] = item["preference_value"]
                    existing["updated_at"] = now
                    results.append(deepcopy(existing))
                else:
                    # insert new
                    item.setdefault("id", str(uuid.uuid4()))
                    item.setdefault("created_at", now)
                    item.setdefault("updated_at", now)
                    self._store[key] = deepcopy(item)
                    results.append(deepcopy(item))
            return _MockResponse(data=results)

        if self._operation == "update":
            results = []
            for key, row in list(self._store.items()):
                if self._matches(row):
                    row.update(self._payload)
                    row["updated_at"] = now
                    results.append(deepcopy(row))
            return _MockResponse(data=results)

        if self._operation == "delete":
            deleted = []
            for key in list(self._store.keys()):
                if self._matches(self._store[key]):
                    deleted.append(deepcopy(self._store.pop(key)))
            return _MockResponse(data=deleted)

        return _MockResponse(data=None)


class _MockSupabaseClient:
    """Minimal mock of ``supabase.Client`` providing only ``.table()``."""

    def __init__(self) -> None:
        self._stores: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}

    def table(self, name: str) -> _MockQueryBuilder:
        if name not in self._stores:
            self._stores[name] = {}
        return _MockQueryBuilder(self._stores[name])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_client() -> _MockSupabaseClient:
    return _MockSupabaseClient()


@pytest.fixture
def repo(mock_client) -> UserPreferencesRepository:
    return UserPreferencesRepository(client=mock_client)  # type: ignore[arg-type]


USER_ID = "user-001"
OTHER_USER_ID = "user-002"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGet:
    async def test_get_nonexistent_returns_none(self, repo):
        result = await repo.get(USER_ID, "nonexistent.key")
        assert result is None

    async def test_get_existing_preference(self, repo):
        await repo.set(USER_ID, "vocab.difficulty_level", "intermediate")
        result = await repo.get(USER_ID, "vocab.difficulty_level")
        assert result is not None
        assert result.preference_key == "vocab.difficulty_level"
        assert result.preference_value == "intermediate"
        assert result.user_id == USER_ID

    async def test_get_does_not_cross_users(self, repo):
        await repo.set(USER_ID, "vocab.topic", "science")
        result = await repo.get(OTHER_USER_ID, "vocab.topic")
        assert result is None


class TestGetAll:
    async def test_get_all_empty(self, repo):
        result = await repo.get_all(USER_ID)
        assert result == []

    async def test_get_all_returns_all(self, repo):
        await repo.set(USER_ID, "vocab.difficulty_level", "easy")
        await repo.set(USER_ID, "delivery.frequency", "daily")
        result = await repo.get_all(USER_ID)
        assert len(result) == 2

    async def test_get_all_with_prefix_filter(self, repo):
        await repo.set(USER_ID, "vocab.difficulty_level", "hard")
        await repo.set(USER_ID, "vocab.topics", ["science", "tech"])
        await repo.set(USER_ID, "delivery.frequency", "weekly")
        result = await repo.get_all(USER_ID, prefix="vocab")
        assert len(result) == 2
        assert all(r.preference_key.startswith("vocab") for r in result)

    async def test_get_all_ordered_by_key(self, repo):
        await repo.set(USER_ID, "z_key", "last")
        await repo.set(USER_ID, "a_key", "first")
        result = await repo.get_all(USER_ID)
        assert result[0].preference_key == "a_key"
        assert result[1].preference_key == "z_key"

    async def test_get_all_isolates_users(self, repo):
        await repo.set(USER_ID, "key1", "val1")
        await repo.set(OTHER_USER_ID, "key2", "val2")
        result = await repo.get_all(USER_ID)
        assert len(result) == 1
        assert result[0].preference_key == "key1"


class TestSet:
    async def test_set_creates_new_preference(self, repo):
        pref = await repo.set(USER_ID, "vocab.difficulty_level", "beginner")
        assert pref.user_id == USER_ID
        assert pref.preference_key == "vocab.difficulty_level"
        assert pref.preference_value == "beginner"
        assert pref.id  # non-empty UUID

    async def test_set_upserts_existing_preference(self, repo):
        pref1 = await repo.set(USER_ID, "vocab.difficulty_level", "beginner")
        pref2 = await repo.set(USER_ID, "vocab.difficulty_level", "advanced")
        assert pref2.preference_value == "advanced"
        # Verify only one row exists
        all_prefs = await repo.get_all(USER_ID)
        assert len(all_prefs) == 1

    async def test_set_supports_dict_value(self, repo):
        value = {"level": 3, "sub_topics": ["physics", "chemistry"]}
        pref = await repo.set(USER_ID, "vocab.config", value)
        assert pref.preference_value == value

    async def test_set_supports_list_value(self, repo):
        pref = await repo.set(USER_ID, "vocab.topics", ["math", "history"])
        assert pref.preference_value == ["math", "history"]

    async def test_set_supports_numeric_value(self, repo):
        pref = await repo.set(USER_ID, "vocab.max_words_per_day", 20)
        assert pref.preference_value == 20

    async def test_set_supports_boolean_value(self, repo):
        pref = await repo.set(USER_ID, "vocab.include_examples", True)
        assert pref.preference_value is True


class TestSetBulk:
    async def test_set_bulk_empty(self, repo):
        result = await repo.set_bulk(USER_ID, {})
        assert result == []

    async def test_set_bulk_creates_multiple(self, repo):
        prefs = {
            "vocab.difficulty_level": "intermediate",
            "vocab.topics": ["science"],
            "delivery.frequency": "daily",
        }
        result = await repo.set_bulk(USER_ID, prefs)
        assert len(result) == 3
        keys = {r.preference_key for r in result}
        assert keys == {"vocab.difficulty_level", "vocab.topics", "delivery.frequency"}

    async def test_set_bulk_upserts_existing(self, repo):
        await repo.set(USER_ID, "vocab.difficulty_level", "easy")
        prefs = {
            "vocab.difficulty_level": "hard",
            "vocab.new_key": "new_val",
        }
        result = await repo.set_bulk(USER_ID, prefs)
        assert len(result) == 2
        all_prefs = await repo.get_all(USER_ID)
        assert len(all_prefs) == 2


class TestUpdate:
    async def test_update_existing_preference(self, repo):
        await repo.set(USER_ID, "vocab.difficulty_level", "beginner")
        updated = await repo.update(USER_ID, "vocab.difficulty_level", "advanced")
        assert updated is not None
        assert updated.preference_value == "advanced"

    async def test_update_nonexistent_returns_none(self, repo):
        result = await repo.update(USER_ID, "nonexistent.key", "value")
        assert result is None

    async def test_update_does_not_affect_other_keys(self, repo):
        await repo.set(USER_ID, "key_a", "val_a")
        await repo.set(USER_ID, "key_b", "val_b")
        await repo.update(USER_ID, "key_a", "updated_a")
        b = await repo.get(USER_ID, "key_b")
        assert b is not None
        assert b.preference_value == "val_b"


class TestDelete:
    async def test_delete_existing_returns_true(self, repo):
        await repo.set(USER_ID, "vocab.topic", "science")
        result = await repo.delete(USER_ID, "vocab.topic")
        assert result is True

    async def test_delete_nonexistent_returns_false(self, repo):
        result = await repo.delete(USER_ID, "nonexistent.key")
        assert result is False

    async def test_delete_removes_from_store(self, repo):
        await repo.set(USER_ID, "vocab.topic", "science")
        await repo.delete(USER_ID, "vocab.topic")
        result = await repo.get(USER_ID, "vocab.topic")
        assert result is None

    async def test_delete_does_not_affect_other_keys(self, repo):
        await repo.set(USER_ID, "key_a", "val_a")
        await repo.set(USER_ID, "key_b", "val_b")
        await repo.delete(USER_ID, "key_a")
        b = await repo.get(USER_ID, "key_b")
        assert b is not None


class TestDeleteAll:
    async def test_delete_all(self, repo):
        await repo.set(USER_ID, "key_a", "val_a")
        await repo.set(USER_ID, "key_b", "val_b")
        count = await repo.delete_all(USER_ID)
        assert count == 2
        remaining = await repo.get_all(USER_ID)
        assert remaining == []

    async def test_delete_all_with_prefix(self, repo):
        await repo.set(USER_ID, "vocab.topic", "science")
        await repo.set(USER_ID, "vocab.level", "easy")
        await repo.set(USER_ID, "delivery.freq", "daily")
        count = await repo.delete_all(USER_ID, prefix="vocab")
        assert count == 2
        remaining = await repo.get_all(USER_ID)
        assert len(remaining) == 1
        assert remaining[0].preference_key == "delivery.freq"

    async def test_delete_all_empty_returns_zero(self, repo):
        count = await repo.delete_all(USER_ID)
        assert count == 0

    async def test_delete_all_isolates_users(self, repo):
        await repo.set(USER_ID, "key", "val")
        await repo.set(OTHER_USER_ID, "key", "val")
        await repo.delete_all(USER_ID)
        other = await repo.get_all(OTHER_USER_ID)
        assert len(other) == 1


class TestPreferenceRecord:
    def test_from_row(self):
        row = {
            "id": "abc-123",
            "user_id": "user-001",
            "preference_key": "vocab.topic",
            "preference_value": {"topics": ["math"]},
            "created_at": "2026-03-22T00:00:00Z",
            "updated_at": "2026-03-22T01:00:00Z",
        }
        record = PreferenceRecord.from_row(row)
        assert record.id == "abc-123"
        assert record.user_id == "user-001"
        assert record.preference_key == "vocab.topic"
        assert record.preference_value == {"topics": ["math"]}
        assert record.created_at == "2026-03-22T00:00:00Z"
        assert record.updated_at == "2026-03-22T01:00:00Z"

    def test_from_row_missing_timestamps(self):
        row = {
            "id": "abc-123",
            "user_id": "user-001",
            "preference_key": "key",
            "preference_value": "val",
        }
        record = PreferenceRecord.from_row(row)
        assert record.created_at is None
        assert record.updated_at is None
