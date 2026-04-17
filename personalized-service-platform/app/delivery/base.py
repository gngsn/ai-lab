"""Base DeliveryChannel abstract interface.

All delivery channels (Telegram, Slack, email, push, etc.) implement this
protocol so that service plugins remain completely channel-agnostic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Content models — channel-agnostic representations of rich content
# ---------------------------------------------------------------------------

class ContentType(str, Enum):
    """Supported rich-content block types."""
    TEXT = "text"
    IMAGE = "image"
    BUTTON = "button"
    CARD = "card"
    LIST = "list"
    CODE = "code"
    FILE = "file"


@dataclass(frozen=True)
class ContentBlock:
    """A single block inside a rich-content message.

    Channels map these blocks to their native widget / markup.
    """
    type: ContentType
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RichContent:
    """Channel-agnostic rich message composed of ordered content blocks."""
    blocks: list[ContentBlock] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Delivery result
# ---------------------------------------------------------------------------

class DeliveryStatus(str, Enum):
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    PENDING = "pending"


@dataclass
class DeliveryResult:
    """Outcome returned by every send operation."""
    channel_name: str
    status: DeliveryStatus
    message_id: str | None = None
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Channel info
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChannelInfo:
    """Describes a channel's identity and capabilities."""
    name: str
    channel_type: str  # e.g. "telegram", "slack", "email", "push"
    supports_rich_content: bool = True
    supports_buttons: bool = False
    supports_images: bool = False
    supports_files: bool = False
    max_message_length: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Base abstract class
# ---------------------------------------------------------------------------

class DeliveryChannel(ABC):
    """Abstract interface that every delivery channel must implement.

    Service plugins call these methods through a channel-agnostic reference
    so the same service logic works across Telegram, Slack, email, push, etc.
    """

    # -- Core messaging -----------------------------------------------------

    @abstractmethod
    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send a plain-text message to *recipient_id*.

        Parameters
        ----------
        recipient_id:
            Platform-specific user/chat identifier.
        text:
            Plain-text body.
        metadata:
            Optional key-value pairs forwarded to the underlying transport
            (e.g. ``parse_mode``, ``reply_to_message_id``).
        """
        ...

    @abstractmethod
    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send structured rich content (cards, buttons, images, …).

        The channel implementation is responsible for mapping each
        :class:`ContentBlock` to its native representation.

        Parameters
        ----------
        recipient_id:
            Platform-specific user/chat identifier.
        content:
            A :class:`RichContent` instance holding ordered content blocks.
        metadata:
            Optional transport-level overrides.
        """
        ...

    # -- Introspection ------------------------------------------------------

    @abstractmethod
    def get_channel_info(self) -> ChannelInfo:
        """Return metadata describing this channel's capabilities.

        Service plugins can inspect the result to decide which content types
        are safe to send (e.g. skip images on channels that don't support
        them).
        """
        ...

    # -- Formatting ---------------------------------------------------------

    @abstractmethod
    def format_content(
        self,
        content: RichContent,
    ) -> str | dict[str, Any]:
        """Convert channel-agnostic :class:`RichContent` into the native
        format expected by this channel's transport layer.

        Implementations may return either:
        * a ``str`` — ready-to-send plain/rich text (Markdown, HTML, …), or
        * a ``dict`` — a structured payload the transport API accepts directly.

        This is a *synchronous* helper so that callers can inspect the
        formatted output before deciding to send.
        """
        ...
