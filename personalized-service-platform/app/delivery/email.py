"""EmailChannel — abstract interface for email-based delivery channels.

Extends :class:`DeliveryChannel` with methods specific to email delivery
(HTML emails, templates, attachments, subject lines).  These capabilities
don't apply to messenger bots or push notifications but are essential for
any email transport (SMTP, SendGrid, SES, Mailgun, etc.).

Concrete implementations subclass this interface and map each method to
their chosen email provider's API.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from app.delivery.base import DeliveryChannel, DeliveryResult


# ---------------------------------------------------------------------------
# Data models for email interactions
# ---------------------------------------------------------------------------

class EmailPriority(str, Enum):
    """Email priority/importance level."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


@dataclass(frozen=True)
class Attachment:
    """An email attachment.

    Attachments can be provided either as raw bytes (via *content*) or as a
    file path (via *filepath*).  At least one must be set.

    Attributes
    ----------
    filename:
        The display filename for the attachment (e.g. ``"report.pdf"``).
    content:
        Raw bytes of the attachment.  Mutually exclusive with *filepath*.
    filepath:
        Path to a local file to attach.  Mutually exclusive with *content*.
    content_type:
        MIME type of the attachment (e.g. ``"application/pdf"``).
        If ``None``, the implementation should auto-detect from the filename.
    inline:
        If ``True``, embed the attachment inline (e.g. for images referenced
        in HTML).  The *content_id* is used for ``cid:`` references.
    content_id:
        Content-ID for inline attachments, referenced in HTML via
        ``<img src="cid:{content_id}">``.
    """
    filename: str
    content: bytes | None = None
    filepath: Path | None = None
    content_type: str | None = None
    inline: bool = False
    content_id: str | None = None


@dataclass
class EmailHeaders:
    """Additional email headers and metadata.

    Attributes
    ----------
    subject:
        Email subject line.
    reply_to:
        Reply-To address (if different from sender).
    cc:
        Carbon-copy recipients.
    bcc:
        Blind carbon-copy recipients.
    priority:
        Email priority hint.
    custom_headers:
        Arbitrary extra headers (e.g. ``X-Campaign-Id``).
    """
    subject: str = ""
    reply_to: str | None = None
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)
    priority: EmailPriority = EmailPriority.NORMAL
    custom_headers: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class EmailChannel(DeliveryChannel):
    """Extended delivery channel interface for email-based delivery.

    Adds four email-specific capabilities on top of the base
    :class:`DeliveryChannel`:

    1. **send_html_email** — send a fully formatted HTML email with
       optional plain-text fallback.
    2. **send_template** — render and send a named email template with
       variable substitution.
    3. **add_attachments** — attach files (binary or path-based) to the
       next outgoing email or an existing draft.
    4. **set_subject** — set or override the subject line for the next
       outgoing email.

    Concrete subclasses (SMTP, SendGrid, SES, …) implement these plus
    the base ``send_message``, ``send_rich_content``, ``get_channel_info``,
    and ``format_content`` methods.
    """

    # -- HTML email sending -------------------------------------------------

    @abstractmethod
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
        """Send a fully formatted HTML email.

        Parameters
        ----------
        recipient_id:
            The recipient email address.
        subject:
            Email subject line.
        html_body:
            The HTML content of the email.
        plain_text_body:
            Optional plain-text fallback for email clients that do not
            render HTML.  If ``None``, implementations should generate
            one by stripping HTML tags.
        headers:
            Optional :class:`EmailHeaders` with CC, BCC, reply-to, etc.
        attachments:
            Optional list of :class:`Attachment` objects to include.
        metadata:
            Optional key-value pairs forwarded to the underlying email
            transport (e.g. tracking IDs, campaign tags).
        """
        ...

    # -- Template-based email -----------------------------------------------

    @abstractmethod
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
        """Render and send a named email template.

        Templates allow consistent styling and branding.  The
        implementation resolves the template by name, substitutes the
        provided variables, and sends the resulting email.

        Parameters
        ----------
        recipient_id:
            The recipient email address.
        template_name:
            Identifier for the template to render (e.g.
            ``"welcome_email"``, ``"daily_vocab_digest"``).
        template_vars:
            Dictionary of variables to substitute into the template.
        subject:
            Subject line override.  If ``None``, the template's default
            subject is used.
        headers:
            Optional :class:`EmailHeaders` with CC, BCC, reply-to, etc.
        attachments:
            Optional list of :class:`Attachment` objects to include.
        metadata:
            Optional transport-level overrides.
        """
        ...

    # -- Attachments --------------------------------------------------------

    @abstractmethod
    async def add_attachments(
        self,
        message_id: str,
        attachments: list[Attachment],
    ) -> DeliveryResult:
        """Attach files to an existing email draft or queued message.

        This is used when attachments are gathered incrementally (e.g.
        a service plugin adds files after composing the body).

        Parameters
        ----------
        message_id:
            The identifier of an existing draft or queued email to
            attach files to.
        attachments:
            List of :class:`Attachment` objects to add.

        Returns
        -------
        DeliveryResult
            Result indicating success or failure of the attachment
            operation.

        Raises
        ------
        LookupError
            If the *message_id* does not correspond to an existing
            draft or queued email.
        """
        ...

    # -- Subject management -------------------------------------------------

    @abstractmethod
    async def set_subject(
        self,
        message_id: str,
        subject: str,
    ) -> DeliveryResult:
        """Set or override the subject line for a queued or draft email.

        Parameters
        ----------
        message_id:
            The identifier of an existing draft or queued email.
        subject:
            The new subject line.

        Returns
        -------
        DeliveryResult
            Result indicating success or failure.

        Raises
        ------
        LookupError
            If the *message_id* does not correspond to an existing
            draft or queued email.
        """
        ...
