"""Message pipeline — converts webhook payloads to normalized messages and routes them.

The pipeline is the central orchestrator for inbound message processing:

1. Receives a :class:`WebhookPayload` from a bot adapter.
2. Converts it into an :class:`InboundMessage` (platform-agnostic).
3. Iterates through registered handlers in priority order.
4. Returns the response from the first handler that claims the message.
5. Optionally sends the response back through the originating channel.

The pipeline is fully platform-agnostic — it doesn't know about Telegram,
Slack, or any other platform. It only works with normalized models.
"""

from __future__ import annotations

import logging
from typing import Any

from app.delivery.messenger import WebhookEvent, WebhookPayload
from app.messaging.handler import MessageHandler
from app.messaging.models import (
    InboundMessage,
    MessageResponse,
    MessageSource,
    MessageType,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WebhookEvent → MessageType mapping
# ---------------------------------------------------------------------------

_EVENT_TYPE_MAP: dict[WebhookEvent, MessageType] = {
    WebhookEvent.MESSAGE: MessageType.TEXT,
    WebhookEvent.COMMAND: MessageType.COMMAND,
    WebhookEvent.CALLBACK: MessageType.CALLBACK,
    WebhookEvent.MEMBER_JOIN: MessageType.EVENT,
    WebhookEvent.MEMBER_LEAVE: MessageType.EVENT,
    WebhookEvent.UNKNOWN: MessageType.EVENT,
}


def _extract_command(text: str) -> tuple[str | None, list[str]]:
    """Extract a command name and args from message text.

    Examples
    --------
    >>> _extract_command("/start arg1 arg2")
    ("start", ["arg1", "arg2"])
    >>> _extract_command("/help")
    ("help", [])
    >>> _extract_command("hello")
    (None, [])
    """
    if not text or not text.startswith("/"):
        return None, []
    parts = text.strip().split()
    # Remove leading "/" and any @bot_name suffix (e.g. "/start@mybot")
    cmd = parts[0][1:]  # strip "/"
    if "@" in cmd:
        cmd = cmd.split("@", 1)[0]
    return cmd, parts[1:]


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


class MessagePipeline:
    """Inbound message processing pipeline.

    Usage::

        pipeline = MessagePipeline()
        pipeline.register_handler(PreferenceHandler(repo))
        pipeline.register_handler(PluginRouterHandler(registry))
        pipeline.register_handler(FallbackHandler())

        # In webhook route:
        webhook_payload = await adapter.handle_webhook(raw_payload)
        inbound = pipeline.normalize(webhook_payload, platform="telegram")
        response = await pipeline.process(inbound)
    """

    def __init__(self) -> None:
        self._handlers: list[MessageHandler] = []

    # -- Handler registration -----------------------------------------------

    def register_handler(self, handler: MessageHandler) -> None:
        """Register a message handler.

        Handlers are kept sorted by priority (lower = higher precedence).
        """
        self._handlers.append(handler)
        self._handlers.sort(key=lambda h: h.priority)
        logger.info(
            "Registered message handler '%s' (priority=%d)",
            handler.name,
            handler.priority,
        )

    def unregister_handler(self, name: str) -> bool:
        """Remove a handler by name.  Returns True if found and removed."""
        before = len(self._handlers)
        self._handlers = [h for h in self._handlers if h.name != name]
        removed = len(self._handlers) < before
        if removed:
            logger.info("Unregistered message handler '%s'", name)
        return removed

    def list_handlers(self) -> list[dict[str, Any]]:
        """Return metadata about all registered handlers."""
        return [
            {
                "name": h.name,
                "priority": h.priority,
                "supported_types": [t.value for t in h.supported_types] or ["all"],
            }
            for h in self._handlers
        ]

    # -- Normalization ------------------------------------------------------

    @staticmethod
    def normalize(
        payload: WebhookPayload,
        *,
        platform: str,
    ) -> InboundMessage:
        """Convert a :class:`WebhookPayload` into an :class:`InboundMessage`.

        Parameters
        ----------
        payload:
            The parsed webhook payload from a bot adapter.
        platform:
            The messenger platform name (e.g. ``"telegram"``).

        Returns
        -------
        InboundMessage
            Fully normalized, platform-agnostic message.
        """
        message_type = _EVENT_TYPE_MAP.get(payload.event_type, MessageType.EVENT)

        command = None
        command_args: list[str] = []
        if message_type == MessageType.COMMAND:
            command, command_args = _extract_command(payload.text)

        return InboundMessage(
            source=MessageSource(
                platform=platform,
                sender_id=payload.sender_id,
                chat_id=payload.chat_id,
            ),
            message_type=message_type,
            text=payload.text,
            command=command,
            command_args=command_args,
            callback_data=payload.callback_data,
            message_id=payload.message_id,
            raw=payload.raw,
        )

    # -- Processing ---------------------------------------------------------

    async def process(self, message: InboundMessage) -> MessageResponse:
        """Route an inbound message through the handler chain.

        Handlers are tried in priority order.  The first handler where
        ``can_handle()`` returns ``True`` gets its ``handle()`` called.
        If that handler returns ``handled=True``, the pipeline stops.
        Otherwise, subsequent handlers are tried.

        If no handler claims the message, a default "unhandled" response
        is returned.

        Parameters
        ----------
        message:
            The normalized inbound message to process.

        Returns
        -------
        MessageResponse
            The response from the first successful handler, or a default
            fallback response.
        """
        for handler in self._handlers:
            # Check type filter
            if handler.supported_types and message.message_type not in handler.supported_types:
                continue

            try:
                if not await handler.can_handle(message):
                    continue
            except Exception:
                logger.exception(
                    "Handler '%s' raised during can_handle()", handler.name
                )
                continue

            try:
                response = await handler.handle(message)
                if response.handled:
                    logger.info(
                        "Message from %s/%s handled by '%s'",
                        message.source.platform,
                        message.source.sender_id,
                        handler.name,
                    )
                    return response
                # handler declined — continue to next
            except Exception:
                logger.exception(
                    "Handler '%s' raised during handle()", handler.name
                )
                continue

        # No handler claimed it
        logger.info(
            "No handler claimed message from %s/%s (type=%s, text=%r)",
            message.source.platform,
            message.source.sender_id,
            message.message_type.value,
            message.text[:50] if message.text else "",
        )
        return MessageResponse(
            text="I'm not sure how to handle that. Try /help for available commands.",
            handled=False,
        )

    # -- Full pipeline: normalize + process ---------------------------------

    async def handle_webhook(
        self,
        payload: WebhookPayload,
        *,
        platform: str,
    ) -> tuple[InboundMessage, MessageResponse]:
        """Convenience: normalize a webhook payload and process it.

        Returns
        -------
        tuple[InboundMessage, MessageResponse]
            Both the normalized message and the handler response.
        """
        message = self.normalize(payload, platform=platform)
        response = await self.process(message)
        return message, response
