"""Concrete delivery channels and routing helper.

Each channel implements the :class:`DeliveryChannel` abstract interface
defined in ``app.delivery.base``.
"""

from __future__ import annotations

from typing import Any

from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    DeliveryChannel,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)
from app.delivery.email import (
    Attachment,
    EmailChannel as EmailChannelBase,
    EmailHeaders,
)


# ---------------------------------------------------------------------------
# Concrete channel implementations
# ---------------------------------------------------------------------------

class ChatChannel(DeliveryChannel):
    """Generic chat channel (placeholder for Telegram / Slack / etc.)."""

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        # TODO: integrate with actual chat service
        return DeliveryResult(
            channel_name="chat",
            status=DeliveryStatus.DELIVERED,
            raw={"user_id": recipient_id, "text": text},
        )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        formatted = self.format_content(content)
        return DeliveryResult(
            channel_name="chat",
            status=DeliveryStatus.DELIVERED,
            raw={"user_id": recipient_id, "content": formatted},
        )

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="chat",
            channel_type="chat",
            supports_rich_content=True,
            supports_buttons=True,
            supports_images=True,
            supports_files=True,
            max_message_length=4096,
        )

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        parts: list[str] = []
        for block in content.blocks:
            if block.type == ContentType.TEXT:
                parts.append(block.data.get("text", ""))
            elif block.type == ContentType.IMAGE:
                parts.append(f"[image: {block.data.get('url', '')}]")
            elif block.type == ContentType.BUTTON:
                parts.append(f"[button: {block.data.get('label', '')}]")
            elif block.type == ContentType.CODE:
                lang = block.data.get("language", "")
                code = block.data.get("code", "")
                parts.append(f"```{lang}\n{code}\n```")
            else:
                parts.append(str(block.data))
        return "\n".join(parts)


class EmailChannel(EmailChannelBase):
    """Concrete email delivery channel (placeholder).

    Extends the abstract :class:`EmailChannelBase` (``app.delivery.email``)
    and provides stub implementations for all email-specific methods.
    """

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            raw={"to": recipient_id, "body": text},
        )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        formatted = self.format_content(content)
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            raw={"to": recipient_id, "body": formatted},
        )

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="email",
            channel_type="email",
            supports_rich_content=True,
            supports_buttons=False,
            supports_images=True,
            supports_files=True,
            max_message_length=None,  # no practical limit
        )

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        html_parts: list[str] = []
        for block in content.blocks:
            if block.type == ContentType.TEXT:
                html_parts.append(f"<p>{block.data.get('text', '')}</p>")
            elif block.type == ContentType.IMAGE:
                url = block.data.get("url", "")
                alt = block.data.get("alt", "")
                html_parts.append(f'<img src="{url}" alt="{alt}" />')
            elif block.type == ContentType.CODE:
                code = block.data.get("code", "")
                html_parts.append(f"<pre><code>{code}</code></pre>")
            else:
                html_parts.append(f"<p>{block.data}</p>")
        return "\n".join(html_parts)

    # -- Email-specific implementations (stubs) ----------------------------

    async def send_html_email(
        self,
        recipient_id: str,
        subject: str,
        html_body: str,
        *,
        plain_text_body: str | None = None,
        headers: EmailHeaders | None = None,
        attachments: list[Attachment] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        # TODO: integrate with actual email provider
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            raw={
                "to": recipient_id,
                "subject": subject,
                "html_body": html_body,
                "plain_text_body": plain_text_body,
                "attachments_count": len(attachments) if attachments else 0,
            },
        )

    async def send_template(
        self,
        recipient_id: str,
        template_name: str,
        template_vars: dict[str, Any],
        *,
        subject: str | None = None,
        headers: EmailHeaders | None = None,
        attachments: list[Attachment] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        # TODO: integrate with template engine
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            raw={
                "to": recipient_id,
                "template": template_name,
                "vars": template_vars,
                "subject": subject,
            },
        )

    async def add_attachments(
        self,
        message_id: str,
        attachments: list[Attachment],
    ) -> DeliveryResult:
        # TODO: integrate with draft/queue system
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            message_id=message_id,
            raw={
                "message_id": message_id,
                "attachments_added": len(attachments),
            },
        )

    async def set_subject(
        self,
        message_id: str,
        subject: str,
    ) -> DeliveryResult:
        # TODO: integrate with draft/queue system
        return DeliveryResult(
            channel_name="email",
            status=DeliveryStatus.DELIVERED,
            message_id=message_id,
            raw={
                "message_id": message_id,
                "subject": subject,
            },
        )


class PushChannel(DeliveryChannel):
    """Push-notification delivery channel (placeholder)."""

    async def send_message(
        self,
        recipient_id: str,
        text: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        return DeliveryResult(
            channel_name="push",
            status=DeliveryStatus.DELIVERED,
            raw={"user_id": recipient_id, "text": text},
        )

    async def send_rich_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        # Push notifications typically only support text
        formatted = self.format_content(content)
        return DeliveryResult(
            channel_name="push",
            status=DeliveryStatus.DELIVERED,
            raw={"user_id": recipient_id, "text": formatted},
        )

    def get_channel_info(self) -> ChannelInfo:
        return ChannelInfo(
            name="push",
            channel_type="push",
            supports_rich_content=False,
            supports_buttons=False,
            supports_images=False,
            supports_files=False,
            max_message_length=256,
        )

    def format_content(self, content: RichContent) -> str | dict[str, Any]:
        # Push notifications: text-only, truncated
        parts: list[str] = []
        for block in content.blocks:
            if block.type == ContentType.TEXT:
                parts.append(block.data.get("text", ""))
        return " ".join(parts)[:256]


# ---------------------------------------------------------------------------
# Channel registry & routing helper
# ---------------------------------------------------------------------------

from app.delivery.channel_registry import DeliveryChannelRegistry  # noqa: E402


def create_default_registry() -> DeliveryChannelRegistry:
    """Create a :class:`DeliveryChannelRegistry` pre-populated with the
    built-in channel implementations (chat, email, push).
    """
    registry = DeliveryChannelRegistry()
    registry.register("chat", ChatChannel())
    registry.register("email", EmailChannel())
    registry.register("push", PushChannel())
    return registry


# Module-level default registry instance — ready to use out of the box.
default_registry = create_default_registry()

# Backward-compatible alias for code that references ``router.CHANNELS``.
CHANNELS: dict[str, DeliveryChannel] = {
    name: default_registry.get(name)
    for name in default_registry.list_names()
}


async def deliver_to_user(
    user_id: str,
    channels: list[str],
    content: Any,
    settings: dict,
) -> list[dict]:
    """Route content to the requested channels for a user.

    This is a backward-compatible helper that delegates to the
    :data:`default_registry`.
    """
    result = await default_registry.send_to_multiple(
        channels, user_id, content, skip_unknown=True,
    )
    # Flatten into the legacy dict format expected by existing callers.
    items: list[dict] = []
    for r in result.results:
        items.append({
            "channel": r.channel_name,
            "status": r.status.value,
            **r.raw,
        })
    for r in result.errors:
        items.append({
            "channel": r.channel_name,
            "status": r.status.value,
            "error": r.error,
        })
    return items
