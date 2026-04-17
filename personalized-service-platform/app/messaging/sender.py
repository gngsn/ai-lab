"""Message sending pipeline — routes outbound messages through delivery channels.

The :class:`MessageSender` is the single point of egress for all outbound
messages.  It resolves the correct delivery channel (bot adapter) for the
target platform and translates the internal :class:`MessageResponse` /
:class:`OutboundMessage` format into channel-specific API calls.

Design goals
------------
- **Channel-agnostic**: callers work with internal models only; they never
  need to know which platform the message will be delivered to.
- **Rich content support**: automatically chooses ``send_rich_content``,
  ``send_buttons``, or ``send_message`` based on the response content.
- **Proactive sends**: supports both reply-to-inbound and service-initiated
  outbound messages (e.g. scheduled vocabulary reminders).
- **Retry & error handling**: wraps delivery failures into a consistent
  :class:`SendResult` that callers can inspect.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.delivery.base import (
    ContentBlock,
    ContentType,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.messenger import Button, MessengerBotChannel, QuickReply
from app.messaging.models import InboundMessage, MessageResponse, MessageSource

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Outbound message model (for proactive / service-initiated sends)
# ---------------------------------------------------------------------------


class OutboundContentType(str, Enum):
    """Type of outbound message content."""

    TEXT = "text"
    RICH = "rich"
    BUTTONS = "buttons"
    QUICK_REPLIES = "quick_replies"


@dataclass
class OutboundMessage:
    """A proactive outbound message to be sent to a user.

    Unlike :class:`MessageResponse` (which is always a reply to an inbound
    message), ``OutboundMessage`` can be created by any part of the system
    — scheduled jobs, service plugins, admin tools — and sent to any user
    on any platform.

    Attributes
    ----------
    target:
        Destination identified by platform, sender_id, and chat_id.
    text:
        Plain-text body (always set, even alongside rich content).
    content_type:
        Hint about what kind of content this message carries.
    rich_content:
        Optional :class:`RichContent` for structured messages.
    buttons:
        Optional inline button rows (for platforms that support them).
    quick_replies:
        Optional quick-reply options (ephemeral choice buttons).
    metadata:
        Transport-level hints (e.g. ``parse_mode``, ``reply_to_message_id``).
    """

    target: MessageSource
    text: str = ""
    content_type: OutboundContentType = OutboundContentType.TEXT
    rich_content: RichContent | None = None
    buttons: list[list[Button]] | None = None
    quick_replies: list[QuickReply] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Send result
# ---------------------------------------------------------------------------


@dataclass
class SendResult:
    """Outcome of a send operation through the message sending pipeline.

    Aggregates the underlying :class:`DeliveryResult` with pipeline-level
    metadata such as whether the message was queued, retried, etc.
    """

    success: bool
    platform: str
    recipient_id: str
    message_id: str | None = None
    error: str | None = None
    delivery_result: DeliveryResult | None = None

    @property
    def failed(self) -> bool:
        return not self.success


# ---------------------------------------------------------------------------
# Channel resolver protocol
# ---------------------------------------------------------------------------


class ChannelResolver:
    """Resolves a platform name to the appropriate bot adapter / channel.

    Wraps the bot adapter registry so that :class:`MessageSender` doesn't
    depend on the global ``_adapters`` dict in ``webhook_routes``.
    """

    def __init__(self) -> None:
        self._adapters: dict[str, MessengerBotChannel] = {}

    def register(self, platform: str, channel: MessengerBotChannel) -> None:
        """Register a delivery channel for a platform."""
        self._adapters[platform] = channel
        logger.info("ChannelResolver: registered channel for '%s'", platform)

    def unregister(self, platform: str) -> bool:
        """Remove a channel.  Returns True if it was registered."""
        return self._adapters.pop(platform, None) is not None

    def get(self, platform: str) -> MessengerBotChannel | None:
        """Get the delivery channel for a platform."""
        return self._adapters.get(platform)

    def list_platforms(self) -> list[str]:
        """Return all registered platform names."""
        return list(self._adapters.keys())

    def has(self, platform: str) -> bool:
        """Check if a channel is registered for a platform."""
        return platform in self._adapters


# ---------------------------------------------------------------------------
# Message sender
# ---------------------------------------------------------------------------


class MessageSender:
    """Outbound message sending pipeline.

    Central service for delivering messages back to users.  Supports:

    - **Reply sends**: given an :class:`InboundMessage` and a
      :class:`MessageResponse`, sends the reply to the originating chat.
    - **Proactive sends**: given an :class:`OutboundMessage`, delivers it
      to the specified target on the specified platform.
    - **Direct sends**: low-level ``send_text`` / ``send_rich`` helpers
      for simple use-cases.

    Usage::

        resolver = ChannelResolver()
        resolver.register("telegram", telegram_adapter)

        sender = MessageSender(resolver)

        # Reply to an inbound message
        result = await sender.send_response(inbound_msg, response)

        # Proactive outbound send
        outbound = OutboundMessage(
            target=MessageSource("telegram", "12345", "12345"),
            text="Time for your daily vocab!",
        )
        result = await sender.send_outbound(outbound)
    """

    def __init__(self, resolver: ChannelResolver) -> None:
        self._resolver = resolver

    @property
    def resolver(self) -> ChannelResolver:
        """Access the underlying channel resolver."""
        return self._resolver

    # -- High-level: reply to inbound message --------------------------------

    async def send_response(
        self,
        inbound: InboundMessage,
        response: MessageResponse,
    ) -> SendResult:
        """Send a :class:`MessageResponse` back to the originating user/chat.

        This is the primary method called from the webhook pipeline after a
        handler produces a response.

        Parameters
        ----------
        inbound:
            The original inbound message (provides source platform & chat_id).
        response:
            The handler's response to send back.

        Returns
        -------
        SendResult
            Outcome of the send operation.
        """
        if not response.text and not response.rich_content:
            return SendResult(
                success=False,
                platform=inbound.source.platform,
                recipient_id=inbound.source.chat_id,
                error="Empty response — nothing to send",
            )

        channel = self._resolver.get(inbound.source.platform)
        if channel is None:
            return SendResult(
                success=False,
                platform=inbound.source.platform,
                recipient_id=inbound.source.chat_id,
                error=f"No channel registered for platform '{inbound.source.platform}'",
            )

        # Build metadata — merge response metadata with reply hint
        metadata = dict(response.metadata)
        if inbound.message_id:
            metadata.setdefault("reply_to_message_id", inbound.message_id)

        # Decide how to send based on content
        if response.rich_content:
            rich = self._dict_to_rich_content(response.rich_content)
            return await self._send_via_channel(
                channel,
                inbound.source.platform,
                inbound.source.chat_id,
                rich_content=rich,
                metadata=metadata,
            )

        return await self._send_via_channel(
            channel,
            inbound.source.platform,
            inbound.source.chat_id,
            text=response.text,
            metadata=metadata,
        )

    # -- High-level: proactive outbound message ------------------------------

    async def send_outbound(self, message: OutboundMessage) -> SendResult:
        """Send a proactive :class:`OutboundMessage` to a user.

        Used by service plugins, scheduled jobs, and other system components
        that need to push content to users outside the request/response cycle.

        Parameters
        ----------
        message:
            The outbound message to deliver.

        Returns
        -------
        SendResult
            Outcome of the send operation.
        """
        channel = self._resolver.get(message.target.platform)
        if channel is None:
            return SendResult(
                success=False,
                platform=message.target.platform,
                recipient_id=message.target.chat_id,
                error=f"No channel registered for platform '{message.target.platform}'",
            )

        recipient_id = message.target.chat_id

        # Route based on content type
        if message.content_type == OutboundContentType.BUTTONS and message.buttons:
            return await self._send_buttons(
                channel,
                message.target.platform,
                recipient_id,
                message.text,
                message.buttons,
                metadata=message.metadata,
            )

        if message.content_type == OutboundContentType.QUICK_REPLIES and message.quick_replies:
            return await self._send_quick_replies(
                channel,
                message.target.platform,
                recipient_id,
                message.text,
                message.quick_replies,
                metadata=message.metadata,
            )

        if message.content_type == OutboundContentType.RICH and message.rich_content:
            return await self._send_via_channel(
                channel,
                message.target.platform,
                recipient_id,
                rich_content=message.rich_content,
                metadata=message.metadata,
            )

        # Default: plain text
        return await self._send_via_channel(
            channel,
            message.target.platform,
            recipient_id,
            text=message.text,
            metadata=message.metadata,
        )

    # -- Low-level helpers ---------------------------------------------------

    async def send_text(
        self,
        platform: str,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Send a plain text message directly.

        Convenience method for simple sends without constructing full
        :class:`OutboundMessage` objects.
        """
        channel = self._resolver.get(platform)
        if channel is None:
            return SendResult(
                success=False,
                platform=platform,
                recipient_id=recipient_id,
                error=f"No channel registered for platform '{platform}'",
            )
        return await self._send_via_channel(
            channel, platform, recipient_id, text=text, metadata=metadata or {},
        )

    async def send_rich(
        self,
        platform: str,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Send rich content directly."""
        channel = self._resolver.get(platform)
        if channel is None:
            return SendResult(
                success=False,
                platform=platform,
                recipient_id=recipient_id,
                error=f"No channel registered for platform '{platform}'",
            )
        return await self._send_via_channel(
            channel, platform, recipient_id, rich_content=content, metadata=metadata or {},
        )

    # -- Internal send dispatch ----------------------------------------------

    async def _send_via_channel(
        self,
        channel: MessengerBotChannel,
        platform: str,
        recipient_id: str,
        *,
        text: str | None = None,
        rich_content: RichContent | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Dispatch a send through the resolved channel."""
        try:
            if rich_content is not None:
                delivery = await channel.send_rich_content(
                    recipient_id, rich_content, metadata=metadata
                )
            elif text:
                delivery = await channel.send_message(
                    recipient_id, text, metadata=metadata
                )
            else:
                return SendResult(
                    success=False,
                    platform=platform,
                    recipient_id=recipient_id,
                    error="No content to send",
                )

            success = delivery.status in (DeliveryStatus.SENT, DeliveryStatus.DELIVERED)
            return SendResult(
                success=success,
                platform=platform,
                recipient_id=recipient_id,
                message_id=delivery.message_id,
                error=delivery.error if not success else None,
                delivery_result=delivery,
            )
        except Exception as exc:
            logger.exception(
                "Failed to send message to %s/%s", platform, recipient_id
            )
            return SendResult(
                success=False,
                platform=platform,
                recipient_id=recipient_id,
                error=str(exc),
            )

    async def _send_buttons(
        self,
        channel: MessengerBotChannel,
        platform: str,
        recipient_id: str,
        text: str,
        buttons: list[list[Button]],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Send a message with inline buttons."""
        try:
            delivery = await channel.send_buttons(
                recipient_id, text, buttons, metadata=metadata
            )
            success = delivery.status in (DeliveryStatus.SENT, DeliveryStatus.DELIVERED)
            return SendResult(
                success=success,
                platform=platform,
                recipient_id=recipient_id,
                message_id=delivery.message_id,
                error=delivery.error if not success else None,
                delivery_result=delivery,
            )
        except Exception as exc:
            logger.exception(
                "Failed to send buttons to %s/%s", platform, recipient_id
            )
            return SendResult(
                success=False,
                platform=platform,
                recipient_id=recipient_id,
                error=str(exc),
            )

    async def _send_quick_replies(
        self,
        channel: MessengerBotChannel,
        platform: str,
        recipient_id: str,
        text: str,
        quick_replies: list[QuickReply],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> SendResult:
        """Send a message with quick-reply options."""
        try:
            delivery = await channel.send_quick_replies(
                recipient_id, text, quick_replies, metadata=metadata
            )
            success = delivery.status in (DeliveryStatus.SENT, DeliveryStatus.DELIVERED)
            return SendResult(
                success=success,
                platform=platform,
                recipient_id=recipient_id,
                message_id=delivery.message_id,
                error=delivery.error if not success else None,
                delivery_result=delivery,
            )
        except Exception as exc:
            logger.exception(
                "Failed to send quick replies to %s/%s", platform, recipient_id
            )
            return SendResult(
                success=False,
                platform=platform,
                recipient_id=recipient_id,
                error=str(exc),
            )

    # -- Content conversion --------------------------------------------------

    @staticmethod
    def _dict_to_rich_content(data: dict[str, Any]) -> RichContent:
        """Convert a handler's rich_content dict into a :class:`RichContent`.

        Handlers produce ``rich_content`` as a plain dict for simplicity.
        This method converts it into the typed model that delivery channels
        expect.

        Supported dict formats::

            # Shorthand — list of blocks
            {"blocks": [{"type": "text", "data": {"text": "Hello"}}]}

            # Just text
            {"text": "Hello world"}
        """
        if "blocks" in data:
            blocks = []
            for block_data in data["blocks"]:
                content_type = ContentType(block_data.get("type", "text"))
                blocks.append(ContentBlock(
                    type=content_type,
                    data=block_data.get("data", {}),
                ))
            return RichContent(
                blocks=blocks,
                metadata=data.get("metadata", {}),
            )

        # Treat the whole dict as a single text block
        if "text" in data:
            return RichContent(
                blocks=[ContentBlock(type=ContentType.TEXT, data={"text": data["text"]})],
                metadata=data.get("metadata", {}),
            )

        # Last resort — wrap raw dict as metadata
        return RichContent(
            blocks=[ContentBlock(type=ContentType.TEXT, data=data)],
        )
