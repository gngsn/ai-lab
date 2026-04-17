"""Tests for user registration endpoint (POST /api/users/register)."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password, verify_password
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
# Password hashing utilities
# ---------------------------------------------------------------------------


def test_hash_password_returns_bcrypt_hash():
    hashed = hash_password("Secret123")
    assert hashed.startswith("$2")  # bcrypt prefix
    assert hashed != "Secret123"


def test_verify_password_correct():
    hashed = hash_password("MyPass99")
    assert verify_password("MyPass99", hashed) is True


def test_verify_password_incorrect():
    hashed = hash_password("MyPass99")
    assert verify_password("WrongPass1", hashed) is False


# ---------------------------------------------------------------------------
# Registration endpoint
# ---------------------------------------------------------------------------


async def test_register_user_success(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Alice", "email": "alice@example.com", "password": "Secure123"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Alice"
    assert body["email"] == "alice@example.com"
    assert body["id"]  # UUID generated
    # Password must NOT be in response
    assert "password" not in body
    assert "password_hash" not in body


async def test_register_user_duplicate_email(client):
    payload = {"name": "Bob", "email": "bob@example.com", "password": "Secure123"}
    resp1 = await client.post("/api/v1/users/register", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/v1/users/register", json=payload)
    assert resp2.status_code == 409
    assert "already registered" in resp2.json()["detail"].lower()


async def test_register_user_invalid_email(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Charlie", "email": "not-an-email", "password": "Secure123"},
    )
    assert resp.status_code == 422  # Pydantic validation error


async def test_register_user_password_too_short(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Dave", "email": "dave@example.com", "password": "Ab1"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("8 characters" in str(e) for e in detail)


async def test_register_user_password_no_digit(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Eve", "email": "eve@example.com", "password": "NoDigitsHere"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("digit" in str(e) for e in detail)


async def test_register_user_password_no_letter(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Frank", "email": "frank@example.com", "password": "12345678"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("letter" in str(e) for e in detail)


async def test_register_user_empty_name(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "   ", "email": "space@example.com", "password": "Secure123"},
    )
    assert resp.status_code == 422


async def test_register_user_name_too_long(client):
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "A" * 101, "email": "long@example.com", "password": "Secure123"},
    )
    assert resp.status_code == 422


async def test_register_user_missing_fields(client):
    # Missing password
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Grace", "email": "grace@example.com"},
    )
    assert resp.status_code == 422

    # Missing email
    resp = await client.post(
        "/api/v1/users/register",
        json={"name": "Grace", "password": "Secure123"},
    )
    assert resp.status_code == 422

    # Missing name
    resp = await client.post(
        "/api/v1/users/register",
        json={"email": "grace@example.com", "password": "Secure123"},
    )
    assert resp.status_code == 422
