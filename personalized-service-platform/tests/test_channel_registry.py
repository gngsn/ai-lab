"""Tests for DeliveryChannelRegistry — registration, lookup, and unified send."""

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
from app.delivery.channel_registry import (
    ChannelAlreadyRegisteredError,
    ChannelNotFoundError,
    DeliveryChannelRegistry,
    MultiDeliveryResult,
)
from app.delivery.router import ChatChannel, EmailChannel, PushChannel

from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sample_rich_content() -> RichContent:
    return RichContent(blocks=[
        ContentBlock(type=ContentType.TEXT, data={"text": "Hello world"}),
    ])


class FailingChannel(DeliveryChannel):
    """A channel that always fails — used to test error handling."""

    async def send_message(
        self, recipient_id: str, text: str, *, metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        raise RuntimeError("send failed")

    async def send_rich_content(
        self, recipient_id: str, content: RichContent, *, metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        raise RuntimeError("send failed")

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(name="failing", channel_type="test", max_message_length=100)

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        return ""


class SecondChatChannel(DeliveryChannel):
    """Another chat-type channel to test type index with multiple entries."""

    async def send_message(
        self, recipient_id: str, text: str, *, metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        return DeliveryResult(channel_name="chat2", status=DeliveryStatus.DELIVERED, raw={"text": text})

    async def send_rich_content(
        self, recipient_id: str, content: RichContent, *, metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        return DeliveryResult(channel_name="chat2", status=DeliveryStatus.DELIVERED)

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(name="chat2", channel_type="chat")

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        return "chat2"


@pytest.fixture
def registry() -> DeliveryChannelRegistry:
    """Fresh registry with default channels registered."""
    reg = DeliveryChannelRegistry()
    reg.register("chat", ChatChannel())
    reg.register("email", EmailChannel())
    reg.register("push", PushChannel())
    return reg


@pytest.fixture
def empty_registry() -> DeliveryChannelRegistry:
    return DeliveryChannelRegistry()


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class TestRegistration:
    def test_register_channel(self, empty_registry: DeliveryChannelRegistry):
        empty_registry.register("chat", ChatChannel())
        assert empty_registry.has("chat")
        assert empty_registry.size == 1

    def test_register_multiple_channels(self, registry: DeliveryChannelRegistry):
        assert registry.size == 3
        assert registry.has("chat")
        assert registry.has("email")
        assert registry.has("push")

    def test_register_duplicate_raises(self, registry: DeliveryChannelRegistry):
        with pytest.raises(ChannelAlreadyRegisteredError) as exc_info:
            registry.register("chat", ChatChannel())
        assert exc_info.value.channel_name == "chat"

    def test_register_duplicate_with_replace(self, registry: DeliveryChannelRegistry):
        new_chat = ChatChannel()
        registry.register("chat", new_chat, replace=True)
        assert registry.get("chat") is new_chat

    def test_register_rejects_non_channel(self, empty_registry: DeliveryChannelRegistry):
        with pytest.raises(TypeError, match="DeliveryChannel"):
            empty_registry.register("bad", "not a channel")  # type: ignore[arg-type]

    def test_unregister(self, registry: DeliveryChannelRegistry):
        channel = registry.unregister("chat")
        assert isinstance(channel, ChatChannel)
        assert not registry.has("chat")
        assert registry.size == 2

    def test_unregister_unknown_raises(self, registry: DeliveryChannelRegistry):
        with pytest.raises(ChannelNotFoundError):
            registry.unregister("unknown")


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------


class TestLookup:
    def test_get_existing(self, registry: DeliveryChannelRegistry):
        channel = registry.get("chat")
        assert isinstance(channel, ChatChannel)

    def test_get_unknown_raises(self, registry: DeliveryChannelRegistry):
        with pytest.raises(ChannelNotFoundError) as exc_info:
            registry.get("unknown")
        assert exc_info.value.channel_name == "unknown"

    def test_get_or_none_existing(self, registry: DeliveryChannelRegistry):
        assert registry.get_or_none("chat") is not None

    def test_get_or_none_missing(self, registry: DeliveryChannelRegistry):
        assert registry.get_or_none("unknown") is None

    def test_get_by_type(self, registry: DeliveryChannelRegistry):
        chat_channels = registry.get_by_type("chat")
        assert len(chat_channels) == 1
        assert isinstance(chat_channels[0], ChatChannel)

    def test_get_by_type_multiple(self, registry: DeliveryChannelRegistry):
        registry.register("chat2", SecondChatChannel())
        chat_channels = registry.get_by_type("chat")
        assert len(chat_channels) == 2

    def test_get_by_type_empty(self, registry: DeliveryChannelRegistry):
        assert registry.get_by_type("unknown_type") == []

    def test_get_first_by_type(self, registry: DeliveryChannelRegistry):
        channel = registry.get_first_by_type("email")
        assert isinstance(channel, EmailChannel)

    def test_get_first_by_type_missing(self, registry: DeliveryChannelRegistry):
        assert registry.get_first_by_type("unknown_type") is None

    def test_has(self, registry: DeliveryChannelRegistry):
        assert registry.has("chat") is True
        assert registry.has("nonexistent") is False


# ---------------------------------------------------------------------------
# Listing & introspection
# ---------------------------------------------------------------------------


class TestListingAndIntrospection:
    def test_list_names(self, registry: DeliveryChannelRegistry):
        names = registry.list_names()
        assert names == ["chat", "email", "push"]

    def test_list_channel_types(self, registry: DeliveryChannelRegistry):
        types = registry.list_channel_types()
        assert "chat" in types
        assert "email" in types
        assert "push" in types

    def test_list_channel_info(self, registry: DeliveryChannelRegistry):
        info = registry.list_channel_info()
        assert set(info.keys()) == {"chat", "email", "push"}
        assert isinstance(info["chat"], ChannelInfo)

    def test_summary(self, registry: DeliveryChannelRegistry):
        s = registry.summary()
        assert s["total_channels"] == 3
        assert isinstance(s["channel_types"], list)
        assert len(s["channels"]) == 3
        # Each channel entry has expected keys
        for ch in s["channels"]:
            assert "name" in ch
            assert "channel_type" in ch
            assert "supports_rich_content" in ch

    def test_size_property(self, empty_registry: DeliveryChannelRegistry):
        assert empty_registry.size == 0
        empty_registry.register("chat", ChatChannel())
        assert empty_registry.size == 1

    def test_empty_registry_summary(self, empty_registry: DeliveryChannelRegistry):
        s = empty_registry.summary()
        assert s["total_channels"] == 0
        assert s["channels"] == []


# ---------------------------------------------------------------------------
# Unified send
# ---------------------------------------------------------------------------


class TestSend:
    @pytest.mark.asyncio
    async def test_send_text(self, registry: DeliveryChannelRegistry):
        result = await registry.send("chat", "user-1", "Hello!")
        assert isinstance(result, DeliveryResult)
        assert result.status == DeliveryStatus.DELIVERED
        assert result.channel_name == "chat"

    @pytest.mark.asyncio
    async def test_send_rich_content(self, registry: DeliveryChannelRegistry):
        result = await registry.send("email", "u@example.com", _sample_rich_content())
        assert result.status == DeliveryStatus.DELIVERED
        assert result.channel_name == "email"

    @pytest.mark.asyncio
    async def test_send_unknown_channel_raises(self, registry: DeliveryChannelRegistry):
        with pytest.raises(ChannelNotFoundError):
            await registry.send("unknown", "user-1", "Hello!")

    @pytest.mark.asyncio
    async def test_send_with_metadata(self, registry: DeliveryChannelRegistry):
        result = await registry.send(
            "chat", "user-1", "Hello!",
            metadata={"parse_mode": "markdown"},
        )
        assert result.status == DeliveryStatus.DELIVERED


# ---------------------------------------------------------------------------
# Multi-channel send
# ---------------------------------------------------------------------------


class TestSendToMultiple:
    @pytest.mark.asyncio
    async def test_send_to_multiple(self, registry: DeliveryChannelRegistry):
        result = await registry.send_to_multiple(
            ["chat", "email"], "user-1", "Hello!",
        )
        assert isinstance(result, MultiDeliveryResult)
        assert result.total_sent == 2
        assert result.total_failed == 0
        assert result.all_succeeded is True

    @pytest.mark.asyncio
    async def test_send_to_multiple_skip_unknown(self, registry: DeliveryChannelRegistry):
        result = await registry.send_to_multiple(
            ["chat", "nonexistent", "email"], "user-1", "Hello!",
            skip_unknown=True,
        )
        assert result.total_sent == 2
        assert result.total_failed == 0

    @pytest.mark.asyncio
    async def test_send_to_multiple_raises_on_unknown(self, registry: DeliveryChannelRegistry):
        with pytest.raises(ChannelNotFoundError):
            await registry.send_to_multiple(
                ["chat", "nonexistent"], "user-1", "Hello!",
            )

    @pytest.mark.asyncio
    async def test_send_to_multiple_with_failure(self, registry: DeliveryChannelRegistry):
        registry.register("failing", FailingChannel())
        result = await registry.send_to_multiple(
            ["chat", "failing"], "user-1", "Hello!",
        )
        assert result.total_sent == 1
        assert result.total_failed == 1
        assert result.all_succeeded is False
        assert result.errors[0].channel_name == "failing"
        assert result.errors[0].error is not None

    @pytest.mark.asyncio
    async def test_send_to_empty_list(self, registry: DeliveryChannelRegistry):
        result = await registry.send_to_multiple([], "user-1", "Hello!")
        assert result.total_sent == 0
        assert result.total_failed == 0
        assert result.all_succeeded is False  # no results means not all succeeded


# ---------------------------------------------------------------------------
# Send by type
# ---------------------------------------------------------------------------


class TestSendByType:
    @pytest.mark.asyncio
    async def test_send_by_type(self, registry: DeliveryChannelRegistry):
        result = await registry.send_by_type("chat", "user-1", "Hello!")
        assert result.total_sent == 1
        assert result.all_succeeded is True

    @pytest.mark.asyncio
    async def test_send_by_type_multiple_channels(self, registry: DeliveryChannelRegistry):
        registry.register("chat2", SecondChatChannel())
        result = await registry.send_by_type("chat", "user-1", "Hello!")
        assert result.total_sent == 2

    @pytest.mark.asyncio
    async def test_send_by_unknown_type(self, registry: DeliveryChannelRegistry):
        result = await registry.send_by_type("sms", "user-1", "Hello!")
        assert result.total_sent == 0


# ---------------------------------------------------------------------------
# MultiDeliveryResult
# ---------------------------------------------------------------------------


class TestMultiDeliveryResult:
    def test_to_dict(self):
        r = MultiDeliveryResult(
            results=[
                DeliveryResult(
                    channel_name="chat",
                    status=DeliveryStatus.DELIVERED,
                    raw={"text": "hi"},
                ),
            ],
            errors=[
                DeliveryResult(
                    channel_name="push",
                    status=DeliveryStatus.FAILED,
                    error="timeout",
                ),
            ],
        )
        d = r.to_dict()
        assert d["total_sent"] == 1
        assert d["total_failed"] == 1
        assert d["all_succeeded"] is False
        assert len(d["results"]) == 1
        assert len(d["errors"]) == 1
        assert d["results"][0]["channel"] == "chat"
        assert d["errors"][0]["error"] == "timeout"


# ---------------------------------------------------------------------------
# Type index consistency
# ---------------------------------------------------------------------------


class TestTypeIndexConsistency:
    def test_type_index_after_unregister(self, registry: DeliveryChannelRegistry):
        registry.unregister("chat")
        assert registry.get_by_type("chat") == []

    def test_type_index_after_replace(self, registry: DeliveryChannelRegistry):
        new_chat = ChatChannel()
        registry.register("chat", new_chat, replace=True)
        chats = registry.get_by_type("chat")
        assert len(chats) == 1
        assert chats[0] is new_chat

    def test_type_index_with_multiple_same_type(self, empty_registry: DeliveryChannelRegistry):
        empty_registry.register("chat1", ChatChannel())
        empty_registry.register("chat2", SecondChatChannel())
        chats = empty_registry.get_by_type("chat")
        assert len(chats) == 2
        # Unregister one, other remains
        empty_registry.unregister("chat1")
        chats = empty_registry.get_by_type("chat")
        assert len(chats) == 1


# ---------------------------------------------------------------------------
# Backward compatibility — default_registry & deliver_to_user
# ---------------------------------------------------------------------------


class TestBackwardCompatibility:
    def test_default_registry_exists(self):
        from app.delivery.router import default_registry
        assert isinstance(default_registry, DeliveryChannelRegistry)
        assert default_registry.size == 3

    def test_channels_dict_available(self):
        from app.delivery.router import CHANNELS
        assert "chat" in CHANNELS
        assert "email" in CHANNELS
        assert "push" in CHANNELS

    @pytest.mark.asyncio
    async def test_deliver_to_user_still_works(self):
        from app.delivery.router import deliver_to_user
        results = await deliver_to_user(
            "user-1", ["chat", "email"], "Hello!", {},
        )
        assert len(results) == 2
        assert all(r["status"] == "delivered" for r in results)

    @pytest.mark.asyncio
    async def test_deliver_to_user_skips_unknown(self):
        from app.delivery.router import deliver_to_user
        results = await deliver_to_user(
            "user-1", ["chat", "nonexistent"], "Hello!", {},
        )
        assert len(results) == 1

    def test_create_default_registry(self):
        from app.delivery.router import create_default_registry
        reg = create_default_registry()
        assert reg.size == 3
        assert reg.has("chat")
        assert reg.has("email")
        assert reg.has("push")
