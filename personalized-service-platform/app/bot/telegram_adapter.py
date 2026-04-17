"""TelegramBotAdapter — concrete Telegram bot adapter.

Implements :class:`BotAdapter` for the Telegram Bot API.  Uses ``httpx``
for async HTTP calls to ``https://api.telegram.org/bot<token>/…``.

Features:
- Token validation via ``getMe``
- Webhook registration / removal via ``setWebhook`` / ``deleteWebhook``
- Connection state tracking
- Inbound webhook payload parsing → :class:`WebhookPayload`
- Outbound messaging (text, rich content, quick replies, inline keyboards)
- User profile retrieval via ``getChat``
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.bot.adapter import BotAdapter, ConnectionInfo, ConnectionState
from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.messenger import (
    Button,
    QuickReply,
    UserProfile,
    WebhookEvent,
    WebhookPayload,
)

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramBotAdapter(BotAdapter):
    """Concrete Telegram bot adapter.

    Parameters
    ----------
    token:
        Telegram Bot API token (from @BotFather).
    api_base_url:
        Base URL for the Telegram API.  Override for testing.
    http_client:
        Optional pre-configured ``httpx.AsyncClient``.  If not provided,
        one is created internally.
    """

    def __init__(
        self,
        token: str,
        *,
        api_base_url: str = TELEGRAM_API_BASE,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__()
        if not token:
            raise ValueError("Telegram bot token must not be empty")
        self._token = token
        self._api_base = api_base_url.rstrip("/")
        self._base_url = f"{self._api_base}/bot{self._token}"
        self._client = http_client or httpx.AsyncClient(timeout=30.0)
        self._owns_client = http_client is None

    # -- Telegram API helpers -----------------------------------------------

    async def _api_call(
        self,
        method: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Call a Telegram Bot API method and return the JSON result.

        Raises
        ------
        httpx.HTTPStatusError
            On non-2xx responses.
        ValueError
            If the Telegram API returns ``ok: false``.
        """
        url = f"{self._base_url}/{method}"
        response = await self._client.post(url, json=data or {})
        response.raise_for_status()
        body = response.json()
        if not body.get("ok"):
            description = body.get("description", "Unknown error")
            raise ValueError(f"Telegram API error: {description}")
        return body.get("result", {})

    # -- Connection lifecycle (BotAdapter) -----------------------------------

    async def connect(self) -> ConnectionInfo:
        """Validate the bot token by calling ``getMe``."""
        self._connection.state = ConnectionState.CONNECTING
        try:
            me = await self._api_call("getMe")
            self._connection.state = ConnectionState.CONNECTED
            self._connection.bot_id = str(me.get("id", ""))
            self._connection.bot_username = me.get("username")
            self._connection.last_error = None
            logger.info(
                "Telegram bot connected: @%s (id=%s)",
                self._connection.bot_username,
                self._connection.bot_id,
            )
        except Exception as exc:
            self._connection.state = ConnectionState.ERROR
            self._connection.last_error = str(exc)
            logger.error("Failed to connect Telegram bot: %s", exc)
        return self._connection

    async def disconnect(self) -> ConnectionInfo:
        """Disconnect: remove webhook and close internal HTTP client."""
        try:
            if self._connection.webhook_active:
                await self.unregister_webhook()
        except Exception as exc:
            logger.warning("Error removing webhook during disconnect: %s", exc)
        finally:
            self._connection.state = ConnectionState.DISCONNECTED
            self._connection.bot_id = None
            self._connection.bot_username = None
            self._connection.webhook_url = None
            self._connection.webhook_active = False
            if self._owns_client:
                await self._client.aclose()
        return self._connection

    async def register_webhook(self, webhook_url: str) -> bool:
        """Register (or update) the Telegram webhook URL."""
        try:
            await self._api_call("setWebhook", {"url": webhook_url})
            self._connection.webhook_url = webhook_url
            self._connection.webhook_active = True
            logger.info("Telegram webhook registered: %s", webhook_url)
            return True
        except Exception as exc:
            self._connection.last_error = str(exc)
            logger.error("Failed to register Telegram webhook: %s", exc)
            return False

    async def unregister_webhook(self) -> bool:
        """Remove the Telegram webhook."""
        try:
            await self._api_call("deleteWebhook")
            self._connection.webhook_url = None
            self._connection.webhook_active = False
            logger.info("Telegram webhook removed")
            return True
        except Exception as exc:
            self._connection.last_error = str(exc)
            logger.error("Failed to remove Telegram webhook: %s", exc)
            return False

    # -- DeliveryChannel methods --------------------------------------------

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="telegram",
            channel_type="telegram",
            supports_rich_content=True,
            supports_buttons=True,
            supports_images=True,
            supports_files=True,
            max_message_length=4096,
            extra={
                "bot_id": self._connection.bot_id,
                "bot_username": self._connection.bot_username,
            },
        )

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        meta = metadata or {}
        data: dict[str, Any] = {
            "chat_id": recipient_id,
            "text": text,
        }
        if "parse_mode" in meta:
            data["parse_mode"] = meta["parse_mode"]
        if "reply_to_message_id" in meta:
            data["reply_to_message_id"] = meta["reply_to_message_id"]

        try:
            result = await self._api_call("sendMessage", data)
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.SENT,
                message_id=str(result.get("message_id", "")),
                raw=result,
            )
        except Exception as exc:
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.FAILED,
                error=str(exc),
            )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        formatted = self.format_content(content)
        if isinstance(formatted, str):
            return await self.send_message(
                recipient_id, formatted, metadata=metadata
            )
        # dict payload — send as-is with chat_id injected
        formatted["chat_id"] = recipient_id
        try:
            result = await self._api_call("sendMessage", formatted)
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.SENT,
                message_id=str(result.get("message_id", "")),
                raw=result,
            )
        except Exception as exc:
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.FAILED,
                error=str(exc),
            )

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        """Convert RichContent into Telegram HTML text."""
        parts: list[str] = []
        for block in content.blocks:
            if block.type == ContentType.TEXT:
                parts.append(block.data.get("text", ""))
            elif block.type == ContentType.IMAGE:
                url = block.data.get("url", "")
                caption = block.data.get("caption", "")
                parts.append(f'<a href="{url}">{caption or "Image"}</a>')
            elif block.type == ContentType.CODE:
                lang = block.data.get("language", "")
                code = block.data.get("code", "")
                parts.append(f"<pre><code class=\"language-{lang}\">{code}</code></pre>")
            elif block.type == ContentType.BUTTON:
                label = block.data.get("label", "")
                parts.append(f"[{label}]")
            elif block.type == ContentType.LIST:
                items = block.data.get("items", [])
                for item in items:
                    parts.append(f"• {item}")
            else:
                parts.append(str(block.data))

        text = "\n".join(parts)
        # Telegram limit
        if len(text) > 4096:
            text = text[:4093] + "..."
        return {"text": text, "parse_mode": "HTML"}

    # -- MessengerBotChannel methods ----------------------------------------

    async def handle_webhook(
        self,
        payload: dict[str, Any],
    ) -> WebhookPayload:
        """Parse a raw Telegram webhook update into a WebhookPayload."""
        # Telegram sends different top-level keys for different event types
        if "message" in payload:
            msg = payload["message"]
            text = msg.get("text", "")

            # Detect commands (messages starting with /)
            entities = msg.get("entities", [])
            is_command = any(
                e.get("type") == "bot_command" for e in entities
            )

            return WebhookPayload(
                event_type=WebhookEvent.COMMAND if is_command else WebhookEvent.MESSAGE,
                sender_id=str(msg.get("from", {}).get("id", "")),
                chat_id=str(msg.get("chat", {}).get("id", "")),
                text=text,
                message_id=str(msg.get("message_id", "")),
                raw=payload,
            )

        if "callback_query" in payload:
            cb = payload["callback_query"]
            msg = cb.get("message", {})
            return WebhookPayload(
                event_type=WebhookEvent.CALLBACK,
                sender_id=str(cb.get("from", {}).get("id", "")),
                chat_id=str(msg.get("chat", {}).get("id", "")),
                text="",
                callback_data=cb.get("data"),
                message_id=str(msg.get("message_id", "")),
                raw=payload,
            )

        if "my_chat_member" in payload:
            member = payload["my_chat_member"]
            new_status = member.get("new_chat_member", {}).get("status", "")
            if new_status in ("member", "administrator"):
                event_type = WebhookEvent.MEMBER_JOIN
            elif new_status in ("left", "kicked"):
                event_type = WebhookEvent.MEMBER_LEAVE
            else:
                event_type = WebhookEvent.UNKNOWN
            return WebhookPayload(
                event_type=event_type,
                sender_id=str(member.get("from", {}).get("id", "")),
                chat_id=str(member.get("chat", {}).get("id", "")),
                raw=payload,
            )

        # Unknown / unsupported update type
        return WebhookPayload(
            event_type=WebhookEvent.UNKNOWN,
            sender_id="",
            chat_id="",
            raw=payload,
        )

    async def send_quick_replies(
        self,
        recipient_id: str,
        text: str,
        quick_replies: list[QuickReply],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send quick replies as a Telegram ReplyKeyboardMarkup."""
        keyboard = [[{"text": qr.label}] for qr in quick_replies]
        data: dict[str, Any] = {
            "chat_id": recipient_id,
            "text": text,
            "reply_markup": {
                "keyboard": keyboard,
                "one_time_keyboard": True,
                "resize_keyboard": True,
            },
        }
        try:
            result = await self._api_call("sendMessage", data)
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.SENT,
                message_id=str(result.get("message_id", "")),
                raw=result,
            )
        except Exception as exc:
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.FAILED,
                error=str(exc),
            )

    async def send_buttons(
        self,
        recipient_id: str,
        text: str,
        buttons: list[list[Button]],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send inline keyboard buttons via Telegram."""
        inline_keyboard: list[list[dict[str, Any]]] = []
        for row in buttons:
            kb_row: list[dict[str, Any]] = []
            for btn in row:
                kb_btn: dict[str, Any] = {"text": btn.label}
                if btn.url:
                    kb_btn["url"] = btn.url
                elif btn.callback_data:
                    kb_btn["callback_data"] = btn.callback_data
                kb_row.append(kb_btn)
            inline_keyboard.append(kb_row)

        data: dict[str, Any] = {
            "chat_id": recipient_id,
            "text": text,
            "reply_markup": {"inline_keyboard": inline_keyboard},
        }
        try:
            result = await self._api_call("sendMessage", data)
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.SENT,
                message_id=str(result.get("message_id", "")),
                raw=result,
            )
        except Exception as exc:
            return DeliveryResult(
                channel_name="telegram",
                status=DeliveryStatus.FAILED,
                error=str(exc),
            )

    async def get_user_profile(self, user_id: str) -> UserProfile:
        """Retrieve user profile via Telegram's ``getChat`` API."""
        try:
            chat = await self._api_call("getChat", {"chat_id": user_id})
            return UserProfile(
                platform_user_id=str(chat.get("id", user_id)),
                username=chat.get("username"),
                display_name=_build_display_name(chat),
                first_name=chat.get("first_name"),
                last_name=chat.get("last_name"),
                language_code=None,  # getChat doesn't return language
                avatar_url=None,     # would need getFile for the photo
                is_bot=chat.get("type") == "private" and chat.get("is_bot", False),
                raw=chat,
            )
        except Exception as exc:
            raise LookupError(
                f"Could not retrieve Telegram user profile for '{user_id}': {exc}"
            ) from exc


def _build_display_name(chat: dict[str, Any]) -> str | None:
    """Build a display name from Telegram chat data."""
    first = chat.get("first_name", "")
    last = chat.get("last_name", "")
    name = f"{first} {last}".strip()
    return name or chat.get("title") or chat.get("username")
