"""Webhook routes for messenger bot adapters.

Provides FastAPI routes for:
- Receiving inbound webhook events from messenger platforms
- Bot status / health introspection
- Webhook registration management
- Message pipeline integration for routing to handlers
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.bot.adapter import BotAdapter
from app.messaging.pipeline import MessagePipeline
from app.messaging.sender import ChannelResolver, MessageSender

logger = logging.getLogger(__name__)

webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# ---------------------------------------------------------------------------
# Bot adapter registry — adapters register here at startup
# ---------------------------------------------------------------------------

_adapters: dict[str, BotAdapter] = {}

# ---------------------------------------------------------------------------
# Message pipeline & sender — shared instances
# ---------------------------------------------------------------------------

_pipeline: MessagePipeline | None = None
_sender: MessageSender | None = None
_resolver: ChannelResolver = ChannelResolver()


def register_bot_adapter(platform: str, adapter: BotAdapter) -> None:
    """Register a bot adapter for a platform (e.g. 'telegram').

    Also registers the adapter with the channel resolver so the
    :class:`MessageSender` can route outbound messages to it.
    """
    _adapters[platform] = adapter
    _resolver.register(platform, adapter)
    logger.info("Registered bot adapter for platform '%s'", platform)


def get_bot_adapter(platform: str) -> BotAdapter | None:
    """Get the bot adapter for a platform."""
    return _adapters.get(platform)


def list_bot_adapters() -> dict[str, BotAdapter]:
    """Return all registered bot adapters."""
    return dict(_adapters)


def set_message_pipeline(pipeline: MessagePipeline) -> None:
    """Set the message pipeline used by the webhook endpoint."""
    global _pipeline
    _pipeline = pipeline
    logger.info("Message pipeline configured with %d handlers", len(pipeline.list_handlers()))


def get_message_pipeline() -> MessagePipeline | None:
    """Get the current message pipeline (if configured)."""
    return _pipeline


def get_message_sender() -> MessageSender:
    """Get (or lazily create) the shared :class:`MessageSender` instance."""
    global _sender
    if _sender is None:
        _sender = MessageSender(_resolver)
    return _sender


def set_message_sender(sender: MessageSender) -> None:
    """Override the shared message sender (useful for testing)."""
    global _sender
    _sender = sender


def get_channel_resolver() -> ChannelResolver:
    """Get the shared channel resolver."""
    return _resolver


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class WebhookRegisterRequest(BaseModel):
    webhook_url: str


class BotStatusResponse(BaseModel):
    platform: str
    state: str
    bot_id: str | None = None
    bot_username: str | None = None
    webhook_url: str | None = None
    webhook_active: bool = False
    last_error: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@webhook_router.post("/{platform}")
async def receive_webhook(platform: str, request: Request) -> dict[str, Any]:
    """Receive an inbound webhook event from a messenger platform.

    The raw JSON body is passed to the platform's bot adapter for parsing,
    then normalized into an :class:`InboundMessage` and routed through the
    message pipeline to the appropriate handler.

    If a pipeline is configured and a handler produces a response, the
    response is sent back through the originating bot adapter.
    """
    adapter = _adapters.get(platform)
    if not adapter:
        raise HTTPException(
            status_code=404,
            detail=f"No bot adapter registered for platform '{platform}'",
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    webhook_payload = await adapter.handle_webhook(payload)
    logger.info(
        "Webhook event from %s: type=%s sender=%s chat=%s",
        platform,
        webhook_payload.event_type.value,
        webhook_payload.sender_id,
        webhook_payload.chat_id,
    )

    result: dict[str, Any] = {
        "status": "ok",
        "event_type": webhook_payload.event_type.value,
        "sender_id": webhook_payload.sender_id,
        "chat_id": webhook_payload.chat_id,
    }

    # Route through the message pipeline if configured
    if _pipeline is not None:
        inbound, response = await _pipeline.handle_webhook(
            webhook_payload, platform=platform
        )
        result["handled"] = response.handled
        result["handler_response"] = response.text[:200] if response.text else None

        # Send reply back through the message sending pipeline
        if response.handled and (response.text or response.rich_content) and webhook_payload.chat_id:
            sender = get_message_sender()
            send_result = await sender.send_response(inbound, response)
            result["reply_sent"] = "sent" if send_result.success else "failed"
            if send_result.message_id:
                result["reply_message_id"] = send_result.message_id
            if send_result.error:
                result["reply_error"] = send_result.error

    return result


@webhook_router.post("/{platform}/register")
async def register_webhook(
    platform: str,
    req: WebhookRegisterRequest,
) -> dict[str, Any]:
    """Register (or update) the webhook URL for a platform."""
    adapter = _adapters.get(platform)
    if not adapter:
        raise HTTPException(
            status_code=404,
            detail=f"No bot adapter registered for platform '{platform}'",
        )

    success = await adapter.register_webhook(req.webhook_url)
    if not success:
        info = adapter.get_connection_info()
        raise HTTPException(
            status_code=502,
            detail=f"Failed to register webhook: {info.last_error}",
        )

    return {"status": "registered", "webhook_url": req.webhook_url}


@webhook_router.delete("/{platform}/register")
async def unregister_webhook(platform: str) -> dict[str, Any]:
    """Remove the webhook URL for a platform."""
    adapter = _adapters.get(platform)
    if not adapter:
        raise HTTPException(
            status_code=404,
            detail=f"No bot adapter registered for platform '{platform}'",
        )

    success = await adapter.unregister_webhook()
    if not success:
        info = adapter.get_connection_info()
        raise HTTPException(
            status_code=502,
            detail=f"Failed to unregister webhook: {info.last_error}",
        )

    return {"status": "unregistered"}


@webhook_router.get("/{platform}/status", response_model=BotStatusResponse)
async def bot_status(platform: str) -> BotStatusResponse:
    """Get the connection status of a bot adapter."""
    adapter = _adapters.get(platform)
    if not adapter:
        raise HTTPException(
            status_code=404,
            detail=f"No bot adapter registered for platform '{platform}'",
        )

    info = adapter.get_connection_info()
    return BotStatusResponse(
        platform=platform,
        state=info.state.value,
        bot_id=info.bot_id,
        bot_username=info.bot_username,
        webhook_url=info.webhook_url,
        webhook_active=info.webhook_active,
        last_error=info.last_error,
    )


@webhook_router.get("/", tags=["webhooks"])
async def list_adapters() -> dict[str, Any]:
    """List all registered bot adapters and their status."""
    statuses = []
    for platform, adapter in _adapters.items():
        info = adapter.get_connection_info()
        statuses.append({
            "platform": platform,
            "state": info.state.value,
            "bot_username": info.bot_username,
            "webhook_active": info.webhook_active,
        })
    return {"adapters": statuses}
