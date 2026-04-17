"""Tests for structured preferences endpoints (GET/PUT /api/users/:id/preferences/structured).

Validates that the structured preferences layer correctly:
- Groups flat key-value preferences into selected_features, channels, feature_settings, global_settings
- Supports merge-update semantics (only provided fields are changed)
- Returns per-feature configurable settings (not just toggles)
- Handles empty/initial state gracefully
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.main import app
from app.models.database import get_db
from app.models.schemas import Base


@pytest.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    await engine.dispose()


async def _create_user(client: AsyncClient, name: str = "Alice") -> str:
    resp = await client.post("/api/v1/users", json={"name": name})
    assert resp.status_code == 200
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# GET structured preferences
# ---------------------------------------------------------------------------


async def test_get_structured_preferences_empty(client):
    """New user should have empty structured preferences."""
    user_id = await _create_user(client)
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/structured")
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id
    prefs = body["preferences"]
    assert prefs["selected_features"] == []
    assert prefs["channels"] == []
    assert prefs["feature_settings"] == {}
    assert prefs["global_settings"] == {}


async def test_get_structured_preferences_with_existing_data(client):
    """Structured GET should assemble flat preferences into structured groups."""
    user_id = await _create_user(client)

    # Set flat preferences that map to structured fields
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "features.selected", "preference_value": ["vocab", "quiz", "flashcard"]},
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "delivery.channels", "preference_value": ["chat", "email"]},
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={
            "preference_key": "feature_settings.vocab",
            "preference_value": {
                "enabled": True,
                "difficulty_level": "hard",
                "words_per_day": 10,
                "include_examples": True,
            },
        },
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "global.language", "preference_value": "en"},
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "global.timezone", "preference_value": "Asia/Seoul"},
    )

    resp = await client.get(f"/api/v1/users/{user_id}/preferences/structured")
    assert resp.status_code == 200

    prefs = resp.json()["preferences"]
    assert prefs["selected_features"] == ["vocab", "quiz", "flashcard"]
    assert prefs["channels"] == ["chat", "email"]
    assert "vocab" in prefs["feature_settings"]
    vocab_settings = prefs["feature_settings"]["vocab"]
    assert vocab_settings["enabled"] is True
    assert vocab_settings["settings"]["difficulty_level"] == "hard"
    assert vocab_settings["settings"]["words_per_day"] == 10
    assert prefs["global_settings"]["language"] == "en"
    assert prefs["global_settings"]["timezone"] == "Asia/Seoul"


# ---------------------------------------------------------------------------
# PUT structured preferences — full update
# ---------------------------------------------------------------------------


async def test_put_structured_preferences_full(client):
    """Setting all fields at once should work correctly."""
    user_id = await _create_user(client)

    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "selected_features": ["vocab", "daily_word"],
            "channels": ["chat"],
            "feature_settings": {
                "vocab": {
                    "enabled": True,
                    "settings": {
                        "difficulty_level": "medium",
                        "words_per_day": 5,
                        "include_examples": True,
                        "quiz_style": "multiple_choice",
                    },
                },
                "daily_word": {
                    "enabled": True,
                    "settings": {"delivery_time": "09:00"},
                },
            },
            "global_settings": {
                "language": "ko",
                "timezone": "Asia/Seoul",
            },
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id

    prefs = body["preferences"]
    assert prefs["selected_features"] == ["vocab", "daily_word"]
    assert prefs["channels"] == ["chat"]
    assert len(prefs["feature_settings"]) == 2
    assert prefs["feature_settings"]["vocab"]["enabled"] is True
    assert prefs["feature_settings"]["vocab"]["settings"]["difficulty_level"] == "medium"
    assert prefs["feature_settings"]["vocab"]["settings"]["words_per_day"] == 5
    assert prefs["feature_settings"]["daily_word"]["settings"]["delivery_time"] == "09:00"
    assert prefs["global_settings"]["language"] == "ko"

    # Check updated_keys
    assert "features.selected" in body["updated_keys"]
    assert "delivery.channels" in body["updated_keys"]
    assert "feature_settings.vocab" in body["updated_keys"]
    assert "feature_settings.daily_word" in body["updated_keys"]
    assert "global.language" in body["updated_keys"]
    assert "global.timezone" in body["updated_keys"]


# ---------------------------------------------------------------------------
# PUT structured preferences — partial / merge semantics
# ---------------------------------------------------------------------------


async def test_put_structured_preferences_partial_update(client):
    """Omitted fields should not be changed (merge semantics)."""
    user_id = await _create_user(client)

    # Set initial state
    await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "selected_features": ["vocab"],
            "channels": ["chat"],
            "feature_settings": {
                "vocab": {"enabled": True, "settings": {"difficulty_level": "easy"}},
            },
            "global_settings": {"language": "en"},
        },
    )

    # Partial update — only change channels
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={"channels": ["chat", "email"]},
    )
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]

    # Channels updated
    assert prefs["channels"] == ["chat", "email"]
    # Everything else unchanged
    assert prefs["selected_features"] == ["vocab"]
    assert prefs["feature_settings"]["vocab"]["settings"]["difficulty_level"] == "easy"
    assert prefs["global_settings"]["language"] == "en"

    # updated_keys should only contain what was changed
    assert resp.json()["updated_keys"] == ["delivery.channels"]


async def test_put_structured_preferences_update_single_feature(client):
    """Updating one feature should not affect other features."""
    user_id = await _create_user(client)

    # Set two features
    await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "feature_settings": {
                "vocab": {"enabled": True, "settings": {"difficulty_level": "easy"}},
                "quiz": {"enabled": True, "settings": {"style": "multiple_choice"}},
            },
        },
    )

    # Update only vocab
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "feature_settings": {
                "vocab": {"enabled": True, "settings": {"difficulty_level": "hard"}},
            },
        },
    )
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]

    # Vocab updated
    assert prefs["feature_settings"]["vocab"]["settings"]["difficulty_level"] == "hard"
    # Quiz unchanged
    assert prefs["feature_settings"]["quiz"]["settings"]["style"] == "multiple_choice"


# ---------------------------------------------------------------------------
# Per-feature settings — granularity (not just toggles)
# ---------------------------------------------------------------------------


async def test_feature_settings_granularity(client):
    """Feature settings support rich configuration, not simple on/off toggles."""
    user_id = await _create_user(client)

    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "feature_settings": {
                "vocab": {
                    "enabled": True,
                    "settings": {
                        "difficulty_level": "hard",
                        "words_per_day": 15,
                        "include_examples": True,
                        "include_part_of_speech": False,
                        "quiz_style": "fill_in_blank",
                        "content_categories": ["words", "idioms", "collocations"],
                        "target_language": "ko",
                        "review_interval_hours": 12,
                    },
                },
            },
        },
    )
    assert resp.status_code == 200
    vocab = resp.json()["preferences"]["feature_settings"]["vocab"]
    s = vocab["settings"]
    assert s["difficulty_level"] == "hard"
    assert s["words_per_day"] == 15
    assert s["include_examples"] is True
    assert s["include_part_of_speech"] is False
    assert s["quiz_style"] == "fill_in_blank"
    assert s["content_categories"] == ["words", "idioms", "collocations"]
    assert s["target_language"] == "ko"
    assert s["review_interval_hours"] == 12


async def test_feature_can_be_disabled_with_settings_preserved(client):
    """Disabling a feature should preserve its settings."""
    user_id = await _create_user(client)

    # Enable with settings
    await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "feature_settings": {
                "vocab": {
                    "enabled": True,
                    "settings": {"difficulty_level": "hard", "words_per_day": 10},
                },
            },
        },
    )

    # Disable but keep settings
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "feature_settings": {
                "vocab": {
                    "enabled": False,
                    "settings": {"difficulty_level": "hard", "words_per_day": 10},
                },
            },
        },
    )
    assert resp.status_code == 200
    vocab = resp.json()["preferences"]["feature_settings"]["vocab"]
    assert vocab["enabled"] is False
    assert vocab["settings"]["difficulty_level"] == "hard"
    assert vocab["settings"]["words_per_day"] == 10


# ---------------------------------------------------------------------------
# Consistency — structured and flat views are in sync
# ---------------------------------------------------------------------------


async def test_structured_and_flat_views_are_consistent(client):
    """Setting preferences via structured API should be visible in flat API and vice-versa."""
    user_id = await _create_user(client)

    # Set via structured API
    await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "selected_features": ["vocab"],
            "channels": ["chat"],
        },
    )

    # Read via flat API
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/features.selected")
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == ["vocab"]

    resp = await client.get(f"/api/v1/users/{user_id}/preferences/delivery.channels")
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == ["chat"]

    # Set via flat API
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "global.theme", "preference_value": "dark"},
    )

    # Read via structured API
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/structured")
    assert resp.status_code == 200
    assert resp.json()["preferences"]["global_settings"]["theme"] == "dark"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


async def test_put_empty_update(client):
    """PUT with no fields should be a no-op, returning current state."""
    user_id = await _create_user(client)
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={},
    )
    assert resp.status_code == 200
    assert resp.json()["updated_keys"] == []


async def test_multiple_features_independent(client):
    """Multiple features can be configured independently."""
    user_id = await _create_user(client)
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/structured",
        json={
            "selected_features": ["vocab", "quiz", "flashcard"],
            "feature_settings": {
                "vocab": {"enabled": True, "settings": {"difficulty_level": "easy"}},
                "quiz": {"enabled": True, "settings": {"style": "fill_in_blank", "max_questions": 10}},
                "flashcard": {"enabled": False, "settings": {"show_hints": True}},
            },
        },
    )
    assert resp.status_code == 200
    fs = resp.json()["preferences"]["feature_settings"]
    assert len(fs) == 3
    assert fs["vocab"]["enabled"] is True
    assert fs["quiz"]["settings"]["max_questions"] == 10
    assert fs["flashcard"]["enabled"] is False
    assert fs["flashcard"]["settings"]["show_hints"] is True
