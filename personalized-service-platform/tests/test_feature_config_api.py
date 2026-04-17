"""Tests for the feature configuration CRUD API endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.main import app
from app.models.database import get_db
from app.models.schemas import Base
from app.models.feature_config import create_vocab_learning_config_schema
from app.services.feature_config_repository import (
    register_global_schema,
    reset_schema_registry,
)


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

    # Register vocab learning schema for validation tests
    reset_schema_registry()
    register_global_schema(create_vocab_learning_config_schema())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    reset_schema_registry()
    await engine.dispose()


async def _create_user(client: AsyncClient, name: str = "Alice") -> str:
    resp = await client.post("/api/v1/users", json={"name": name})
    assert resp.status_code == 200
    return resp.json()["id"]


BASE = "/api/v1"


# ---------------------------------------------------------------------------
# CREATE — POST /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


async def test_create_feature_config(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={
            "enabled": True,
            "custom_settings": {"words_per_day": 10, "difficulty_level": "hard"},
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == uid
    assert data["feature_name"] == "vocab_learning"
    assert data["config"]["enabled"] is True
    assert data["config"]["custom_settings"]["words_per_day"] == 10


async def test_create_feature_config_conflict(client):
    uid = await _create_user(client)
    # Create first time
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": True},
    )
    assert resp.status_code == 201

    # Create again → 409
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": False},
    )
    assert resp.status_code == 409


async def test_create_feature_config_invalid_settings(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={
            "custom_settings": {"words_per_day": 999},  # exceeds max 50
        },
    )
    assert resp.status_code == 422


async def test_create_feature_config_with_frequency(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={
            "enabled": True,
            "frequency": {"value": 3, "unit": "daily"},
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["config"]["frequency"]["value"] == 3
    assert data["config"]["frequency"]["unit"] == "daily"


async def test_create_feature_config_with_difficulty(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={
            "difficulty": {"level": "hard", "adaptive": True},
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["config"]["difficulty"]["level"] == "hard"
    assert data["config"]["difficulty"]["adaptive"] is True


async def test_create_feature_config_invalid_feature_name(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/123-bad!/config",
        json={"enabled": True},
    )
    assert resp.status_code == 400


async def test_create_feature_config_invalid_setting_key(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/my_feature/config",
        json={"custom_settings": {"invalid key!": "val"}},
    )
    assert resp.status_code == 422  # Pydantic validation


# ---------------------------------------------------------------------------
# READ — GET /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


async def test_get_feature_config(client):
    uid = await _create_user(client)
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 7}},
    )

    resp = await client.get(f"{BASE}/users/{uid}/features/vocab_learning/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["custom_settings"]["words_per_day"] == 7


async def test_get_feature_config_not_found(client):
    uid = await _create_user(client)
    resp = await client.get(f"{BASE}/users/{uid}/features/nonexistent/config")
    assert resp.status_code == 404


async def test_get_feature_config_with_defaults(client):
    uid = await _create_user(client)
    resp = await client.get(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        params={"include_defaults": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Should return schema defaults
    assert data["config"]["custom_settings"]["words_per_day"] == 5  # default


# ---------------------------------------------------------------------------
# READ ALL — GET /users/{user_id}/features/config
# ---------------------------------------------------------------------------


async def test_list_feature_configs_empty(client):
    uid = await _create_user(client)
    resp = await client.get(f"{BASE}/users/{uid}/features/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["configs"] == {}


async def test_list_feature_configs(client):
    uid = await _create_user(client)
    # Create two configs
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 10}},
    )
    await client.post(
        f"{BASE}/users/{uid}/features/my_feature/config",
        json={"enabled": False},
    )

    resp = await client.get(f"{BASE}/users/{uid}/features/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert "vocab_learning" in data["configs"]
    assert "my_feature" in data["configs"]


# ---------------------------------------------------------------------------
# REPLACE — PUT /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


async def test_put_feature_config(client):
    uid = await _create_user(client)
    # Create
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 5}},
    )
    # Replace
    resp = await client.put(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 20, "difficulty_level": "easy"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["custom_settings"]["words_per_day"] == 20
    assert data["config"]["custom_settings"]["difficulty_level"] == "easy"


async def test_put_creates_if_not_exists(client):
    uid = await _create_user(client)
    resp = await client.put(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 15}},
    )
    assert resp.status_code == 200


async def test_put_with_validation_off(client):
    uid = await _create_user(client)
    # This would fail validation but with validate=false it succeeds
    resp = await client.put(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 999}},
        params={"validate": False},
    )
    assert resp.status_code == 200


async def test_put_with_validation_on_rejects_invalid(client):
    uid = await _create_user(client)
    resp = await client.put(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 999}},
        params={"validate": True},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PARTIAL UPDATE — PATCH /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


async def test_patch_feature_config(client):
    uid = await _create_user(client)
    # Create
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 5, "difficulty_level": "easy"}},
    )
    # Patch — only update words_per_day, leave difficulty_level
    resp = await client.patch(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 15}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["custom_settings"]["words_per_day"] == 15
    # difficulty_level preserved from original
    assert data["config"]["custom_settings"]["difficulty_level"] == "easy"


async def test_patch_enable_disable(client):
    uid = await _create_user(client)
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": True},
    )
    resp = await client.patch(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": False},
    )
    assert resp.status_code == 200
    assert resp.json()["config"]["enabled"] is False


async def test_patch_no_fields_400(client):
    uid = await _create_user(client)
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": True},
    )
    resp = await client.patch(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={},
    )
    assert resp.status_code == 400


async def test_patch_creates_default_if_not_exists(client):
    uid = await _create_user(client)
    # Patch without prior create — should merge into defaults
    resp = await client.patch(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"custom_settings": {"words_per_day": 20}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["custom_settings"]["words_per_day"] == 20


# ---------------------------------------------------------------------------
# DELETE — DELETE /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


async def test_delete_feature_config(client):
    uid = await _create_user(client)
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": True},
    )
    resp = await client.delete(f"{BASE}/users/{uid}/features/vocab_learning/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted"] is True
    assert data["feature_name"] == "vocab_learning"

    # Verify it's gone
    resp = await client.get(f"{BASE}/users/{uid}/features/vocab_learning/config")
    assert resp.status_code == 404


async def test_delete_feature_config_not_found(client):
    uid = await _create_user(client)
    resp = await client.delete(f"{BASE}/users/{uid}/features/nonexistent/config")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE ALL — DELETE /users/{user_id}/features/config
# ---------------------------------------------------------------------------


async def test_delete_all_feature_configs(client):
    uid = await _create_user(client)
    await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={"enabled": True},
    )
    await client.post(
        f"{BASE}/users/{uid}/features/my_feature/config",
        json={"enabled": False},
    )

    resp = await client.delete(f"{BASE}/users/{uid}/features/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted"] is True
    assert data["deleted_count"] == 2

    # Verify empty
    resp = await client.get(f"{BASE}/users/{uid}/features/config")
    assert resp.json()["total"] == 0


async def test_delete_all_when_empty(client):
    uid = await _create_user(client)
    resp = await client.delete(f"{BASE}/users/{uid}/features/config")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is False
    assert resp.json()["deleted_count"] == 0


# ---------------------------------------------------------------------------
# SCHEMA — GET /features/{feature_name}/config/schema
# ---------------------------------------------------------------------------


async def test_get_feature_config_schema(client):
    resp = await client.get(f"{BASE}/features/vocab_learning/config/schema")
    assert resp.status_code == 200
    data = resp.json()
    assert data["feature_name"] == "vocab_learning"
    assert data["supports_frequency"] is True
    assert data["supports_schedule"] is True
    assert data["supports_difficulty"] is True
    assert len(data["options"]) > 0
    # Check a known option
    words_opt = next(o for o in data["options"] if o["key"] == "words_per_day")
    assert words_opt["type"] == "integer"
    assert words_opt["default"] == 5
    assert words_opt["constraints"]["min_value"] == 1
    assert words_opt["constraints"]["max_value"] == 50


async def test_get_schema_not_found(client):
    resp = await client.get(f"{BASE}/features/nonexistent/config/schema")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# VALIDATE — POST /features/{feature_name}/config/validate
# ---------------------------------------------------------------------------


async def test_validate_valid_config(client):
    resp = await client.post(
        f"{BASE}/features/vocab_learning/config/validate",
        json={
            "custom_settings": {"words_per_day": 10, "difficulty_level": "hard"},
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["schema_registered"] is True
    assert data["errors"] == []


async def test_validate_invalid_config(client):
    resp = await client.post(
        f"{BASE}/features/vocab_learning/config/validate",
        json={
            "custom_settings": {"words_per_day": 999},  # exceeds max
        },
    )
    assert resp.status_code == 200  # validate endpoint always returns 200
    data = resp.json()
    assert data["valid"] is False
    assert len(data["errors"]) > 0


async def test_validate_no_schema(client):
    resp = await client.post(
        f"{BASE}/features/unknown_feature/config/validate",
        json={"custom_settings": {"foo": "bar"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True  # no schema → no validation errors
    assert data["schema_registered"] is False


async def test_validate_with_frequency(client):
    resp = await client.post(
        f"{BASE}/features/vocab_learning/config/validate",
        json={
            "frequency": {"value": 3, "unit": "daily"},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


async def test_validate_invalid_frequency(client):
    """Frequency with hours > 24 should fail Pydantic validation."""
    resp = await client.post(
        f"{BASE}/features/vocab_learning/config/validate",
        json={
            "frequency": {"value": 99, "unit": "hours"},
        },
    )
    assert resp.status_code == 422  # Pydantic catches this before our logic


# ---------------------------------------------------------------------------
# Input validation — edge cases
# ---------------------------------------------------------------------------


async def test_feature_name_with_hyphens_ok(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/my-feature/config",
        json={"enabled": True},
    )
    assert resp.status_code == 201


async def test_feature_name_with_underscores_ok(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/my_feature/config",
        json={"enabled": True},
    )
    assert resp.status_code == 201


async def test_create_with_schedule(client):
    uid = await _create_user(client)
    resp = await client.post(
        f"{BASE}/users/{uid}/features/vocab_learning/config",
        json={
            "schedule": {
                "active_days": ["monday", "wednesday", "friday"],
                "timezone": "America/New_York",
            },
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert len(data["config"]["schedule"]["active_days"]) == 3
