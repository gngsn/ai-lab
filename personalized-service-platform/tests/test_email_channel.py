"""Tests for the EmailChannel abstract interface and concrete implementation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

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
from app.delivery.email import (
    Attachment,
    EmailChannel,
    EmailHeaders,
    EmailPriority,
)
from app.delivery.router import EmailChannel as ConcreteEmailChannel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sample_rich_content() -> RichContent:
    return RichContent(blocks=[
        ContentBlock(type=ContentType.TEXT, data={"text": "Hello world"}),
        ContentBlock(type=ContentType.IMAGE, data={"url": "https://img.example.com/1.png", "alt": "test"}),
    ])


class IncompleteEmailChannel(EmailChannel):
    """Subclass that does NOT implement any abstract methods — used to verify
    that EmailChannel cannot be instantiated without full implementation."""
    pass


# ---------------------------------------------------------------------------
# Abstract interface contract
# ---------------------------------------------------------------------------

class TestEmailChannelInterface:
    """Verify the EmailChannel abstract class behaviour."""

    def test_cannot_instantiate_abstract(self):
        """EmailChannel itself (and incomplete subclasses) cannot be instantiated."""
        with pytest.raises(TypeError):
            EmailChannel()  # type: ignore[abstract]
        with pytest.raises(TypeError):
            IncompleteEmailChannel()  # type: ignore[abstract]

    def test_is_subclass_of_delivery_channel(self):
        """EmailChannel extends DeliveryChannel."""
        assert issubclass(EmailChannel, DeliveryChannel)

    def test_concrete_email_channel_is_subclass(self):
        """The concrete EmailChannel in router.py extends the abstract EmailChannel."""
        assert issubclass(ConcreteEmailChannel, EmailChannel)
        assert issubclass(ConcreteEmailChannel, DeliveryChannel)

    def test_has_email_specific_methods(self):
        """The abstract interface declares the four email-specific methods."""
        for method_name in ("send_html_email", "send_template", "add_attachments", "set_subject"):
            assert hasattr(EmailChannel, method_name), f"Missing method: {method_name}"


# ---------------------------------------------------------------------------
# Data model tests
# ---------------------------------------------------------------------------

class TestAttachment:
    def test_attachment_with_content(self):
        att = Attachment(filename="doc.pdf", content=b"%PDF-1.4", content_type="application/pdf")
        assert att.filename == "doc.pdf"
        assert att.content == b"%PDF-1.4"
        assert att.filepath is None
        assert att.inline is False

    def test_attachment_with_filepath(self):
        att = Attachment(filename="img.png", filepath=Path("/tmp/img.png"))
        assert att.filepath == Path("/tmp/img.png")
        assert att.content is None

    def test_inline_attachment(self):
        att = Attachment(filename="logo.png", content=b"\x89PNG", inline=True, content_id="logo1")
        assert att.inline is True
        assert att.content_id == "logo1"

    def test_attachment_is_frozen(self):
        att = Attachment(filename="f.txt", content=b"data")
        with pytest.raises(AttributeError):
            att.filename = "other.txt"  # type: ignore[misc]


class TestEmailHeaders:
    def test_defaults(self):
        h = EmailHeaders()
        assert h.subject == ""
        assert h.reply_to is None
        assert h.cc == []
        assert h.bcc == []
        assert h.priority == EmailPriority.NORMAL
        assert h.custom_headers == {}

    def test_custom_values(self):
        h = EmailHeaders(
            subject="Test",
            reply_to="reply@example.com",
            cc=["a@example.com"],
            bcc=["b@example.com"],
            priority=EmailPriority.HIGH,
            custom_headers={"X-Campaign": "abc"},
        )
        assert h.subject == "Test"
        assert h.priority == EmailPriority.HIGH
        assert h.custom_headers["X-Campaign"] == "abc"


class TestEmailPriority:
    def test_enum_values(self):
        assert EmailPriority.LOW == "low"
        assert EmailPriority.NORMAL == "normal"
        assert EmailPriority.HIGH == "high"


# ---------------------------------------------------------------------------
# Concrete EmailChannel — send_html_email
# ---------------------------------------------------------------------------

class TestSendHtmlEmail:
    @pytest.mark.asyncio
    async def test_basic_html_email(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_html_email(
            "user@example.com",
            "Welcome!",
            "<h1>Hello</h1>",
        )
        assert isinstance(result, DeliveryResult)
        assert result.channel_name == "email"
        assert result.status == DeliveryStatus.DELIVERED
        assert result.raw["to"] == "user@example.com"
        assert result.raw["subject"] == "Welcome!"
        assert result.raw["html_body"] == "<h1>Hello</h1>"

    @pytest.mark.asyncio
    async def test_html_email_with_plain_text_fallback(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_html_email(
            "user@example.com",
            "Subject",
            "<p>body</p>",
            plain_text_body="body",
        )
        assert result.raw["plain_text_body"] == "body"

    @pytest.mark.asyncio
    async def test_html_email_with_attachments(self):
        ch = ConcreteEmailChannel()
        attachments = [
            Attachment(filename="file.pdf", content=b"data"),
            Attachment(filename="img.png", content=b"png"),
        ]
        result = await ch.send_html_email(
            "user@example.com",
            "With files",
            "<p>See attached</p>",
            attachments=attachments,
        )
        assert result.raw["attachments_count"] == 2

    @pytest.mark.asyncio
    async def test_html_email_no_attachments(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_html_email(
            "user@example.com", "Subj", "<p>body</p>",
        )
        assert result.raw["attachments_count"] == 0


# ---------------------------------------------------------------------------
# Concrete EmailChannel — send_template
# ---------------------------------------------------------------------------

class TestSendTemplate:
    @pytest.mark.asyncio
    async def test_basic_template(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_template(
            "user@example.com",
            "daily_vocab_digest",
            {"words": ["hello", "world"], "count": 2},
        )
        assert result.status == DeliveryStatus.DELIVERED
        assert result.raw["template"] == "daily_vocab_digest"
        assert result.raw["vars"]["count"] == 2

    @pytest.mark.asyncio
    async def test_template_with_subject_override(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_template(
            "user@example.com",
            "welcome_email",
            {"name": "Alice"},
            subject="Welcome, Alice!",
        )
        assert result.raw["subject"] == "Welcome, Alice!"

    @pytest.mark.asyncio
    async def test_template_without_subject(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_template(
            "user@example.com",
            "welcome_email",
            {"name": "Bob"},
        )
        assert result.raw["subject"] is None


# ---------------------------------------------------------------------------
# Concrete EmailChannel — add_attachments
# ---------------------------------------------------------------------------

class TestAddAttachments:
    @pytest.mark.asyncio
    async def test_add_attachments_to_message(self):
        ch = ConcreteEmailChannel()
        attachments = [Attachment(filename="report.csv", content=b"a,b,c")]
        result = await ch.add_attachments("msg-123", attachments)
        assert result.status == DeliveryStatus.DELIVERED
        assert result.message_id == "msg-123"
        assert result.raw["attachments_added"] == 1

    @pytest.mark.asyncio
    async def test_add_multiple_attachments(self):
        ch = ConcreteEmailChannel()
        attachments = [
            Attachment(filename="a.txt", content=b"aaa"),
            Attachment(filename="b.txt", content=b"bbb"),
            Attachment(filename="c.txt", content=b"ccc"),
        ]
        result = await ch.add_attachments("msg-456", attachments)
        assert result.raw["attachments_added"] == 3


# ---------------------------------------------------------------------------
# Concrete EmailChannel — set_subject
# ---------------------------------------------------------------------------

class TestSetSubject:
    @pytest.mark.asyncio
    async def test_set_subject(self):
        ch = ConcreteEmailChannel()
        result = await ch.set_subject("msg-789", "New Subject Line")
        assert result.status == DeliveryStatus.DELIVERED
        assert result.message_id == "msg-789"
        assert result.raw["subject"] == "New Subject Line"


# ---------------------------------------------------------------------------
# Base DeliveryChannel methods still work on ConcreteEmailChannel
# ---------------------------------------------------------------------------

class TestBaseMethodsStillWork:
    @pytest.mark.asyncio
    async def test_send_message(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_message("user@example.com", "plain text")
        assert result.channel_name == "email"
        assert result.status == DeliveryStatus.DELIVERED

    @pytest.mark.asyncio
    async def test_send_rich_content(self):
        ch = ConcreteEmailChannel()
        result = await ch.send_rich_content("user@example.com", _sample_rich_content())
        assert result.status == DeliveryStatus.DELIVERED

    def test_get_channel_info(self):
        info = ConcreteEmailChannel().get_channel_info()
        assert isinstance(info, ChannelInfo)
        assert info.channel_type == "email"
        assert info.supports_files is True

    def test_format_content_html(self):
        formatted = ConcreteEmailChannel().format_content(_sample_rich_content())
        assert isinstance(formatted, str)
        assert "<p>" in formatted
        assert "<img" in formatted
