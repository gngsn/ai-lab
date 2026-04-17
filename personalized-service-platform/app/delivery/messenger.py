"""MessengerBotChannel — abstract interface for messenger-based delivery channels.

Extends :class:`DeliveryChannel` with methods specific to messenger bot platforms
(Telegram, Slack, Discord, WhatsApp, etc.).  These platforms share common patterns
like webhook handling, quick-reply buttons, interactive button groups, and user
profile retrieval that don't apply to channels like email or push notifications.

Concrete implementations (e.g. ``TelegramBotChannel``) subclass this interface
and map each method to the platform's native API.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.delivery.base import DeliveryChannel, DeliveryResult


# ---------------------------------------------------------------------------
# Data models for messenger interactions
# ---------------------------------------------------------------------------

class ButtonStyle(str, Enum):
    """Visual style hint for interactive buttons."""
    PRIMARY = "primary"
    SECONDARY = "secondary"
    DANGER = "danger"
    LINK = "link"


@dataclass(frozen=True)
class QuickReply:
    """A quick-reply option shown to the user (ephemeral, disappears after tap).

    Attributes
    ----------
    label:
        User-visible button text.
    payload:
        Machine-readable value sent back when the user taps the button.
    image_url:
        Optional icon displayed next to the label (platform-dependent).
    """
    label: str
    payload: str
    image_url: str | None = None


@dataclass(frozen=True)
class Button:
    """A persistent interactive button (inline keyboard row, action block, etc.).

    Attributes
    ----------
    label:
        User-visible text on the button.
    callback_data:
        Payload returned to the bot when the button is pressed.
        Mutually exclusive with *url* — exactly one must be set.
    url:
        If set, the button opens this URL instead of sending a callback.
    style:
        Visual style hint; platforms that don't support styling may ignore it.
    """
    label: str
    callback_data: str | None = None
    url: str | None = None
    style: ButtonStyle = ButtonStyle.PRIMARY


@dataclass(frozen=True)
class UserProfile:
    """Normalized user profile retrieved from a messenger platform.

    Fields that the platform doesn't expose are left as ``None``.
    """
    platform_user_id: str
    username: str | None = None
    display_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    language_code: str | None = None
    avatar_url: str | None = None
    is_bot: bool = False
    raw: dict[str, Any] = field(default_factory=dict)


class WebhookEvent(str, Enum):
    """Categorisation of an incoming webhook payload."""
    MESSAGE = "message"
    CALLBACK = "callback"       # button press / inline interaction
    COMMAND = "command"          # slash-command or bot command
    MEMBER_JOIN = "member_join"
    MEMBER_LEAVE = "member_leave"
    UNKNOWN = "unknown"


@dataclass
class WebhookPayload:
    """Normalised representation of an incoming webhook event.

    Every messenger adapter converts the raw platform payload into this
    structure so downstream routing logic stays platform-agnostic.

    Attributes
    ----------
    event_type:
        High-level classification of the event.
    sender_id:
        Platform-specific identifier of the user who triggered the event.
    chat_id:
        Platform-specific identifier of the chat/conversation.
    text:
        Text content of the message (empty string for non-text events).
    callback_data:
        Payload from an interactive button press, if applicable.
    message_id:
        Platform-specific message identifier, when available.
    raw:
        The original, unmodified payload from the platform.
    """
    event_type: WebhookEvent
    sender_id: str
    chat_id: str
    text: str = ""
    callback_data: str | None = None
    message_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class MessengerBotChannel(DeliveryChannel):
    """Extended delivery channel interface for messenger bot platforms.

    Adds four messenger-specific capabilities on top of the base
    :class:`DeliveryChannel`:

    1. **handle_webhook** — parse an incoming platform webhook into a
       normalised :class:`WebhookPayload`.
    2. **send_quick_replies** — present ephemeral quick-reply options.
    3. **send_buttons** — send a message with persistent interactive buttons.
    4. **get_user_profile** — retrieve the sender's profile from the platform.

    Concrete subclasses (Telegram, Slack, Discord, …) implement these plus
    the base ``send_message``, ``send_rich_content``, ``get_channel_info``,
    and ``format_content`` methods.
    """

    # -- Webhook handling ---------------------------------------------------

    @abstractmethod
    async def handle_webhook(
        self,
        payload: dict[str, Any],
    ) -> WebhookPayload:
        """Parse a raw webhook payload into a normalised :class:`WebhookPayload`.

        Parameters
        ----------
        payload:
            The raw JSON body received from the messenger platform's webhook.

        Returns
        -------
        WebhookPayload
            A platform-agnostic representation of the incoming event.

        Raises
        ------
        ValueError
            If the payload cannot be parsed or is missing required fields.
        """
        ...

    # -- Quick replies ------------------------------------------------------

    @abstractmethod
    async def send_quick_replies(
        self,
        recipient_id: str,
        text: str,
        quick_replies: list[QuickReply],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send a message with ephemeral quick-reply options.

        Quick replies disappear after the user taps one (or sends a new
        message).  They are ideal for short, predefined answer sets.

        Parameters
        ----------
        recipient_id:
            Platform-specific user/chat identifier.
        text:
            Prompt text displayed above the quick-reply options.
        quick_replies:
            Ordered list of :class:`QuickReply` options.
        metadata:
            Optional transport-level overrides.
        """
        ...

    # -- Buttons (persistent inline interactions) ---------------------------

    @abstractmethod
    async def send_buttons(
        self,
        recipient_id: str,
        text: str,
        buttons: list[list[Button]],
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send a message with persistent interactive buttons.

        Unlike quick replies, buttons remain visible after the user interacts
        with them.  They map to inline keyboards (Telegram), action blocks
        (Slack), or similar platform primitives.

        Parameters
        ----------
        recipient_id:
            Platform-specific user/chat identifier.
        text:
            Message body displayed above the button rows.
        buttons:
            A list of rows, where each row is a list of :class:`Button`
            objects.  This 2-D layout maps naturally to Telegram's inline
            keyboard rows and similar constructs on other platforms.
        metadata:
            Optional transport-level overrides.
        """
        ...

    # -- User profile -------------------------------------------------------

    @abstractmethod
    async def get_user_profile(
        self,
        user_id: str,
    ) -> UserProfile:
        """Retrieve the profile of a user from the messenger platform.

        Parameters
        ----------
        user_id:
            Platform-specific user identifier.

        Returns
        -------
        UserProfile
            Normalised user profile data.

        Raises
        ------
        LookupError
            If the user cannot be found on the platform.
        """
        ...
