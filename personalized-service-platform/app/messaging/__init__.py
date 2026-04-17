"""Messaging pipeline — normalized message model, handler interface, and router.

This package implements the full inbound/outbound message pipeline:

1. Webhook endpoints receive raw platform payloads.
2. Bot adapters parse them into :class:`WebhookPayload` (platform-specific normalization).
3. The :class:`MessagePipeline` converts them into :class:`InboundMessage` (fully normalized).
4. Registered :class:`MessageHandler` instances process the message and produce responses.
5. The :class:`MessageSender` sends responses back through the originating delivery channel.
6. Proactive :class:`OutboundMessage` can be sent to any user on any platform.
"""

from app.messaging.models import InboundMessage, MessageResponse, MessageSource
from app.messaging.handler import MessageHandler
from app.messaging.pipeline import MessagePipeline
from app.messaging.sender import (
    ChannelResolver,
    MessageSender,
    OutboundContentType,
    OutboundMessage,
    SendResult,
)

__all__ = [
    "ChannelResolver",
    "InboundMessage",
    "MessageHandler",
    "MessagePipeline",
    "MessageResponse",
    "MessageSender",
    "MessageSource",
    "OutboundContentType",
    "OutboundMessage",
    "SendResult",
]
