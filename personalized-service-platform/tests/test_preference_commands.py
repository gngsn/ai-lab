"""Tests for bot preference command handlers.

Uses an in-memory mock repository to verify command parsing, dispatching,
and response formatting without any database dependency.
"""

import json

import pytest

from app.bot.preference_commands import CommandResult, PreferenceCommandHandler
from app.services.preferences_repository_protocol import PreferenceRecord


# ---------------------------------------------------------------------------
# In-memory mock repository
# ---------------------------------------------------------------------------


class InMemoryPreferencesRepository:
    """Minimal in-memory repository for testing command handlers."""

    def __init__(self) -> None:
        self._store: dict[tuple[str, str], PreferenceRecord] = {}
        self._counter = 0

    def _next_id(self) -> str:
        self._counter += 1
        return f"id-{self._counter}"

    async def get(self, user_id: str, preference_key: str) -> PreferenceRecord | None:
        return self._store.get((user_id, preference_key))

    async def get_all(self, user_id: str, *, prefix: str | None = None) -> list[PreferenceRecord]:
        results = [
            rec
            for (uid, _), rec in self._store.items()
            if uid == user_id
        ]
        if prefix:
            results = [r for r in results if r.preference_key.startswith(prefix)]
        return sorted(results, key=lambda r: r.preference_key)

    async def set(self, user_id: str, preference_key: str, preference_value) -> PreferenceRecord:
        key = (user_id, preference_key)
        existing = self._store.get(key)
        if existing:
            rec = PreferenceRecord(
                id=existing.id,
                user_id=user_id,
                preference_key=preference_key,
                preference_value=preference_value,
                created_at=existing.created_at,
                updated_at="2026-01-01T00:00:00",
            )
        else:
            rec = PreferenceRecord(
                id=self._next_id(),
                user_id=user_id,
                preference_key=preference_key,
                preference_value=preference_value,
                created_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:00",
            )
        self._store[key] = rec
        return rec

    async def set_bulk(self, user_id: str, preferences: dict) -> list[PreferenceRecord]:
        results = []
        for key, value in preferences.items():
            results.append(await self.set(user_id, key, value))
        return results

    async def delete(self, user_id: str, preference_key: str) -> bool:
        key = (user_id, preference_key)
        if key in self._store:
            del self._store[key]
            return True
        return False


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

USER_ID = "user-123"


@pytest.fixture
def repo() -> InMemoryPreferencesRepository:
    return InMemoryPreferencesRepository()


@pytest.fixture
def handler(repo) -> PreferenceCommandHandler:
    return PreferenceCommandHandler(repo)


# ---------------------------------------------------------------------------
# Tests: /set_preference
# ---------------------------------------------------------------------------


async def test_set_preference_string(handler):
    result = await handler.handle(USER_ID, "/set_preference vocab.level hard")
    assert result.success
    assert "vocab.level" in result.text
    assert "hard" in result.text
    assert result.data["preference_key"] == "vocab.level"
    assert result.data["preference_value"] == "hard"


async def test_set_preference_json_value(handler):
    result = await handler.handle(USER_ID, '/set_preference vocab.topics ["business","tech"]')
    assert result.success
    assert result.data["preference_value"] == ["business", "tech"]


async def test_set_preference_number(handler):
    result = await handler.handle(USER_ID, "/set_preference vocab.daily_count 15")
    assert result.success
    assert result.data["preference_value"] == 15


async def test_set_preference_json_object(handler):
    result = await handler.handle(
        USER_ID,
        '/set_preference vocab.schedule {"frequency":"daily","time":"09:00"}',
    )
    assert result.success
    assert result.data["preference_value"]["frequency"] == "daily"


async def test_set_preference_missing_args(handler):
    result = await handler.handle(USER_ID, "/set_preference")
    assert not result.success
    assert "Usage" in result.text


async def test_set_preference_missing_value(handler):
    result = await handler.handle(USER_ID, "/set_preference vocab.level")
    assert not result.success


# ---------------------------------------------------------------------------
# Tests: /get_preference
# ---------------------------------------------------------------------------


async def test_get_preference_found(handler, repo):
    await repo.set(USER_ID, "vocab.level", "intermediate")
    result = await handler.handle(USER_ID, "/get_preference vocab.level")
    assert result.success
    assert "intermediate" in result.text
    assert result.data["preference_value"] == "intermediate"


async def test_get_preference_not_found(handler):
    result = await handler.handle(USER_ID, "/get_preference no.such.key")
    assert not result.success
    assert "not found" in result.text


async def test_get_preference_missing_args(handler):
    result = await handler.handle(USER_ID, "/get_preference")
    assert not result.success
    assert "Usage" in result.text


# ---------------------------------------------------------------------------
# Tests: /delete_preference
# ---------------------------------------------------------------------------


async def test_delete_preference_success(handler, repo):
    await repo.set(USER_ID, "vocab.temp", "delete_me")
    result = await handler.handle(USER_ID, "/delete_preference vocab.temp")
    assert result.success
    assert "Deleted" in result.text
    # Confirm gone
    assert await repo.get(USER_ID, "vocab.temp") is None


async def test_delete_preference_not_found(handler):
    result = await handler.handle(USER_ID, "/delete_preference nonexistent")
    assert not result.success
    assert "not found" in result.text


# ---------------------------------------------------------------------------
# Tests: /preferences (list)
# ---------------------------------------------------------------------------


async def test_list_preferences_empty(handler):
    result = await handler.handle(USER_ID, "/preferences")
    assert result.success
    assert "No preferences found" in result.text
    assert result.data["count"] == 0


async def test_list_preferences_with_data(handler, repo):
    await repo.set(USER_ID, "vocab.level", "hard")
    await repo.set(USER_ID, "vocab.topics", ["tech"])
    await repo.set(USER_ID, "delivery.channels", ["chat"])

    result = await handler.handle(USER_ID, "/preferences")
    assert result.success
    assert result.data["count"] == 3
    assert "vocab.level" in result.text
    assert "delivery.channels" in result.text


async def test_list_preferences_with_prefix(handler, repo):
    await repo.set(USER_ID, "vocab.level", "hard")
    await repo.set(USER_ID, "delivery.channels", ["chat"])

    result = await handler.handle(USER_ID, "/preferences vocab")
    assert result.success
    assert result.data["count"] == 1
    assert result.data["prefix"] == "vocab"
    assert "vocab.level" in result.text
    assert "delivery" not in result.text


# ---------------------------------------------------------------------------
# Tests: /set_preferences_bulk
# ---------------------------------------------------------------------------


async def test_bulk_set_preferences(handler):
    payload = json.dumps({"vocab.level": "hard", "vocab.daily_count": 20})
    result = await handler.handle(USER_ID, f"/set_preferences_bulk {payload}")
    assert result.success
    assert result.data["count"] == 2
    assert "vocab.level" in result.text
    assert "vocab.daily_count" in result.text


async def test_bulk_set_invalid_json(handler):
    result = await handler.handle(USER_ID, "/set_preferences_bulk not-json")
    assert not result.success
    assert "Invalid JSON" in result.text


async def test_bulk_set_non_object_json(handler):
    result = await handler.handle(USER_ID, '/set_preferences_bulk ["a","b"]')
    assert not result.success
    assert "JSON object" in result.text


async def test_bulk_set_missing_args(handler):
    result = await handler.handle(USER_ID, "/set_preferences_bulk")
    assert not result.success
    assert "Usage" in result.text


# ---------------------------------------------------------------------------
# Tests: /help_preferences
# ---------------------------------------------------------------------------


async def test_help_preferences(handler):
    result = await handler.handle(USER_ID, "/help_preferences")
    assert result.success
    assert "/preferences" in result.text
    assert "/get_preference" in result.text
    assert "/set_preference" in result.text
    assert "/delete_preference" in result.text
    assert "dot-notation" in result.text


# ---------------------------------------------------------------------------
# Tests: Command aliases
# ---------------------------------------------------------------------------


async def test_alias_get_pref(handler, repo):
    await repo.set(USER_ID, "vocab.level", "easy")
    result = await handler.handle(USER_ID, "/get_pref vocab.level")
    assert result.success
    assert result.data["preference_value"] == "easy"


async def test_alias_set_pref(handler):
    result = await handler.handle(USER_ID, "/set_pref vocab.level medium")
    assert result.success
    assert result.data["preference_value"] == "medium"


async def test_alias_prefs(handler):
    result = await handler.handle(USER_ID, "/prefs")
    assert result.success


async def test_alias_help_prefs(handler):
    result = await handler.handle(USER_ID, "/help_prefs")
    assert result.success


# ---------------------------------------------------------------------------
# Tests: Edge cases
# ---------------------------------------------------------------------------


async def test_unknown_command(handler):
    result = await handler.handle(USER_ID, "/unknown_command")
    assert not result.success
    assert "Unknown command" in result.text


async def test_empty_command(handler):
    result = await handler.handle(USER_ID, "")
    assert not result.success


async def test_is_preference_command():
    assert PreferenceCommandHandler.is_preference_command("/preferences")
    assert PreferenceCommandHandler.is_preference_command("/set_preference vocab.level hard")
    assert PreferenceCommandHandler.is_preference_command("/GET_PREFERENCE vocab.level")  # case insensitive
    assert not PreferenceCommandHandler.is_preference_command("/start")
    assert not PreferenceCommandHandler.is_preference_command("hello")
    assert not PreferenceCommandHandler.is_preference_command("")


async def test_set_preference_value_with_spaces(handler):
    """Values containing spaces should be joined."""
    result = await handler.handle(USER_ID, "/set_preference vocab.note this is a note")
    assert result.success
    assert result.data["preference_value"] == "this is a note"


async def test_set_preference_boolean(handler):
    result = await handler.handle(USER_ID, "/set_preference vocab.enabled true")
    assert result.success
    assert result.data["preference_value"] is True


async def test_update_existing_via_set(handler, repo):
    """Setting the same key twice should update, not create duplicate."""
    await handler.handle(USER_ID, "/set_preference vocab.level easy")
    await handler.handle(USER_ID, "/set_preference vocab.level hard")

    prefs = await repo.get_all(USER_ID)
    assert len(prefs) == 1
    assert prefs[0].preference_value == "hard"
