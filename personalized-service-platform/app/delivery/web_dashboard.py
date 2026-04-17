"""WebDashboardChannel — abstract interface for web dashboard delivery channels.

Extends :class:`DeliveryChannel` with methods specific to web-based dashboard
delivery (push notifications, widget rendering, dashboard section updates, and
content streaming).  These capabilities are tailored for browser-based clients
that maintain persistent or semi-persistent connections and render rich,
interactive UI components.

Concrete implementations subclass this interface and map each method to
their chosen transport (WebSocket, SSE, HTTP long-polling, etc.).
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator

from app.delivery.base import DeliveryChannel, DeliveryResult, RichContent


# ---------------------------------------------------------------------------
# Data models for web dashboard interactions
# ---------------------------------------------------------------------------

class NotificationPriority(str, Enum):
    """Priority level for push notifications."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class NotificationAction(str, Enum):
    """Predefined actions a user can take on a notification."""
    DISMISS = "dismiss"
    NAVIGATE = "navigate"
    OPEN_MODAL = "open_modal"
    CUSTOM = "custom"


@dataclass(frozen=True)
class PushNotification:
    """A push notification to be delivered to the user's browser.

    Attributes
    ----------
    title:
        Short headline displayed in the notification.
    body:
        Descriptive text shown below the title.
    icon_url:
        Optional URL to an icon displayed alongside the notification.
    action_url:
        Optional URL to navigate to when the user clicks the notification.
    action:
        The action type triggered when the notification is interacted with.
    priority:
        Delivery priority hint; the transport may use this to decide whether
        to wake the device or batch the notification.
    ttl_seconds:
        Time-to-live in seconds.  If the notification cannot be delivered
        within this window it should be discarded.  ``None`` means no expiry.
    tags:
        Optional tags for grouping/filtering notifications on the client.
    data:
        Arbitrary key-value payload forwarded to the client for custom
        handling (e.g. deep-link parameters, badge counts).
    """
    title: str
    body: str
    icon_url: str | None = None
    action_url: str | None = None
    action: NotificationAction = NotificationAction.NAVIGATE
    priority: NotificationPriority = NotificationPriority.NORMAL
    ttl_seconds: int | None = None
    tags: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)


class WidgetType(str, Enum):
    """Supported widget types for dashboard rendering."""
    CARD = "card"
    TABLE = "table"
    CHART = "chart"
    LIST = "list"
    PROGRESS = "progress"
    STAT = "stat"
    FORM = "form"
    CUSTOM = "custom"


@dataclass(frozen=True)
class WidgetConfig:
    """Configuration for a renderable dashboard widget.

    Attributes
    ----------
    widget_id:
        Unique identifier for the widget instance.
    widget_type:
        The kind of widget to render.
    title:
        Human-readable title displayed at the top of the widget.
    data:
        Payload used by the client to populate the widget.  The schema
        depends on *widget_type* (e.g. chart data, table rows, stat value).
    style:
        Optional CSS-like style hints (e.g. ``{"width": "50%"}``).
    actions:
        Optional list of action descriptors (buttons, links) attached to
        the widget.
    metadata:
        Arbitrary extra information forwarded to the client renderer.
    """
    widget_id: str
    widget_type: WidgetType
    title: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    style: dict[str, Any] = field(default_factory=dict)
    actions: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DashboardSection:
    """Describes a section of the dashboard to update.

    Attributes
    ----------
    section_id:
        Unique identifier for the dashboard section.
    title:
        Human-readable section title.
    widgets:
        Ordered list of :class:`WidgetConfig` objects to render in this
        section.
    visible:
        Whether the section is visible.  Setting to ``False`` hides it
        without removing it from the layout.
    order:
        Sort order hint; lower values appear first.
    metadata:
        Arbitrary extra information for the client layout engine.
    """
    section_id: str
    title: str = ""
    widgets: list[WidgetConfig] = field(default_factory=list)
    visible: bool = True
    order: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class StreamContentType(str, Enum):
    """Types of content that can be streamed to the client."""
    TEXT = "text"
    MARKDOWN = "markdown"
    HTML = "html"
    JSON = "json"
    BINARY = "binary"


@dataclass(frozen=True)
class StreamChunk:
    """A single chunk in a streamed content delivery.

    Attributes
    ----------
    content:
        The chunk payload (text fragment, JSON object, etc.).
    content_type:
        The format of *content*.
    sequence:
        Monotonically increasing sequence number for ordering and
        gap detection on the client side.
    is_final:
        ``True`` if this is the last chunk in the stream.
    metadata:
        Arbitrary extra data accompanying this chunk.
    """
    content: str | dict[str, Any]
    content_type: StreamContentType = StreamContentType.TEXT
    sequence: int = 0
    is_final: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class WebDashboardChannel(DeliveryChannel):
    """Extended delivery channel interface for web dashboard delivery.

    Adds four web-specific capabilities on top of the base
    :class:`DeliveryChannel`:

    1. **push_notification** — send a browser/in-app push notification.
    2. **render_widget** — deliver a self-contained widget for the client
       to render in the dashboard.
    3. **update_dashboard_section** — replace or update an entire dashboard
       section (a group of widgets).
    4. **stream_content** — deliver content incrementally via an async
       iterator of :class:`StreamChunk` objects (suitable for SSE /
       WebSocket streaming).

    Concrete subclasses implement these plus the base ``send_message``,
    ``send_rich_content``, ``get_channel_info``, and ``format_content``
    methods.
    """

    # -- Push notifications -------------------------------------------------

    @abstractmethod
    async def push_notification(
        self,
        recipient_id: str,
        notification: PushNotification,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send a push notification to the user's browser or in-app inbox.

        Parameters
        ----------
        recipient_id:
            Platform-specific user identifier (e.g. session ID, user UUID).
        notification:
            A :class:`PushNotification` describing the notification content,
            priority, and associated action.
        metadata:
            Optional transport-level overrides (e.g. WebSocket channel ID,
            service-worker registration token).

        Returns
        -------
        DeliveryResult
            Outcome of the notification delivery attempt.
        """
        ...

    # -- Widget rendering ---------------------------------------------------

    @abstractmethod
    async def render_widget(
        self,
        recipient_id: str,
        widget: WidgetConfig,
        *,
        replace_existing: bool = True,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Deliver a widget for the client to render in the dashboard.

        The widget configuration describes *what* to render; the client
        is responsible for mapping the :class:`WidgetConfig` to actual
        HTML/JS components.

        Parameters
        ----------
        recipient_id:
            Platform-specific user identifier.
        widget:
            A :class:`WidgetConfig` describing the widget to render.
        replace_existing:
            If ``True`` and a widget with the same *widget_id* already
            exists on the client, replace it.  If ``False``, the delivery
            is treated as a no-op when a duplicate is found.
        metadata:
            Optional transport-level overrides.

        Returns
        -------
        DeliveryResult
            Outcome of the widget delivery attempt.
        """
        ...

    # -- Dashboard section updates ------------------------------------------

    @abstractmethod
    async def update_dashboard_section(
        self,
        recipient_id: str,
        section: DashboardSection,
        *,
        merge: bool = False,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Replace or update an entire section of the user's dashboard.

        A section is a logical grouping of widgets (e.g. "Vocabulary
        Progress", "Daily Review", "Achievements").

        Parameters
        ----------
        recipient_id:
            Platform-specific user identifier.
        section:
            A :class:`DashboardSection` containing the section layout and
            its child widgets.
        merge:
            If ``True``, merge the provided widgets into the existing
            section (add new widgets, update changed ones, keep the rest).
            If ``False`` (default), replace the section entirely.
        metadata:
            Optional transport-level overrides.

        Returns
        -------
        DeliveryResult
            Outcome of the section update delivery.
        """
        ...

    # -- Content streaming --------------------------------------------------

    @abstractmethod
    async def stream_content(
        self,
        recipient_id: str,
        content: RichContent,
        *,
        chunk_size: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Stream content to the client incrementally.

        This is ideal for delivering long-form or AI-generated content
        where the user benefits from seeing partial results as they become
        available (e.g. vocabulary explanations, quiz feedback).

        Implementations should yield :class:`StreamChunk` objects over an
        async iterator.  The transport may use Server-Sent Events (SSE),
        WebSocket frames, or chunked HTTP responses under the hood.

        Parameters
        ----------
        recipient_id:
            Platform-specific user identifier.
        content:
            The :class:`RichContent` to stream.  Implementations split
            this into sequential chunks.
        chunk_size:
            Optional hint for the maximum size of each chunk (in
            characters or bytes, depending on the content type).
            If ``None``, the implementation chooses a sensible default.
        metadata:
            Optional transport-level overrides (e.g. stream ID, timeout).

        Yields
        ------
        StreamChunk
            Sequential chunks of the content, with the final chunk
            having ``is_final=True``.
        """
        ...  # type: ignore[return]
