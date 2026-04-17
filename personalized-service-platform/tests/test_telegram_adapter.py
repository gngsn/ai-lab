"""Tests for TelegramBotAdapter — connection lifecycle, webhook handling, messaging."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest

from app.bot.adapter import BotAdapter, ConnectionInfo, ConnectionState
from app.bot.telegram_adapter import TelegramBotAdapter
from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    DeliveryChannel,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.messenger import (
    Button,
    ButtonStyle,
    MessengerBotChannel,
    QuickReply,
    UserProfile,
    WebhookEvent,
    WebhookPayload,
)


# ---------------------------------------------------------------------------
# Helpers — mock Telegram API via httpx transport
# ---------------------------------------------------------------------------


class MockTelegramTransport(httpx.AsyncBaseTransport):
    """Fake HTTP transport that simulates the Telegram Bot API."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self._responses: dict[str, dict[str, Any]] = {
            "getMe": {
                "ok": True,
                "result": {
                    "id": 123456,
                    "is_bot": True,
                    "first_name": "TestBot",
                    "username": "test_bot",
                },
            },
            "setWebhook": {"ok": True, "result": True},
            "deleteWebhook": {"ok": True, "result": True},
            "sendMessage": {
                "ok": True,
                "result": {
                    "message_id": 42,
                    "chat": {"id": 100},
                    "text": "ok",
                    "date": 1700000000,
                },
            },
            "getChat": {
                "ok": True,
                "result": {
                    "id": 100,
                    "type": "private",
                    "first_name": "Alice",
                    "last_name": "Smith",
                    "username": "alice_s",
                },
            },
        }

    def set_response(self, method: str, response: dict[str, Any]) -> None:
        self._responses[method] = response

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        # Extract the API method from the URL path
        path = request.url.path
        method = path.rsplit("/", 1)[-1]
        response_data = self._responses.get(method, {"ok": False, "description": "Unknown method"})
        return httpx.Response(
            status_code=200,
            json=response_data,
        )


def _make_adapter(transport: MockTelegramTransport | None = None) -> tuple[TelegramBotAdapter, MockTelegramTransport]:
    """Create a TelegramBotAdapter with a mock transport."""
    if transport is None:
        transport = MockTelegramTransport()
    client = httpx.AsyncClient(transport=transport)
    adapter = TelegramBotAdapter(
        token="test-token-123",
        api_base_url="https://api.telegram.org",
        http_client=client,
    )
    return adapter, transport


# ---------------------------------------------------------------------------
# Inheritance / interface tests
# ---------------------------------------------------------------------------


class TestTelegramAdapterInterface:
    """Verify that TelegramBotAdapter correctly implements the adapter hierarchy."""

    def test_is_bot_adapter(self):
        adapter, _ = _make_adapter()
        assert isinstance(adapter, BotAdapter)

    def test_is_messenger_bot_channel(self):
        adapter, _ = _make_adapter()
        assert isinstance(adapter, MessengerBotChannel)

    def test_is_delivery_channel(self):
        adapter, _ = _make_adapter()
        assert isinstance(adapter, DeliveryChannel)

    def test_requires_token(self):
        with pytest.raises(ValueError, match="must not be empty"):
            TelegramBotAdapter(token="")

    def test_initial_state_is_disconnected(self):
        adapter, _ = _make_adapter()
        info = adapter.get_connection_info()
        assert info.state == ConnectionState.DISCONNECTED
        assert not adapter.is_connected


# ---------------------------------------------------------------------------
# Connection lifecycle
# ---------------------------------------------------------------------------


class TestConnect:
    @pytest.mark.asyncio
    async def test_connect_success(self):
        adapter, transport = _make_adapter()
        info = await adapter.connect()
        assert info.state == ConnectionState.CONNECTED
        assert info.bot_id == "123456"
        assert info.bot_username == "test_bot"
        assert info.last_error is None
        assert adapter.is_connected

    @pytest.mark.asyncio
    async def test_connect_failure(self):
        transport = MockTelegramTransport()
        transport.set_response("getMe", {"ok": False, "description": "Unauthorized"})
        adapter, _ = _make_adapter(transport)
        info = await adapter.connect()
        assert info.state == ConnectionState.ERROR
        assert "Unauthorized" in (info.last_error or "")
        assert not adapter.is_connected

    @pytest.mark.asyncio
    async def test_connect_calls_get_me(self):
        adapter, transport = _make_adapter()
        await adapter.connect()
        assert len(transport.requests) == 1
        assert transport.requests[0].url.path.endswith("/getMe")


class TestDisconnect:
    @pytest.mark.asyncio
    async def test_disconnect_resets_state(self):
        adapter, _ = _make_adapter()
        await adapter.connect()
        assert adapter.is_connected
        info = await adapter.disconnect()
        assert info.state == ConnectionState.DISCONNECTED
        assert info.bot_id is None
        assert info.bot_username is None
        assert not adapter.is_connected

    @pytest.mark.asyncio
    async def test_disconnect_removes_webhook(self):
        adapter, transport = _make_adapter()
        await adapter.connect()
        await adapter.register_webhook("https://example.com/hook")
        info = await adapter.disconnect()
        assert not info.webhook_active
        assert info.webhook_url is None
        # Should have called deleteWebhook
        methods_called = [r.url.path.rsplit("/", 1)[-1] for r in transport.requests]
        assert "deleteWebhook" in methods_called


# ---------------------------------------------------------------------------
# Webhook registration
# ---------------------------------------------------------------------------


class TestWebhookRegistration:
    @pytest.mark.asyncio
    async def test_register_webhook_success(self):
        adapter, transport = _make_adapter()
        await adapter.connect()
        success = await adapter.register_webhook("https://example.com/webhook/telegram")
        assert success is True
        info = adapter.get_connection_info()
        assert info.webhook_active
        assert info.webhook_url == "https://example.com/webhook/telegram"

    @pytest.mark.asyncio
    async def test_register_webhook_failure(self):
        transport = MockTelegramTransport()
        transport.set_response("setWebhook", {"ok": False, "description": "Bad URL"})
        adapter, _ = _make_adapter(transport)
        await adapter.connect()
        success = await adapter.register_webhook("bad://url")
        assert success is False
        info = adapter.get_connection_info()
        assert not info.webhook_active

    @pytest.mark.asyncio
    async def test_unregister_webhook_success(self):
        adapter, _ = _make_adapter()
        await adapter.connect()
        await adapter.register_webhook("https://example.com/hook")
        success = await adapter.unregister_webhook()
        assert success is True
        info = adapter.get_connection_info()
        assert not info.webhook_active
        assert info.webhook_url is None

    @pytest.mark.asyncio
    async def test_register_webhook_sends_correct_payload(self):
        adapter, transport = _make_adapter()
        await adapter.connect()
        await adapter.register_webhook("https://mysite.com/api/v1/webhooks/telegram")
        # Find the setWebhook request
        webhook_req = [r for r in transport.requests if "setWebhook" in r.url.path][0]
        body = json.loads(webhook_req.content)
        assert body["url"] == "https://mysite.com/api/v1/webhooks/telegram"


# ---------------------------------------------------------------------------
# handle_webhook — inbound event parsing
# ---------------------------------------------------------------------------


class TestHandleWebhook:
    @pytest.mark.asyncio
    async def test_parse_text_message(self):
        adapter, _ = _make_adapter()
        payload = {
            "update_id": 1,
            "message": {
                "message_id": 100,
                "from": {"id": 42, "first_name": "Alice"},
                "chat": {"id": 42, "type": "private"},
                "text": "Hello bot!",
                "date": 1700000000,
            },
        }
        result = await adapter.handle_webhook(payload)
        assert isinstance(result, WebhookPayload)
        assert result.event_type == WebhookEvent.MESSAGE
        assert result.sender_id == "42"
        assert result.chat_id == "42"
        assert result.text == "Hello bot!"
        assert result.message_id == "100"
        assert result.raw == payload

    @pytest.mark.asyncio
    async def test_parse_command_message(self):
        adapter, _ = _make_adapter()
        payload = {
            "update_id": 2,
            "message": {
                "message_id": 101,
                "from": {"id": 42},
                "chat": {"id": 42, "type": "private"},
                "text": "/start",
                "entities": [{"type": "bot_command", "offset": 0, "length": 6}],
                "date": 1700000000,
            },
        }
        result = await adapter.handle_webhook(payload)
        assert result.event_type == WebhookEvent.COMMAND
        assert result.text == "/start"

    @pytest.mark.asyncio
    async def test_parse_callback_query(self):
        adapter, _ = _make_adapter()
        payload = {
            "update_id": 3,
            "callback_query": {
                "id": "cb-1",
                "from": {"id": 42},
                "message": {
                    "message_id": 100,
                    "chat": {"id": 42, "type": "private"},
                },
                "data": "answer_yes",
            },
        }
        result = await adapter.handle_webhook(payload)
        assert result.event_type == WebhookEvent.CALLBACK
        assert result.callback_data == "answer_yes"
        assert result.sender_id == "42"
        assert result.chat_id == "42"

    @pytest.mark.asyncio
    async def test_parse_member_join(self):
        adapter, _ = _make_adapter()
        payload = {
            "update_id": 4,
            "my_chat_member": {
                "from": {"id": 99},
                "chat": {"id": -100, "type": "group"},
                "new_chat_member": {"status": "member", "user": {"id": 123}},
            },
        }
        result = await adapter.handle_webhook(payload)
        assert result.event_type == WebhookEvent.MEMBER_JOIN

    @pytest.mark.asyncio
    async def test_parse_member_leave(self):
        adapter, _ = _make_adapter()
        payload = {
            "update_id": 5,
            "my_chat_member": {
                "from": {"id": 99},
                "chat": {"id": -100, "type": "group"},
                "new_chat_member": {"status": "kicked", "user": {"id": 123}},
            },
        }
        result = await adapter.handle_webhook(payload)
        assert result.event_type == WebhookEvent.MEMBER_LEAVE

    @pytest.mark.asyncio
    async def test_parse_unknown_event(self):
        adapter, _ = _make_adapter()
        result = await adapter.handle_webhook({"update_id": 99, "unknown_field": {}})
        assert result.event_type == WebhookEvent.UNKNOWN
        assert result.sender_id == ""
        assert result.chat_id == ""


# ---------------------------------------------------------------------------
# send_message
# ---------------------------------------------------------------------------


class TestSendMessage:
    @pytest.mark.asyncio
    async def test_send_message_success(self):
        adapter, _ = _make_adapter()
        result = await adapter.send_message("42", "Hello!")
        assert isinstance(result, DeliveryResult)
        assert result.status == DeliveryStatus.SENT
        assert result.channel_name == "telegram"
        assert result.message_id == "42"

    @pytest.mark.asyncio
    async def test_send_message_with_metadata(self):
        adapter, transport = _make_adapter()
        await adapter.send_message(
            "42", "Hello!", metadata={"parse_mode": "HTML", "reply_to_message_id": 10}
        )
        req = transport.requests[-1]
        body = json.loads(req.content)
        assert body["parse_mode"] == "HTML"
        assert body["reply_to_message_id"] == 10

    @pytest.mark.asyncio
    async def test_send_message_failure(self):
        transport = MockTelegramTransport()
        transport.set_response("sendMessage", {"ok": False, "description": "Chat not found"})
        adapter, _ = _make_adapter(transport)
        result = await adapter.send_message("999", "Hello!")
        assert result.status == DeliveryStatus.FAILED
        assert "Chat not found" in (result.error or "")


# ---------------------------------------------------------------------------
# send_rich_content
# ---------------------------------------------------------------------------


class TestSendRichContent:
    @pytest.mark.asyncio
    async def test_send_rich_content_text_blocks(self):
        adapter, transport = _make_adapter()
        content = RichContent(
            blocks=[
                ContentBlock(type=ContentType.TEXT, data={"text": "Hello"}),
                ContentBlock(type=ContentType.CODE, data={"language": "python", "code": "print('hi')"}),
            ]
        )
        result = await adapter.send_rich_content("42", content)
        assert result.status == DeliveryStatus.SENT
        # Check the formatted payload includes parse_mode HTML
        req = transport.requests[-1]
        body = json.loads(req.content)
        assert body["parse_mode"] == "HTML"
        assert "Hello" in body["text"]

    @pytest.mark.asyncio
    async def test_format_content_with_image(self):
        adapter, _ = _make_adapter()
        content = RichContent(
            blocks=[ContentBlock(type=ContentType.IMAGE, data={"url": "https://img.test/pic.jpg", "caption": "Test"})]
        )
        formatted = adapter.format_content(content)
        assert isinstance(formatted, dict)
        assert "Test" in formatted["text"]
        assert "https://img.test/pic.jpg" in formatted["text"]


# ---------------------------------------------------------------------------
# send_quick_replies
# ---------------------------------------------------------------------------


class TestSendQuickReplies:
    @pytest.mark.asyncio
    async def test_send_quick_replies(self):
        adapter, transport = _make_adapter()
        replies = [
            QuickReply(label="Yes", payload="yes"),
            QuickReply(label="No", payload="no"),
        ]
        result = await adapter.send_quick_replies("42", "Confirm?", replies)
        assert result.status == DeliveryStatus.SENT

        req = transport.requests[-1]
        body = json.loads(req.content)
        assert body["text"] == "Confirm?"
        assert "reply_markup" in body
        keyboard = body["reply_markup"]["keyboard"]
        assert len(keyboard) == 2
        assert keyboard[0][0]["text"] == "Yes"
        assert keyboard[1][0]["text"] == "No"
        assert body["reply_markup"]["one_time_keyboard"] is True


# ---------------------------------------------------------------------------
# send_buttons (inline keyboard)
# ---------------------------------------------------------------------------


class TestSendButtons:
    @pytest.mark.asyncio
    async def test_send_inline_keyboard(self):
        adapter, transport = _make_adapter()
        buttons = [
            [
                Button(label="OK", callback_data="ok"),
                Button(label="Cancel", callback_data="cancel", style=ButtonStyle.DANGER),
            ],
            [
                Button(label="Visit", url="https://example.com", style=ButtonStyle.LINK),
            ],
        ]
        result = await adapter.send_buttons("42", "Choose:", buttons)
        assert result.status == DeliveryStatus.SENT

        req = transport.requests[-1]
        body = json.loads(req.content)
        inline_kb = body["reply_markup"]["inline_keyboard"]
        assert len(inline_kb) == 2
        assert inline_kb[0][0]["text"] == "OK"
        assert inline_kb[0][0]["callback_data"] == "ok"
        assert inline_kb[0][1]["text"] == "Cancel"
        assert inline_kb[1][0]["url"] == "https://example.com"


# ---------------------------------------------------------------------------
# get_user_profile
# ---------------------------------------------------------------------------


class TestGetUserProfile:
    @pytest.mark.asyncio
    async def test_get_user_profile_success(self):
        adapter, _ = _make_adapter()
        profile = await adapter.get_user_profile("100")
        assert isinstance(profile, UserProfile)
        assert profile.platform_user_id == "100"
        assert profile.first_name == "Alice"
        assert profile.last_name == "Smith"
        assert profile.username == "alice_s"
        assert profile.display_name == "Alice Smith"

    @pytest.mark.asyncio
    async def test_get_user_profile_failure(self):
        transport = MockTelegramTransport()
        transport.set_response("getChat", {"ok": False, "description": "Chat not found"})
        adapter, _ = _make_adapter(transport)
        with pytest.raises(LookupError, match="Could not retrieve"):
            await adapter.get_user_profile("999")


# ---------------------------------------------------------------------------
# get_channel_info
# ---------------------------------------------------------------------------


class TestGetChannelInfo:
    def test_channel_info(self):
        adapter, _ = _make_adapter()
        info = adapter.get_channel_info()
        assert isinstance(info, ChannelInfo)
        assert info.name == "telegram"
        assert info.channel_type == "telegram"
        assert info.supports_rich_content is True
        assert info.supports_buttons is True
        assert info.supports_images is True
        assert info.supports_files is True
        assert info.max_message_length == 4096

    @pytest.mark.asyncio
    async def test_channel_info_includes_bot_id_after_connect(self):
        adapter, _ = _make_adapter()
        await adapter.connect()
        info = adapter.get_channel_info()
        assert info.extra["bot_id"] == "123456"
        assert info.extra["bot_username"] == "test_bot"


# ---------------------------------------------------------------------------
# ConnectionInfo
# ---------------------------------------------------------------------------


class TestConnectionInfo:
    def test_to_dict(self):
        info = ConnectionInfo(
            state=ConnectionState.CONNECTED,
            bot_id="123",
            bot_username="mybot",
            webhook_url="https://example.com/hook",
            webhook_active=True,
        )
        d = info.to_dict()
        assert d["state"] == "connected"
        assert d["bot_id"] == "123"
        assert d["webhook_active"] is True

    def test_is_connected_property(self):
        info = ConnectionInfo(state=ConnectionState.CONNECTED)
        assert info.is_connected
        info.state = ConnectionState.ERROR
        assert not info.is_connected

    def test_connection_state_values(self):
        assert ConnectionState.DISCONNECTED.value == "disconnected"
        assert ConnectionState.CONNECTING.value == "connecting"
        assert ConnectionState.CONNECTED.value == "connected"
        assert ConnectionState.RECONNECTING.value == "reconnecting"
        assert ConnectionState.ERROR.value == "error"
