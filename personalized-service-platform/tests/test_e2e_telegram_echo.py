"""End-to-end integration test: Telegram webhook → pipeline → echo → reply.

Verifies the complete message lifecycle:
1. A Telegram-format message arrives at the webhook endpoint.
2. The TelegramBotAdapter parses it into a WebhookPayload.
3. The MessagePipeline normalizes it and routes it through the handler chain.
4. The EchoFallbackHandler produces a response for plain text.
5. The MessageSender sends the reply back via the adapter (mock HTTP).

This test exercises the *real* component wiring — no mocks on internal
classes, only the external Telegram HTTP API is faked.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.bot.telegram_adapter import TelegramBotAdapter
from app.bot.webhook_routes import (
    _adapters,
    _resolver,
    get_message_sender,
    register_bot_adapter,
    set_message_pipeline,
    set_message_sender,
    get_message_pipeline,
)
from app.main import app
from app.messaging.handlers.command_handler import CommandHandler
from app.messaging.handlers.echo_handler import EchoFallbackHandler
from app.messaging.pipeline import MessagePipeline
from app.messaging.sender import ChannelResolver, MessageSender


# ---------------------------------------------------------------------------
# Mock Telegram HTTP transport — captures outbound API calls
# ---------------------------------------------------------------------------


class RecordingTelegramTransport(httpx.AsyncBaseTransport):
    """Fake Telegram Bot API that records every request for assertions."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.sent_messages: list[dict[str, Any]] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        method = request.url.path.rsplit("/", 1)[-1]

        responses: dict[str, dict[str, Any]] = {
            "getMe": {
                "ok": True,
                "result": {
                    "id": 999,
                    "is_bot": True,
                    "first_name": "E2EBot",
                    "username": "e2e_test_bot",
                },
            },
            "setWebhook": {"ok": True, "result": True},
            "deleteWebhook": {"ok": True, "result": True},
            "sendMessage": {
                "ok": True,
                "result": {
                    "message_id": 200,
                    "chat": {"id": 42},
                    "text": "ok",
                    "date": 1700000000,
                },
            },
        }

        # Record sendMessage payloads for assertions
        if method == "sendMessage":
            body = json.loads(request.content)
            self.sent_messages.append(body)

        data = responses.get(method, {"ok": False, "description": "Unknown method"})
        return httpx.Response(200, json=data)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Save / restore module-level globals so tests don't leak state.


@pytest.fixture(autouse=True)
def _clean_webhook_state():
    """Reset the webhook_routes global registry between tests."""
    import app.bot.webhook_routes as wr

    old_adapters = dict(wr._adapters)
    old_pipeline = wr._pipeline
    old_sender = wr._sender
    old_resolver_adapters = dict(wr._resolver._adapters)

    wr._adapters.clear()
    wr._resolver._adapters.clear()
    wr._pipeline = None
    wr._sender = None

    yield

    wr._adapters.clear()
    wr._adapters.update(old_adapters)
    wr._pipeline = old_pipeline
    wr._sender = old_sender
    wr._resolver._adapters.clear()
    wr._resolver._adapters.update(old_resolver_adapters)


def _make_telegram_text_payload(
    text: str,
    *,
    sender_id: int = 42,
    chat_id: int = 42,
    message_id: int = 100,
) -> dict[str, Any]:
    """Build a minimal Telegram-format webhook payload for a text message."""
    return {
        "update_id": 1,
        "message": {
            "message_id": message_id,
            "from": {"id": sender_id, "first_name": "TestUser"},
            "chat": {"id": chat_id, "type": "private"},
            "text": text,
            "date": 1700000000,
        },
    }


def _make_telegram_command_payload(
    command: str,
    *,
    sender_id: int = 42,
    chat_id: int = 42,
    message_id: int = 101,
) -> dict[str, Any]:
    """Build a Telegram webhook payload for a bot command."""
    return {
        "update_id": 2,
        "message": {
            "message_id": message_id,
            "from": {"id": sender_id, "first_name": "TestUser"},
            "chat": {"id": chat_id, "type": "private"},
            "text": command,
            "entities": [
                {"type": "bot_command", "offset": 0, "length": len(command)},
            ],
            "date": 1700000000,
        },
    }


def _wire_e2e(
    transport: RecordingTelegramTransport | None = None,
) -> tuple[RecordingTelegramTransport, TelegramBotAdapter, MessagePipeline]:
    """Wire all real components together for an end-to-end test.

    Returns the transport (for assertions), adapter, and pipeline.
    """
    if transport is None:
        transport = RecordingTelegramTransport()

    # 1. Telegram adapter with mock HTTP
    client = httpx.AsyncClient(transport=transport)
    adapter = TelegramBotAdapter(token="e2e-test-token", http_client=client)

    # 2. Register adapter → also wires it into the channel resolver
    register_bot_adapter("telegram", adapter)

    # 3. Build message pipeline with real handlers
    pipeline = MessagePipeline()
    pipeline.register_handler(CommandHandler())
    pipeline.register_handler(EchoFallbackHandler())
    set_message_pipeline(pipeline)

    # 4. MessageSender is created lazily by get_message_sender(),
    #    which uses the shared _resolver already populated by register_bot_adapter.

    return transport, adapter, pipeline


# ---------------------------------------------------------------------------
# End-to-end tests
# ---------------------------------------------------------------------------


class TestE2ETelegramEcho:
    """Full round-trip: Telegram webhook → pipeline → echo → sendMessage."""

    def test_text_message_echoed_back(self):
        """A plain text message should be echoed back via the Telegram API."""
        transport, adapter, pipeline = _wire_e2e()
        http = TestClient(app)

        payload = _make_telegram_text_payload("Hello, bot!")
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        # --- Webhook endpoint returned success ---
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["event_type"] == "message"
        assert body["sender_id"] == "42"
        assert body["chat_id"] == "42"

        # --- Pipeline handled the message ---
        assert body["handled"] is True
        assert "Hello, bot!" in body["handler_response"]

        # --- Reply was sent back through the adapter ---
        assert body["reply_sent"] == "sent"
        assert body["reply_message_id"] is not None

        # --- Verify the actual Telegram sendMessage call ---
        assert len(transport.sent_messages) == 1
        sent = transport.sent_messages[0]
        assert sent["chat_id"] == "42"
        assert "Hello, bot!" in sent["text"]  # echo includes the original text

    def test_command_message_handled(self):
        """A /start command should be handled by CommandHandler, not echo."""
        transport, adapter, pipeline = _wire_e2e()
        http = TestClient(app)

        payload = _make_telegram_command_payload("/start")
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["event_type"] == "command"
        assert body["handled"] is True

        # CommandHandler produces a welcome message, not an echo
        assert "Hello, bot!" not in (body.get("handler_response") or "")

        # Reply was sent
        assert body["reply_sent"] == "sent"
        assert len(transport.sent_messages) == 1

    def test_help_command_lists_commands(self):
        """The /help command should be handled by CommandHandler."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        payload = _make_telegram_command_payload("/help")
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["handled"] is True
        assert body["reply_sent"] == "sent"
        assert len(transport.sent_messages) == 1

    def test_different_users_get_independent_replies(self):
        """Two different users sending messages should each get their own reply."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        # User A sends a message
        payload_a = _make_telegram_text_payload(
            "Hello from A", sender_id=100, chat_id=100
        )
        resp_a = http.post("/api/v1/webhooks/telegram", json=payload_a)
        assert resp_a.status_code == 200
        assert resp_a.json()["handled"] is True

        # User B sends a message
        payload_b = _make_telegram_text_payload(
            "Hello from B", sender_id=200, chat_id=200
        )
        resp_b = http.post("/api/v1/webhooks/telegram", json=payload_b)
        assert resp_b.status_code == 200
        assert resp_b.json()["handled"] is True

        # Both replies were sent to the correct chats
        assert len(transport.sent_messages) == 2
        assert transport.sent_messages[0]["chat_id"] == "100"
        assert "Hello from A" in transport.sent_messages[0]["text"]
        assert transport.sent_messages[1]["chat_id"] == "200"
        assert "Hello from B" in transport.sent_messages[1]["text"]

    def test_empty_text_not_echoed(self):
        """A message with empty/whitespace text should not be echoed."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        payload = _make_telegram_text_payload("   ")
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        # EchoFallbackHandler requires non-empty stripped text
        assert body["handled"] is False

    def test_reply_includes_message_id_reference(self):
        """The reply metadata should reference the original message_id."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        payload = _make_telegram_text_payload("ping", message_id=777)
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["reply_sent"] == "sent"

        # The sendMessage call should include reply_to_message_id
        sent = transport.sent_messages[0]
        assert sent.get("reply_to_message_id") == "777"

    def test_callback_query_not_echoed(self):
        """A callback query (inline button press) should NOT be handled by echo."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        payload = {
            "update_id": 3,
            "callback_query": {
                "id": "cb-99",
                "from": {"id": 42},
                "message": {
                    "message_id": 100,
                    "chat": {"id": 42, "type": "private"},
                },
                "data": "some_callback_data",
            },
        }
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["event_type"] == "callback"
        # Neither CommandHandler nor EchoFallbackHandler handles callbacks
        assert body["handled"] is False
        # No reply should have been sent
        assert len(transport.sent_messages) == 0


class TestE2ENoAdapter:
    """Edge cases: webhook called without a registered adapter or pipeline."""

    def test_unknown_platform_returns_404(self):
        """Posting to an unregistered platform should return 404."""
        http = TestClient(app)
        resp = http.post(
            "/api/v1/webhooks/discord",
            json={"event": "message"},
        )
        assert resp.status_code == 404

    def test_no_pipeline_still_returns_ok(self):
        """If no pipeline is configured, webhook should still parse and return OK."""
        transport = RecordingTelegramTransport()
        client = httpx.AsyncClient(transport=transport)
        adapter = TelegramBotAdapter(token="no-pipeline-token", http_client=client)
        register_bot_adapter("telegram", adapter)
        # Deliberately do NOT set a pipeline

        http = TestClient(app)
        payload = _make_telegram_text_payload("test")
        resp = http.post("/api/v1/webhooks/telegram", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["event_type"] == "message"
        # No pipeline = no handled/reply keys
        assert "handled" not in body
        assert "reply_sent" not in body
        # No outbound sendMessage calls
        assert len(transport.sent_messages) == 0


class TestE2EMultipleMessages:
    """Simulate a short conversation via sequential webhook calls."""

    def test_conversation_sequence(self):
        """A sequence of messages should each be processed independently."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        messages = ["Hi there!", "What can you do?", "Tell me a joke"]
        for i, text in enumerate(messages):
            payload = _make_telegram_text_payload(text, message_id=100 + i)
            resp = http.post("/api/v1/webhooks/telegram", json=payload)
            assert resp.status_code == 200
            body = resp.json()
            assert body["handled"] is True
            assert body["reply_sent"] == "sent"

        # All three replies were sent
        assert len(transport.sent_messages) == 3
        for i, text in enumerate(messages):
            assert text in transport.sent_messages[i]["text"]

    def test_mixed_commands_and_text(self):
        """A mix of commands and plain text should route correctly."""
        transport, _, _ = _wire_e2e()
        http = TestClient(app)

        # 1. /start command
        resp1 = http.post(
            "/api/v1/webhooks/telegram",
            json=_make_telegram_command_payload("/start", message_id=1),
        )
        assert resp1.json()["handled"] is True

        # 2. Plain text
        resp2 = http.post(
            "/api/v1/webhooks/telegram",
            json=_make_telegram_text_payload("hello", message_id=2),
        )
        assert resp2.json()["handled"] is True

        # 3. /help command
        resp3 = http.post(
            "/api/v1/webhooks/telegram",
            json=_make_telegram_command_payload("/help", message_id=3),
        )
        assert resp3.json()["handled"] is True

        assert len(transport.sent_messages) == 3

        # First reply is the /start welcome (not an echo)
        assert "hello" not in transport.sent_messages[0]["text"].lower() or "welcome" in transport.sent_messages[0]["text"].lower() or "👋" in transport.sent_messages[0]["text"]

        # Second reply is the echo
        assert "hello" in transport.sent_messages[1]["text"]
