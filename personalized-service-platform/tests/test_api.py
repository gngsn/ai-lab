"""End-to-end API tests for preference endpoints using the repository layer."""

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


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# User creation
# ---------------------------------------------------------------------------


async def _create_user(client, name: str = "Alice") -> str:
    resp = await client.post("/api/v1/users", json={"name": name})
    assert resp.status_code == 200
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Preferences — CRUD via repository-backed endpoints
# ---------------------------------------------------------------------------


async def test_set_and_get_preference(client):
    user_id = await _create_user(client)

    # Set a preference
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.difficulty_level", "preference_value": "hard"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["preference_key"] == "vocab.difficulty_level"
    assert body["preference_value"] == "hard"
    assert body["user_id"] == user_id
    assert body["id"]  # generated UUID

    # Get it back
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/vocab.difficulty_level")
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == "hard"


async def test_upsert_preference_updates_value(client):
    user_id = await _create_user(client)

    # Create
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.level", "preference_value": "easy"},
    )
    # Update
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.level", "preference_value": "advanced"},
    )
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == "advanced"


async def test_set_preference_complex_value(client):
    """Preferences support JSON objects, arrays, numbers, booleans."""
    user_id = await _create_user(client)

    # Object value
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={
            "preference_key": "vocab.schedule",
            "preference_value": {"frequency": "daily", "time": "09:00", "timezone": "Asia/Seoul"},
        },
    )
    assert resp.status_code == 200
    val = resp.json()["preference_value"]
    assert val["frequency"] == "daily"
    assert val["timezone"] == "Asia/Seoul"

    # Array value
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.topics", "preference_value": ["business", "travel", "tech"]},
    )
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == ["business", "travel", "tech"]

    # Numeric value
    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.daily_count", "preference_value": 15},
    )
    assert resp.status_code == 200
    assert resp.json()["preference_value"] == 15


async def test_list_preferences(client):
    user_id = await _create_user(client)

    # Set several preferences
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.level", "preference_value": "intermediate"},
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.topics", "preference_value": ["idioms"]},
    )
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "delivery.channels", "preference_value": ["chat"]},
    )

    # List all
    resp = await client.get(f"/api/v1/users/{user_id}/preferences")
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id
    assert len(body["preferences"]) == 3

    # Filter by prefix
    resp = await client.get(f"/api/v1/users/{user_id}/preferences?prefix=vocab")
    assert resp.status_code == 200
    assert len(resp.json()["preferences"]) == 2

    resp = await client.get(f"/api/v1/users/{user_id}/preferences?prefix=delivery")
    assert resp.status_code == 200
    assert len(resp.json()["preferences"]) == 1


async def test_bulk_set_preferences(client):
    user_id = await _create_user(client)

    resp = await client.put(
        f"/api/v1/users/{user_id}/preferences/bulk",
        json={
            "preferences": {
                "vocab.level": "hard",
                "vocab.daily_count": 20,
                "delivery.channels": ["chat", "email"],
            }
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["preferences"]) == 3


async def test_delete_preference(client):
    user_id = await _create_user(client)

    # Create then delete
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "vocab.temp", "preference_value": "delete_me"},
    )
    resp = await client.delete(f"/api/v1/users/{user_id}/preferences/vocab.temp")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == "vocab.temp"

    # Confirm gone
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/vocab.temp")
    assert resp.status_code == 404


async def test_delete_nonexistent_preference(client):
    user_id = await _create_user(client)
    resp = await client.delete(f"/api/v1/users/{user_id}/preferences/no.such.key")
    assert resp.status_code == 404


async def test_get_nonexistent_preference(client):
    user_id = await _create_user(client)
    resp = await client.get(f"/api/v1/users/{user_id}/preferences/nope")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delivery flow (preferences → channel routing)
# ---------------------------------------------------------------------------


async def test_deliver_with_preferences(client):
    user_id = await _create_user(client)

    # Set delivery channel preference
    await client.put(
        f"/api/v1/users/{user_id}/preferences",
        json={"preference_key": "delivery.channels", "preference_value": ["chat"]},
    )

    # Deliver content
    resp = await client.post(
        f"/api/v1/users/{user_id}/deliver",
        json={"content": {"word": "serendipity", "meaning": "finding good things by chance"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["delivered_to"]) == 1
    assert body["delivered_to"][0]["channel"] == "chat"


async def test_deliver_without_preferences_fails(client):
    user_id = await _create_user(client)
    resp = await client.post(
        f"/api/v1/users/{user_id}/deliver",
        json={"content": {"text": "hello"}},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Service registration
# ---------------------------------------------------------------------------


async def test_register_and_list_services(client):
    resp = await client.post(
        "/api/v1/services",
        json={
            "name": "vocab-learning",
            "description": "Learn vocabulary your way",
            "available_features": ["words", "phrases"],
            "available_channels": ["chat", "email"],
        },
    )
    assert resp.status_code == 200
    service = resp.json()
    assert service["name"] == "vocab-learning"

    resp = await client.get("/api/v1/services")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
