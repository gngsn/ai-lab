"""Tests for the MessengerBotChannel abstract interface and data models."""

from __future__ import annotations

from typing import Any

import pytest

from app.delivery.base import (
    ChannelInfo,
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
# Concrete stub for testing — implements every abstract method minimally
# ---------------------------------------------------------------------------

class StubMessengerBot(MessengerBotChannel):
    """Minimal concrete implementation used to verify the interface contract."""

    def __init__(self) -> None:
        self._sent_messages: list[dict[str, Any]] = []
        self._sent_quick_replies: list[dict[str, Any]] = []
        self._sent_buttons: list[dict[str, Any]] = []

    # -- DeliveryChannel base methods ---------------------------------------

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self._sent_messages.append({"to": recipient_id, "text": text})
        return DeliveryResult(
            channel_name="stub_messenger",
            status=DeliveryStatus.DELIVERED,
            message_id="msg-001",
            raw={"to": recipient_id, "text": text},
        )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        return DeliveryResult(
            channel_name="stub_messenger",
            status=DeliveryStatus.DELIVERED,
            raw={"to": recipient_id, "blocks": len(content.blocks)},
        )

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="stub_messenger",
            channel_type="messenger",
            supports_rich_content=True,
            supports_buttons=True,
            supports_images=True,
            max_message_length=4096,
        )

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        return "formatted"

    # -- MessengerBotChannel methods ----------------------------------------

    async def handle_webhook(
        self,
        payload: dict[str, Any],
    ) -> WebhookPayload:
        return WebhookPayload(
            event_type=WebhookEvent(payload.get("type", "unknown")),
            sender_id=payload.get("sender", ""),
            chat_id=payload.get("chat", ""),
            text=payload.get("text", ""),
            callback_data=payload.get("callback_data"),
            message_id=payload.get("message_id"),
            raw=payload,
        )

    async def send_quick_replies(
        self,
        recipient_id: str,
        text: str,
        quick_replies: list[QuickReply],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self._sent_quick_replies.append({
            "to": recipient_id,
            "text": text,
            "replies": [qr.label for qr in quick_replies],
        })
        return DeliveryResult(
            channel_name="stub_messenger",
            status=DeliveryStatus.DELIVERED,
            raw={"quick_replies_count": len(quick_replies)},
        )

    async def send_buttons(
        self,
        recipient_id: str,
        text: str,
        buttons: list[list[Button]],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self._sent_buttons.append({
            "to": recipient_id,
            "text": text,
            "rows": len(buttons),
        })
        return DeliveryResult(
            channel_name="stub_messenger",
            status=DeliveryStatus.DELIVERED,
            raw={"button_rows": len(buttons)},
        )

    async def get_user_profile(self, user_id: str) -> UserProfile:
        return UserProfile(
            platform_user_id=user_id,
            username=f"user_{user_id}",
            display_name="Test User",
            first_name="Test",
            last_name="User",
            language_code="en",
        )


# ---------------------------------------------------------------------------
# Interface contract tests
# ---------------------------------------------------------------------------

class TestMessengerBotChannelInterface:
    """Verify abstract class behaviour and inheritance."""

    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            MessengerBotChannel()  # type: ignore[abstract]

    def test_is_subclass_of_delivery_channel(self):
        assert issubclass(MessengerBotChannel, DeliveryChannel)

    def test_stub_is_instance_of_both(self):
        bot = StubMessengerBot()
        assert isinstance(bot, MessengerBotChannel)
        assert isinstance(bot, DeliveryChannel)


# ---------------------------------------------------------------------------
# handle_webhook
# ---------------------------------------------------------------------------

class TestHandleWebhook:
    @pytest.mark.asyncio
    async def test_parses_message_event(self):
        bot = StubMessengerBot()
        result = await bot.handle_webhook({
            "type": "message",
            "sender": "user-123",
            "chat": "chat-456",
            "text": "hello",
            "message_id": "m-789",
        })
        assert isinstance(result, WebhookPayload)
        assert result.event_type == WebhookEvent.MESSAGE
        assert result.sender_id == "user-123"
        assert result.chat_id == "chat-456"
        assert result.text == "hello"
        assert result.message_id == "m-789"

    @pytest.mark.asyncio
    async def test_parses_callback_event(self):
        bot = StubMessengerBot()
        result = await bot.handle_webhook({
            "type": "callback",
            "sender": "user-1",
            "chat": "chat-1",
            "callback_data": "btn_yes",
        })
        assert result.event_type == WebhookEvent.CALLBACK
        assert result.callback_data == "btn_yes"

    @pytest.mark.asyncio
    async def test_preserves_raw_payload(self):
        payload = {"type": "message", "sender": "s", "chat": "c", "extra": 42}
        result = await StubMessengerBot().handle_webhook(payload)
        assert result.raw == payload

    @pytest.mark.asyncio
    async def test_unknown_event_type(self):
        result = await StubMessengerBot().handle_webhook({
            "type": "unknown",
            "sender": "s",
            "chat": "c",
        })
        assert result.event_type == WebhookEvent.UNKNOWN


# ---------------------------------------------------------------------------
# send_quick_replies
# ---------------------------------------------------------------------------

class TestSendQuickReplies:
    @pytest.mark.asyncio
    async def test_sends_quick_replies(self):
        bot = StubMessengerBot()
        replies = [
            QuickReply(label="Yes", payload="yes"),
            QuickReply(label="No", payload="no"),
        ]
        result = await bot.send_quick_replies("user-1", "Confirm?", replies)
        assert isinstance(result, DeliveryResult)
        assert result.status == DeliveryStatus.DELIVERED
        assert result.raw["quick_replies_count"] == 2

    @pytest.mark.asyncio
    async def test_records_sent_data(self):
        bot = StubMessengerBot()
        replies = [QuickReply(label="OK", payload="ok")]
        await bot.send_quick_replies("u1", "Ready?", replies)
        assert len(bot._sent_quick_replies) == 1
        assert bot._sent_quick_replies[0]["replies"] == ["OK"]

    @pytest.mark.asyncio
    async def test_quick_reply_with_image(self):
        qr = QuickReply(label="Pizza", payload="pizza", image_url="https://img.example.com/pizza.png")
        assert qr.image_url == "https://img.example.com/pizza.png"
        result = await StubMessengerBot().send_quick_replies("u1", "Pick food", [qr])
        assert result.status == DeliveryStatus.DELIVERED


# ---------------------------------------------------------------------------
# send_buttons
# ---------------------------------------------------------------------------

class TestSendButtons:
    @pytest.mark.asyncio
    async def test_sends_single_row(self):
        bot = StubMessengerBot()
        buttons = [[
            Button(label="OK", callback_data="ok"),
            Button(label="Cancel", callback_data="cancel", style=ButtonStyle.DANGER),
        ]]
        result = await bot.send_buttons("user-1", "Choose:", buttons)
        assert result.status == DeliveryStatus.DELIVERED
        assert result.raw["button_rows"] == 1

    @pytest.mark.asyncio
    async def test_sends_multiple_rows(self):
        buttons = [
            [Button(label="A", callback_data="a")],
            [Button(label="B", callback_data="b")],
            [Button(label="C", callback_data="c")],
        ]
        result = await StubMessengerBot().send_buttons("u1", "Pick:", buttons)
        assert result.raw["button_rows"] == 3

    @pytest.mark.asyncio
    async def test_url_button(self):
        btn = Button(label="Visit", url="https://example.com", style=ButtonStyle.LINK)
        assert btn.url == "https://example.com"
        assert btn.callback_data is None
        result = await StubMessengerBot().send_buttons("u1", "Link:", [[btn]])
        assert result.status == DeliveryStatus.DELIVERED


# ---------------------------------------------------------------------------
# get_user_profile
# ---------------------------------------------------------------------------

class TestGetUserProfile:
    @pytest.mark.asyncio
    async def test_returns_user_profile(self):
        bot = StubMessengerBot()
        profile = await bot.get_user_profile("user-42")
        assert isinstance(profile, UserProfile)
        assert profile.platform_user_id == "user-42"
        assert profile.username == "user_user-42"
        assert profile.display_name == "Test User"
        assert profile.first_name == "Test"
        assert profile.last_name == "User"
        assert profile.language_code == "en"
        assert profile.is_bot is False

    @pytest.mark.asyncio
    async def test_profile_raw_defaults_to_empty(self):
        profile = await StubMessengerBot().get_user_profile("u1")
        assert profile.raw == {}


# ---------------------------------------------------------------------------
# Data model tests
# ---------------------------------------------------------------------------

class TestDataModels:
    def test_quick_reply_frozen(self):
        qr = QuickReply(label="Yes", payload="yes")
        with pytest.raises(AttributeError):
            qr.label = "No"  # type: ignore[misc]

    def test_button_frozen(self):
        btn = Button(label="OK", callback_data="ok")
        with pytest.raises(AttributeError):
            btn.label = "X"  # type: ignore[misc]

    def test_user_profile_frozen(self):
        profile = UserProfile(platform_user_id="u1")
        with pytest.raises(AttributeError):
            profile.username = "changed"  # type: ignore[misc]

    def test_button_style_values(self):
        assert ButtonStyle.PRIMARY.value == "primary"
        assert ButtonStyle.SECONDARY.value == "secondary"
        assert ButtonStyle.DANGER.value == "danger"
        assert ButtonStyle.LINK.value == "link"

    def test_webhook_event_values(self):
        assert WebhookEvent.MESSAGE.value == "message"
        assert WebhookEvent.CALLBACK.value == "callback"
        assert WebhookEvent.COMMAND.value == "command"
        assert WebhookEvent.MEMBER_JOIN.value == "member_join"
        assert WebhookEvent.MEMBER_LEAVE.value == "member_leave"
        assert WebhookEvent.UNKNOWN.value == "unknown"

    def test_webhook_payload_defaults(self):
        wp = WebhookPayload(
            event_type=WebhookEvent.MESSAGE,
            sender_id="s1",
            chat_id="c1",
        )
        assert wp.text == ""
        assert wp.callback_data is None
        assert wp.message_id is None
        assert wp.raw == {}


# ---------------------------------------------------------------------------
# Base DeliveryChannel methods still work through MessengerBotChannel
# ---------------------------------------------------------------------------

class TestBaseMethodsViaMessenger:
    @pytest.mark.asyncio
    async def test_send_message(self):
        bot = StubMessengerBot()
        result = await bot.send_message("u1", "hello")
        assert result.status == DeliveryStatus.DELIVERED
        assert result.channel_name == "stub_messenger"

    def test_get_channel_info(self):
        info = StubMessengerBot().get_channel_info()
        assert info.channel_type == "messenger"
        assert info.supports_buttons is True

    def test_format_content(self):
        assert StubMessengerBot().format_content(RichContent()) == "formatted"
