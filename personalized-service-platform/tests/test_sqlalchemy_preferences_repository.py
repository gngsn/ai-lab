"""Tests for the SQLAlchemy preferences repository.

Verifies that :class:`SQLAlchemyPreferencesRepository` correctly implements
the :class:`PreferencesRepository` protocol using an in-memory SQLite database.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.schemas import Base, User
from app.services.preferences_repository_protocol import PreferencesRepository
from app.services.sqlalchemy_preferences_repository import SQLAlchemyPreferencesRepository


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as sess:
        # Create a test user
        user = User(id="user-1", name="Test User")
        sess.add(user)
        await sess.commit()
        yield sess

    await engine.dispose()


@pytest.fixture
def repo(session) -> SQLAlchemyPreferencesRepository:
    return SQLAlchemyPreferencesRepository(session)


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_implements_protocol():
    """SQLAlchemyPreferencesRepository satisfies the PreferencesRepository protocol."""
    assert issubclass(SQLAlchemyPreferencesRepository, PreferencesRepository)


# ---------------------------------------------------------------------------
# get / set
# ---------------------------------------------------------------------------


async def test_set_and_get(repo):
    rec = await repo.set("user-1", "vocab.level", "hard")
    assert rec.preference_key == "vocab.level"
    assert rec.preference_value == "hard"
    assert rec.user_id == "user-1"
    assert rec.id

    fetched = await repo.get("user-1", "vocab.level")
    assert fetched is not None
    assert fetched.preference_value == "hard"


async def test_get_nonexistent(repo):
    result = await repo.get("user-1", "no.such.key")
    assert result is None


async def test_upsert_updates_value(repo):
    await repo.set("user-1", "vocab.level", "easy")
    rec = await repo.set("user-1", "vocab.level", "advanced")
    assert rec.preference_value == "advanced"

    # Only one record should exist
    all_prefs = await repo.get_all("user-1")
    assert len(all_prefs) == 1


async def test_set_complex_values(repo):
    # Dict
    await repo.set("user-1", "vocab.schedule", {"freq": "daily", "time": "09:00"})
    rec = await repo.get("user-1", "vocab.schedule")
    assert rec.preference_value["freq"] == "daily"

    # List
    await repo.set("user-1", "vocab.topics", ["business", "tech"])
    rec = await repo.get("user-1", "vocab.topics")
    assert rec.preference_value == ["business", "tech"]

    # Number
    await repo.set("user-1", "vocab.count", 15)
    rec = await repo.get("user-1", "vocab.count")
    assert rec.preference_value == 15

    # Boolean
    await repo.set("user-1", "vocab.enabled", True)
    rec = await repo.get("user-1", "vocab.enabled")
    assert rec.preference_value is True


# ---------------------------------------------------------------------------
# get_all with prefix filtering
# ---------------------------------------------------------------------------


async def test_get_all(repo):
    await repo.set("user-1", "vocab.level", "hard")
    await repo.set("user-1", "vocab.topics", ["tech"])
    await repo.set("user-1", "delivery.channels", ["chat"])

    all_prefs = await repo.get_all("user-1")
    assert len(all_prefs) == 3


async def test_get_all_with_prefix(repo):
    await repo.set("user-1", "vocab.level", "hard")
    await repo.set("user-1", "vocab.topics", ["tech"])
    await repo.set("user-1", "delivery.channels", ["chat"])

    vocab_prefs = await repo.get_all("user-1", prefix="vocab")
    assert len(vocab_prefs) == 2
    assert all(p.preference_key.startswith("vocab") for p in vocab_prefs)

    delivery_prefs = await repo.get_all("user-1", prefix="delivery")
    assert len(delivery_prefs) == 1


async def test_get_all_empty(repo):
    result = await repo.get_all("user-1")
    assert result == []


async def test_get_all_ordered_by_key(repo):
    await repo.set("user-1", "z.last", "z")
    await repo.set("user-1", "a.first", "a")
    await repo.set("user-1", "m.middle", "m")

    prefs = await repo.get_all("user-1")
    keys = [p.preference_key for p in prefs]
    assert keys == sorted(keys)


# ---------------------------------------------------------------------------
# set_bulk
# ---------------------------------------------------------------------------


async def test_set_bulk(repo):
    records = await repo.set_bulk("user-1", {
        "vocab.level": "hard",
        "vocab.count": 20,
        "delivery.channels": ["chat", "email"],
    })
    assert len(records) == 3
    all_prefs = await repo.get_all("user-1")
    assert len(all_prefs) == 3


async def test_set_bulk_empty(repo):
    records = await repo.set_bulk("user-1", {})
    assert records == []


async def test_set_bulk_upserts(repo):
    await repo.set("user-1", "vocab.level", "easy")
    records = await repo.set_bulk("user-1", {
        "vocab.level": "hard",
        "vocab.new_key": "value",
    })
    assert len(records) == 2

    # Original key was updated, not duplicated
    all_prefs = await repo.get_all("user-1")
    assert len(all_prefs) == 2
    level = await repo.get("user-1", "vocab.level")
    assert level.preference_value == "hard"


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


async def test_delete_existing(repo):
    await repo.set("user-1", "vocab.temp", "delete_me")
    assert await repo.delete("user-1", "vocab.temp") is True
    assert await repo.get("user-1", "vocab.temp") is None


async def test_delete_nonexistent(repo):
    assert await repo.delete("user-1", "no.such.key") is False
