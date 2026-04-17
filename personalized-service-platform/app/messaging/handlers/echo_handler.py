"""Fallback echo handler — catches unhandled text messages.

This is a low-priority handler that acknowledges any text message not
claimed by higher-priority handlers. Useful as a development fallback
and as a base for future AI routing integration.
"""

from __future__ import annotations

from app.messaging.handler import MessageHandler
from app.messaging.models import InboundMessage, MessageResponse, MessageType


class EchoFallbackHandler(MessageHandler):
    """Fallback handler that echoes unrecognized text messages.

    This handler has the lowest priority and accepts any text message.
    It's intended as a placeholder until AI-powered routing is available.
    """

    @property
    def name(self) -> str:
        return "echo_fallback"

    @property
    def priority(self) -> int:
        return 999  # lowest priority — fallback

    @property
    def supported_types(self) -> set[MessageType]:
        return {MessageType.TEXT}

    async def can_handle(self, message: InboundMessage) -> bool:
        return message.is_text and bool(message.text.strip())

    async def handle(self, message: InboundMessage) -> MessageResponse:
        return MessageResponse(
            text=f"I received your message: \"{message.text[:100]}\".\n"
            "I don't have a specific handler for that yet. Try /help for available commands.",
            handled=True,
        )
