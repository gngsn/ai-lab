"""Tests for the message sending pipeline (app.messaging.sender)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.messenger import Button, ButtonStyle, QuickReply, WebhookEvent, WebhookPayload
from app.messaging.models import InboundMessage, MessageResponse, MessageSource, MessageType
from app.messaging.sender import (
    ChannelResolver,
    MessageSender,
    OutboundContentType,
    OutboundMessage,
    SendResult,
)


# ---------------------------------------------------------------------------
# Fake messenger channel for testing
# ---------------------------------------------------------------------------


class FakeMessengerChannel:
    """Minimal fake that records all send calls for assertions."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.sent_messages: list[dict[str, Any]] = []
        self.sent_rich: list[dict[str, Any]] = []
        self.sent_buttons: list[dict[str, Any]] = []
        self.sent_quick_replies: list[dict[str, Any]] = []

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="fake",
            channel_type="fake",
            supports_rich_content=True,
            supports_buttons=True,
            supports_images=True,
            supports_files=False,
            max_message_length=4096,
        )

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self.sent_messages.append({
            "recipient_id": recipient_id,
            "text": text,
            "metadata": metadata,
        })
        if self.fail:
            return DeliveryResult(
                channel_name="fake",
                status=DeliveryStatus.FAILED,
                error="Simulated failure",
            )
        return DeliveryResult(
            channel_name="fake",
            status=DeliveryStatus.SENT,
            message_id="msg_123",
        )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self.sent_rich.append({
            "recipient_id": recipient_id,
            "content": content,
            "metadata": metadata,
        })
        if self.fail:
            return DeliveryResult(
                channel_name="fake",
                status=DeliveryStatus.FAILED,
                error="Simulated failure",
            )
        return DeliveryResult(
            channel_name="fake",
            status=DeliveryStatus.SENT,
            message_id="rich_456",
        )

    async def send_buttons(
        self,
        recipient_id: str,
        text: str,
        buttons: list[list[Button]],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self.sent_buttons.append({
            "recipient_id": recipient_id,
            "text": text,
            "buttons": buttons,
            "metadata": metadata,
        })
        if self.fail:
            return DeliveryResult(
                channel_name="fake",
                status=DeliveryStatus.FAILED,
                error="Simulated failure",
            )
        return DeliveryResult(
            channel_name="fake",
            status=DeliveryStatus.SENT,
            message_id="btn_789",
        )

    async def send_quick_replies(
        self,
        recipient_id: str,
        text: str,
        quick_replies: list[QuickReply],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        self.sent_quick_replies.append({
            "recipient_id": recipient_id,
            "text": text,
            "quick_replies": quick_replies,
            "metadata": metadata,
        })
        if self.fail:
            return DeliveryResult(
                channel_name="fake",
                status=DeliveryStatus.FAILED,
                error="Simulated failure",
            )
        return DeliveryResult(
            channel_name="fake",
            status=DeliveryStatus.SENT,
            message_id="qr_101",
        )

    async def handle_webhook(self, payload: dict[str, Any]) -> WebhookPayload:
        return WebhookPayload(
            event_type=WebhookEvent.MESSAGE,
            sender_id="user1",
            chat_id="chat1",
            text=payload.get("text", ""),
            raw=payload,
        )

    async def get_user_profile(self, user_id: str):
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_channel():
    return FakeMessengerChannel()


@pytest.fixture
def resolver(fake_channel):
    r = ChannelResolver()
    r.register("telegram", fake_channel)
    return r


@pytest.fixture
def sender(resolver):
    return MessageSender(resolver)


@pytest.fixture
def sample_inbound():
    return InboundMessage(
        source=MessageSource(platform="telegram", sender_id="user_42", chat_id="chat_42"),
        message_type=MessageType.TEXT,
        text="Hello bot",
        message_id="orig_msg_99",
    )


# ---------------------------------------------------------------------------
# ChannelResolver tests
# ---------------------------------------------------------------------------


class TestChannelResolver:
    def test_register_and_get(self, fake_channel):
        r = ChannelResolver()
        r.register("telegram", fake_channel)
        assert r.get("telegram") is fake_channel
        assert r.has("telegram")
        assert "telegram" in r.list_platforms()

    def test_get_unknown_returns_none(self):
        r = ChannelResolver()
        assert r.get("slack") is None
        assert not r.has("slack")

    def test_unregister(self, fake_channel):
        r = ChannelResolver()
        r.register("telegram", fake_channel)
        assert r.unregister("telegram") is True
        assert r.get("telegram") is None
        assert not r.has("telegram")

    def test_unregister_unknown_returns_false(self):
        r = ChannelResolver()
        assert r.unregister("slack") is False


# ---------------------------------------------------------------------------
# MessageSender — send_response tests
# ---------------------------------------------------------------------------


class TestSendResponse:
    @pytest.mark.asyncio
    async def test_send_text_response(self, sender, fake_channel, sample_inbound):
        response = MessageResponse(text="Hello user!", handled=True)
        result = await sender.send_response(sample_inbound, response)

        assert result.success
        assert result.platform == "telegram"
        assert result.recipient_id == "chat_42"
        assert result.message_id == "msg_123"
        assert result.error is None

        # Verify the channel received the correct call
        assert len(fake_channel.sent_messages) == 1
        sent = fake_channel.sent_messages[0]
        assert sent["recipient_id"] == "chat_42"
        assert sent["text"] == "Hello user!"
        # reply_to_message_id should be set from inbound message_id
        assert sent["metadata"]["reply_to_message_id"] == "orig_msg_99"

    @pytest.mark.asyncio
    async def test_send_response_with_metadata(self, sender, fake_channel, sample_inbound):
        response = MessageResponse(
            text="Formatted reply",
            handled=True,
            metadata={"parse_mode": "HTML"},
        )
        result = await sender.send_response(sample_inbound, response)

        assert result.success
        sent = fake_channel.sent_messages[0]
        assert sent["metadata"]["parse_mode"] == "HTML"
        assert sent["metadata"]["reply_to_message_id"] == "orig_msg_99"

    @pytest.mark.asyncio
    async def test_send_response_empty_returns_error(self, sender, sample_inbound):
        response = MessageResponse(text="", handled=True)
        result = await sender.send_response(sample_inbound, response)

        assert result.failed
        assert "Empty response" in result.error

    @pytest.mark.asyncio
    async def test_send_response_unknown_platform(self, sender):
        inbound = InboundMessage(
            source=MessageSource(platform="slack", sender_id="u1", chat_id="c1"),
            message_type=MessageType.TEXT,
            text="hi",
        )
        response = MessageResponse(text="Hello!", handled=True)
        result = await sender.send_response(inbound, response)

        assert result.failed
        assert "No channel registered" in result.error

    @pytest.mark.asyncio
    async def test_send_response_delivery_failure(self, sample_inbound):
        failing_channel = FakeMessengerChannel(fail=True)
        resolver = ChannelResolver()
        resolver.register("telegram", failing_channel)
        sender = MessageSender(resolver)

        response = MessageResponse(text="Will fail", handled=True)
        result = await sender.send_response(sample_inbound, response)

        assert result.failed
        assert result.error == "Simulated failure"

    @pytest.mark.asyncio
    async def test_send_response_with_rich_content(self, sender, fake_channel, sample_inbound):
        response = MessageResponse(
            text="",
            rich_content={
                "blocks": [
                    {"type": "text", "data": {"text": "Hello **bold**"}},
                    {"type": "code", "data": {"language": "python", "code": "print('hi')"}},
                ]
            },
            handled=True,
        )
        result = await sender.send_response(sample_inbound, response)

        assert result.success
        assert result.message_id == "rich_456"
        assert len(fake_channel.sent_rich) == 1
        rich = fake_channel.sent_rich[0]["content"]
        assert len(rich.blocks) == 2
        assert rich.blocks[0].type == ContentType.TEXT
        assert rich.blocks[1].type == ContentType.CODE

    @pytest.mark.asyncio
    async def test_send_response_rich_content_shorthand(self, sender, fake_channel, sample_inbound):
        """rich_content with just a 'text' key should be wrapped as a single text block."""
        response = MessageResponse(
            text="",
            rich_content={"text": "Simple rich text"},
            handled=True,
        )
        result = await sender.send_response(sample_inbound, response)

        assert result.success
        rich = fake_channel.sent_rich[0]["content"]
        assert len(rich.blocks) == 1
        assert rich.blocks[0].data["text"] == "Simple rich text"


# ---------------------------------------------------------------------------
# MessageSender — send_outbound tests
# ---------------------------------------------------------------------------


class TestSendOutbound:
    @pytest.mark.asyncio
    async def test_send_text_outbound(self, sender, fake_channel):
        msg = OutboundMessage(
            target=MessageSource("telegram", "user_1", "chat_1"),
            text="Time for your daily vocab!",
        )
        result = await sender.send_outbound(msg)

        assert result.success
        assert len(fake_channel.sent_messages) == 1
        assert fake_channel.sent_messages[0]["text"] == "Time for your daily vocab!"

    @pytest.mark.asyncio
    async def test_send_buttons_outbound(self, sender, fake_channel):
        buttons = [
            [
                Button(label="Option A", callback_data="a"),
                Button(label="Option B", callback_data="b"),
            ]
        ]
        msg = OutboundMessage(
            target=MessageSource("telegram", "user_1", "chat_1"),
            text="Choose one:",
            content_type=OutboundContentType.BUTTONS,
            buttons=buttons,
        )
        result = await sender.send_outbound(msg)

        assert result.success
        assert result.message_id == "btn_789"
        assert len(fake_channel.sent_buttons) == 1
        sent = fake_channel.sent_buttons[0]
        assert sent["text"] == "Choose one:"
        assert len(sent["buttons"]) == 1
        assert len(sent["buttons"][0]) == 2

    @pytest.mark.asyncio
    async def test_send_quick_replies_outbound(self, sender, fake_channel):
        qrs = [
            QuickReply(label="Yes", payload="yes"),
            QuickReply(label="No", payload="no"),
        ]
        msg = OutboundMessage(
            target=MessageSource("telegram", "user_1", "chat_1"),
            text="Continue?",
            content_type=OutboundContentType.QUICK_REPLIES,
            quick_replies=qrs,
        )
        result = await sender.send_outbound(msg)

        assert result.success
        assert result.message_id == "qr_101"
        assert len(fake_channel.sent_quick_replies) == 1

    @pytest.mark.asyncio
    async def test_send_rich_outbound(self, sender, fake_channel):
        rich = RichContent(
            blocks=[ContentBlock(type=ContentType.TEXT, data={"text": "Rich!"})],
        )
        msg = OutboundMessage(
            target=MessageSource("telegram", "user_1", "chat_1"),
            text="fallback",
            content_type=OutboundContentType.RICH,
            rich_content=rich,
        )
        result = await sender.send_outbound(msg)

        assert result.success
        assert len(fake_channel.sent_rich) == 1

    @pytest.mark.asyncio
    async def test_send_outbound_unknown_platform(self, sender):
        msg = OutboundMessage(
            target=MessageSource("slack", "user_1", "chat_1"),
            text="Hello!",
        )
        result = await sender.send_outbound(msg)

        assert result.failed
        assert "No channel registered" in result.error

    @pytest.mark.asyncio
    async def test_send_outbound_delivery_failure(self):
        failing_channel = FakeMessengerChannel(fail=True)
        resolver = ChannelResolver()
        resolver.register("telegram", failing_channel)
        sender = MessageSender(resolver)

        msg = OutboundMessage(
            target=MessageSource("telegram", "user_1", "chat_1"),
            text="Will fail",
        )
        result = await sender.send_outbound(msg)

        assert result.failed
        assert result.error == "Simulated failure"


# ---------------------------------------------------------------------------
# MessageSender — direct send helpers
# ---------------------------------------------------------------------------


class TestDirectSendHelpers:
    @pytest.mark.asyncio
    async def test_send_text(self, sender, fake_channel):
        result = await sender.send_text("telegram", "chat_99", "Direct hello")

        assert result.success
        assert fake_channel.sent_messages[0]["text"] == "Direct hello"

    @pytest.mark.asyncio
    async def test_send_text_unknown_platform(self, sender):
        result = await sender.send_text("slack", "c1", "Hello")
        assert result.failed

    @pytest.mark.asyncio
    async def test_send_rich(self, sender, fake_channel):
        rich = RichContent(
            blocks=[ContentBlock(type=ContentType.TEXT, data={"text": "Hi"})],
        )
        result = await sender.send_rich("telegram", "chat_99", rich)

        assert result.success
        assert len(fake_channel.sent_rich) == 1

    @pytest.mark.asyncio
    async def test_send_rich_unknown_platform(self, sender):
        rich = RichContent(blocks=[])
        result = await sender.send_rich("slack", "c1", rich)
        assert result.failed


# ---------------------------------------------------------------------------
# SendResult model
# ---------------------------------------------------------------------------


class TestSendResult:
    def test_success(self):
        r = SendResult(success=True, platform="telegram", recipient_id="c1", message_id="m1")
        assert not r.failed

    def test_failure(self):
        r = SendResult(success=False, platform="telegram", recipient_id="c1", error="oops")
        assert r.failed
        assert r.error == "oops"


# ---------------------------------------------------------------------------
# Channel exception handling
# ---------------------------------------------------------------------------


class TestExceptionHandling:
    @pytest.mark.asyncio
    async def test_channel_raises_exception(self):
        """If the channel raises an unexpected exception, sender catches it."""

        class ExplodingChannel(FakeMessengerChannel):
            async def send_message(self, *args, **kwargs):
                raise RuntimeError("Boom!")

        resolver = ChannelResolver()
        resolver.register("telegram", ExplodingChannel())
        sender = MessageSender(resolver)

        result = await sender.send_text("telegram", "c1", "test")
        assert result.failed
        assert "Boom!" in result.error

    @pytest.mark.asyncio
    async def test_buttons_channel_raises_exception(self):
        class ExplodingChannel(FakeMessengerChannel):
            async def send_buttons(self, *args, **kwargs):
                raise RuntimeError("Button boom!")

        resolver = ChannelResolver()
        resolver.register("telegram", ExplodingChannel())
        sender = MessageSender(resolver)

        msg = OutboundMessage(
            target=MessageSource("telegram", "u1", "c1"),
            text="Choose:",
            content_type=OutboundContentType.BUTTONS,
            buttons=[[Button(label="A", callback_data="a")]],
        )
        result = await sender.send_outbound(msg)
        assert result.failed
        assert "Button boom!" in result.error

    @pytest.mark.asyncio
    async def test_quick_replies_channel_raises_exception(self):
        class ExplodingChannel(FakeMessengerChannel):
            async def send_quick_replies(self, *args, **kwargs):
                raise RuntimeError("QR boom!")

        resolver = ChannelResolver()
        resolver.register("telegram", ExplodingChannel())
        sender = MessageSender(resolver)

        msg = OutboundMessage(
            target=MessageSource("telegram", "u1", "c1"),
            text="Choose:",
            content_type=OutboundContentType.QUICK_REPLIES,
            quick_replies=[QuickReply(label="Yes", payload="yes")],
        )
        result = await sender.send_outbound(msg)
        assert result.failed
        assert "QR boom!" in result.error
