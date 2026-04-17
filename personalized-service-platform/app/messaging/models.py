"""Normalized internal message models.

These models are fully platform-agnostic. Any messenger adapter converts its
raw webhook payload into an :class:`InboundMessage`, and handlers produce
:class:`MessageResponse` objects that the pipeline routes back through the
originating delivery channel.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class MessageType(str, Enum):
    """High-level classification of an inbound message."""

    TEXT = "text"
    COMMAND = "command"
    CALLBACK = "callback"
    EVENT = "event"  # join, leave, etc.


@dataclass(frozen=True)
class MessageSource:
    """Identifies where a message came from.

    Attributes
    ----------
    platform:
        Messenger platform name (e.g. ``"telegram"``, ``"slack"``).
    sender_id:
        Platform-specific user identifier.
    chat_id:
        Platform-specific conversation/chat identifier.
    """

    platform: str
    sender_id: str
    chat_id: str


@dataclass
class InboundMessage:
    """Fully normalized internal representation of an incoming user message.

    Created by the :class:`MessagePipeline` from a :class:`WebhookPayload`.
    Handlers receive this model and never need to know which platform sent it.

    Attributes
    ----------
    source:
        Where the message originated (platform, sender, chat).
    message_type:
        High-level classification (text, command, callback, event).
    text:
        The message text content (empty for non-text events).
    command:
        Extracted command name (e.g. ``"start"``, ``"help"``), if the message
        is a command.  ``None`` for non-command messages.
    command_args:
        Arguments following the command, split by whitespace.
    callback_data:
        Payload from an interactive button press, if applicable.
    message_id:
        Platform-specific message identifier, when available.
    raw:
        The original unmodified webhook payload (for debugging / fallback).
    metadata:
        Arbitrary extra data attached during pipeline processing.
    """

    source: MessageSource
    message_type: MessageType
    text: str = ""
    command: str | None = None
    command_args: list[str] = field(default_factory=list)
    callback_data: str | None = None
    message_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_command(self) -> bool:
        """Whether this message is a bot command."""
        return self.message_type == MessageType.COMMAND

    @property
    def is_text(self) -> bool:
        """Whether this is a plain text message (not a command)."""
        return self.message_type == MessageType.TEXT

    @property
    def is_callback(self) -> bool:
        """Whether this is an interactive button callback."""
        return self.message_type == MessageType.CALLBACK

    @property
    def full_command_text(self) -> str:
        """Reconstruct the full command text (e.g. ``"/start arg1 arg2"``)."""
        if not self.command:
            return ""
        parts = [f"/{self.command}"] + self.command_args
        return " ".join(parts)


@dataclass
class MessageResponse:
    """Response produced by a message handler.

    The pipeline sends this back to the user through the originating channel.

    Attributes
    ----------
    text:
        Plain-text response to send to the user.
    rich_content:
        Optional structured content payload (for channels that support it).
    metadata:
        Extra instructions for the delivery layer (e.g. ``parse_mode``).
    handled:
        Whether the handler actually processed the message.  If ``False``,
        the pipeline continues to the next handler in the chain.
    error:
        Error message, if the handler encountered a problem.
    """

    text: str = ""
    rich_content: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    handled: bool = True
    error: str | None = None

    @property
    def is_error(self) -> bool:
        return self.error is not None
