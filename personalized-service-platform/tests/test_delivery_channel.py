"""Tests for the DeliveryChannel abstract interface and concrete channels."""

from __future__ import annotations

import pytest

from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    DeliveryChannel,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.router import ChatChannel, EmailChannel, PushChannel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sample_rich_content() -> RichContent:
    return RichContent(blocks=[
        ContentBlock(type=ContentType.TEXT, data={"text": "Hello world"}),
        ContentBlock(type=ContentType.IMAGE, data={"url": "https://img.example.com/1.png", "alt": "test"}),
        ContentBlock(type=ContentType.BUTTON, data={"label": "Click me", "url": "https://example.com"}),
        ContentBlock(type=ContentType.CODE, data={"language": "python", "code": "print('hi')"}),
    ])


# ---------------------------------------------------------------------------
# Abstract interface contract
# ---------------------------------------------------------------------------

class TestDeliveryChannelInterface:
    """Verify that DeliveryChannel cannot be instantiated directly."""

    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            DeliveryChannel()  # type: ignore[abstract]

    def test_concrete_channels_are_subclasses(self):
        for cls in (ChatChannel, EmailChannel, PushChannel):
            assert issubclass(cls, DeliveryChannel)


# ---------------------------------------------------------------------------
# send_message
# ---------------------------------------------------------------------------

class TestSendMessage:
    @pytest.mark.asyncio
    async def test_chat_send_message(self):
        ch = ChatChannel()
        result = await ch.send_message("user-1", "hi")
        assert isinstance(result, DeliveryResult)
        assert result.channel_name == "chat"
        assert result.status == DeliveryStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_email_send_message(self):
        result = await EmailChannel().send_message("user@example.com", "hi")
        assert result.channel_name == "email"
        assert result.status == DeliveryStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_push_send_message(self):
        result = await PushChannel().send_message("device-token", "hi")
        assert result.channel_name == "push"
        assert result.status == DeliveryStatus.DELIVERED


# ---------------------------------------------------------------------------
# send_rich_content
# ---------------------------------------------------------------------------

class TestSendRichContent:
    @pytest.mark.asyncio
    async def test_chat_rich_content(self):
        result = await ChatChannel().send_rich_content("u1", _sample_rich_content())
        assert result.status == DeliveryStatus.DELIVERED
        assert "content" in result.raw

    @pytest.mark.asyncio
    async def test_email_rich_content(self):
        result = await EmailChannel().send_rich_content("u1", _sample_rich_content())
        assert result.status == DeliveryStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_push_rich_content(self):
        result = await PushChannel().send_rich_content("u1", _sample_rich_content())
        assert result.status == DeliveryStatus.DELIVERED


# ---------------------------------------------------------------------------
# get_channel_info
# ---------------------------------------------------------------------------

class TestGetChannelInfo:
    def test_chat_info(self):
        info = ChatChannel().get_channel_info()
        assert isinstance(info, ChannelInfo)
        assert info.channel_type == "chat"
        assert info.supports_rich_content is True
        assert info.supports_buttons is True
        assert info.max_message_length == 4096

    def test_email_info(self):
        info = EmailChannel().get_channel_info()
        assert info.channel_type == "email"
        assert info.supports_buttons is False
        assert info.max_message_length is None

    def test_push_info(self):
        info = PushChannel().get_channel_info()
        assert info.channel_type == "push"
        assert info.supports_rich_content is False
        assert info.max_message_length == 256


# ---------------------------------------------------------------------------
# format_content
# ---------------------------------------------------------------------------

class TestFormatContent:
    def test_chat_format_contains_text(self):
        formatted = ChatChannel().format_content(_sample_rich_content())
        assert isinstance(formatted, str)
        assert "Hello world" in formatted

    def test_email_format_is_html(self):
        formatted = EmailChannel().format_content(_sample_rich_content())
        assert isinstance(formatted, str)
        assert "<p>" in formatted
        assert "<img" in formatted

    def test_push_format_text_only_and_truncated(self):
        long_text = RichContent(blocks=[
            ContentBlock(type=ContentType.TEXT, data={"text": "x" * 500}),
        ])
        formatted = PushChannel().format_content(long_text)
        assert isinstance(formatted, str)
        assert len(formatted) <= 256

    def test_push_ignores_non_text_blocks(self):
        content = RichContent(blocks=[
            ContentBlock(type=ContentType.IMAGE, data={"url": "https://img.example.com/1.png"}),
            ContentBlock(type=ContentType.TEXT, data={"text": "visible"}),
        ])
        formatted = PushChannel().format_content(content)
        assert "visible" in formatted
        assert "img.example.com" not in formatted
