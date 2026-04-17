"""Tests for webhook routes — FastAPI endpoint integration tests."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.bot.adapter import ConnectionInfo, ConnectionState
from app.bot.telegram_adapter import TelegramBotAdapter
from app.bot.webhook_routes import (
    _adapters,
    register_bot_adapter,
    webhook_router,
)
from app.main import app


@pytest.fixture(autouse=True)
def _clear_adapters():
    """Ensure adapter registry is clean between tests."""
    _adapters.clear()
    yield
    _adapters.clear()


class MockTransport(httpx.AsyncBaseTransport):
    """Minimal mock transport for adapter tests."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        responses = {
            "getMe": {"ok": True, "result": {"id": 1, "username": "testbot"}},
            "setWebhook": {"ok": True, "result": True},
            "deleteWebhook": {"ok": True, "result": True},
            "sendMessage": {"ok": True, "result": {"message_id": 1}},
        }
        data = responses.get(method, {"ok": False, "description": "unknown"})
        return httpx.Response(200, json=data)


def _make_test_adapter() -> TelegramBotAdapter:
    client = httpx.AsyncClient(transport=MockTransport())
    return TelegramBotAdapter(token="test", http_client=client)


class TestReceiveWebhook:
    def test_receive_webhook_unknown_platform(self):
        client = TestClient(app)
        resp = client.post(
            "/api/v1/webhooks/unknown",
            json={"update_id": 1},
        )
        assert resp.status_code == 404

    def test_receive_webhook_telegram(self):
        adapter = _make_test_adapter()
        register_bot_adapter("telegram", adapter)
        client = TestClient(app)
        resp = client.post(
            "/api/v1/webhooks/telegram",
            json={
                "update_id": 1,
                "message": {
                    "message_id": 100,
                    "from": {"id": 42},
                    "chat": {"id": 42, "type": "private"},
                    "text": "hello",
                    "date": 1700000000,
                },
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["event_type"] == "message"
        assert body["sender_id"] == "42"

    def test_receive_webhook_invalid_json(self):
        adapter = _make_test_adapter()
        register_bot_adapter("telegram", adapter)
        client = TestClient(app)
        resp = client.post(
            "/api/v1/webhooks/telegram",
            content=b"not json",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400


class TestBotStatus:
    def test_status_unknown_platform(self):
        client = TestClient(app)
        resp = client.get("/api/v1/webhooks/unknown/status")
        assert resp.status_code == 404

    def test_status_returns_connection_info(self):
        adapter = _make_test_adapter()
        register_bot_adapter("telegram", adapter)
        client = TestClient(app)
        resp = client.get("/api/v1/webhooks/telegram/status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["platform"] == "telegram"
        assert body["state"] == "disconnected"


class TestListAdapters:
    def test_list_empty(self):
        client = TestClient(app)
        resp = client.get("/api/v1/webhooks/")
        assert resp.status_code == 200
        assert resp.json()["adapters"] == []

    def test_list_with_adapter(self):
        adapter = _make_test_adapter()
        register_bot_adapter("telegram", adapter)
        client = TestClient(app)
        resp = client.get("/api/v1/webhooks/")
        assert resp.status_code == 200
        adapters = resp.json()["adapters"]
        assert len(adapters) == 1
        assert adapters[0]["platform"] == "telegram"


class TestWebhookRegistrationRoutes:
    def test_register_webhook_unknown_platform(self):
        client = TestClient(app)
        resp = client.post(
            "/api/v1/webhooks/unknown/register",
            json={"webhook_url": "https://example.com/hook"},
        )
        assert resp.status_code == 404

    def test_unregister_webhook_unknown_platform(self):
        client = TestClient(app)
        resp = client.delete("/api/v1/webhooks/unknown/register")
        assert resp.status_code == 404
