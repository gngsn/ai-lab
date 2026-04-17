"""Core routing types — MessageIntent, RoutingResult, and supporting models.

These types form the contract between the AI classifier, the service router,
and the plugin registry.  They are fully decoupled from any specific LLM
provider or messenger platform.

Design principles:
- **Channel agnosticism**: Types carry no platform-specific information.
- **Plugin isolation**: Routing types reference plugins by name/capability
  strings, never by direct object reference.
- **Routing accuracy**: Confidence scores and fallback chains allow the
  router to make informed decisions and degrade gracefully.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# MessageIntent — what the user wants to do
# ---------------------------------------------------------------------------


class MessageIntent(Enum):
    """High-level intent categories for inbound user messages.

    The AI classifier maps free-text messages to one of these intents.
    Each intent corresponds to a broad domain of user action; the
    ``sub_intent`` field in :class:`ClassificationContext` carries
    finer-grained detail (e.g. intent=LEARN, sub_intent="quiz").

    The enum is deliberately kept small — it classifies the *domain*,
    not every possible user action.  Plugin-specific sub-intents are
    open-ended strings.
    """

    # Service-domain intents
    LEARN = "learn"              # vocabulary / education content
    CONFIGURE = "configure"      # user wants to change preferences / settings
    QUERY = "query"              # information lookup / search
    CREATE = "create"            # user wants to create something (e.g. a list)
    INTERACT = "interact"        # general conversation with a service

    # Platform-level intents (handled by the platform, not plugins)
    HELP = "help"                # help / usage instructions
    START = "start"              # onboarding / first interaction
    FEEDBACK = "feedback"        # user feedback / bug report

    # Fallback
    UNKNOWN = "unknown"          # classifier could not determine intent


# ---------------------------------------------------------------------------
# ServiceCapability — what a plugin can do (mirrors PluginManifest.capabilities)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ServiceCapability:
    """A capability offered by a registered service plugin.

    This is a lightweight view used by the router — it does *not* carry a
    reference to the plugin instance itself (plugin isolation).

    Attributes
    ----------
    plugin_name:
        The machine-readable name of the plugin (matches ``PluginManifest.name``).
    capability:
        A single capability tag from the plugin's manifest
        (e.g. ``"vocab"``, ``"quiz"``, ``"daily_word"``).
    display_name:
        Human-friendly name of the plugin, for logging / user-facing messages.
    description:
        Short description of what this capability provides.
    """

    plugin_name: str
    capability: str
    display_name: str = ""
    description: str = ""


# ---------------------------------------------------------------------------
# ClassificationContext — input to the classifier
# ---------------------------------------------------------------------------


@dataclass
class ClassificationContext:
    """Context provided to the AI classifier for message classification.

    Contains all information the classifier needs to determine intent and
    extract entities, without leaking platform or channel details.

    Attributes
    ----------
    message_text:
        The raw user message text.
    user_id:
        Opaque user identifier (for per-user classification history, if needed).
    available_capabilities:
        The set of capabilities currently registered in the plugin registry.
        The classifier uses this to constrain its output to valid targets.
    conversation_history:
        Optional recent messages for multi-turn context.
    user_preferences:
        Optional dict of the user's current preference settings,
        to help the classifier disambiguate intent.
    metadata:
        Arbitrary extra context (e.g. locale, time of day).
    """

    message_text: str
    user_id: str = ""
    available_capabilities: list[ServiceCapability] = field(default_factory=list)
    conversation_history: list[dict[str, str]] = field(default_factory=list)
    user_preferences: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# ClassificationError
# ---------------------------------------------------------------------------


class ClassificationError(Exception):
    """Raised when the AI classifier fails to classify a message.

    Attributes
    ----------
    message:
        Human-readable error description.
    original_text:
        The message text that failed classification.
    cause:
        The underlying exception, if any.
    """

    def __init__(
        self,
        message: str,
        *,
        original_text: str = "",
        cause: Exception | None = None,
    ) -> None:
        self.original_text = original_text
        self.cause = cause
        super().__init__(message)


# ---------------------------------------------------------------------------
# RoutingDecision — output of the classifier
# ---------------------------------------------------------------------------


@dataclass
class RoutingDecision:
    """The result of classifying a single message.

    Produced by a :class:`MessageClassifier` and consumed by the
    :class:`ServiceRouter` to resolve target plugins.

    Attributes
    ----------
    intent:
        The classified high-level intent.
    sub_intent:
        Optional finer-grained intent within the domain
        (e.g. ``"quiz"``, ``"daily_word"``, ``"define"``).
    confidence:
        Classifier confidence score in [0.0, 1.0].
    target_capability:
        The most likely capability tag to route to (e.g. ``"vocab"``).
        May be empty if intent is a platform-level action (HELP, START).
    extracted_entities:
        Named entities extracted from the message (e.g. ``{"word": "ephemeral"}``).
    reasoning:
        Optional human-readable explanation of why this classification was chosen.
        Useful for debugging and audit logs.
    alternatives:
        Other plausible classifications, ordered by descending confidence.
        Enables fallback if the primary target plugin is unavailable.
    raw_response:
        The raw LLM response (for debugging / logging). Not used by routing logic.
    """

    intent: MessageIntent
    sub_intent: str = ""
    confidence: float = 1.0
    target_capability: str = ""
    extracted_entities: dict[str, Any] = field(default_factory=dict)
    reasoning: str = ""
    alternatives: list[RoutingDecision] = field(default_factory=list)
    raw_response: dict[str, Any] = field(default_factory=dict)

    @property
    def is_high_confidence(self) -> bool:
        """Whether the confidence is above the typical routing threshold (0.7)."""
        return self.confidence >= 0.7

    @property
    def is_platform_intent(self) -> bool:
        """Whether this is a platform-level intent (not routed to a plugin)."""
        return self.intent in (MessageIntent.HELP, MessageIntent.START, MessageIntent.FEEDBACK)


# ---------------------------------------------------------------------------
# RoutingStatus & RoutingResult — final routing output
# ---------------------------------------------------------------------------


class RoutingStatus(str, Enum):
    """Outcome status of the routing process."""

    ROUTED = "routed"                  # successfully matched to a plugin
    PLATFORM_HANDLED = "platform_handled"  # handled by platform (help, start, etc.)
    FALLBACK = "fallback"              # primary target unavailable; using fallback
    NO_MATCH = "no_match"              # no plugin matched the intent
    ERROR = "error"                    # routing failed due to an error
    LOW_CONFIDENCE = "low_confidence"  # classifier confidence below threshold


@dataclass
class RoutingResult:
    """Final outcome of the message routing process.

    Produced by the :class:`ServiceRouter` after classification + plugin resolution.
    Consumed by the messaging pipeline to dispatch the message to the correct
    plugin's ``execute()`` method.

    Attributes
    ----------
    status:
        Outcome status of the routing.
    decision:
        The classification decision that led to this routing.
    target_plugin:
        Name of the plugin to route to (empty if no match or platform-handled).
    target_capability:
        The matched capability tag on the target plugin.
    all_matching_plugins:
        All plugins that matched the intent (for multi-plugin scenarios).
    fallback_plugin:
        Name of the fallback plugin used, if the primary target was unavailable.
    error:
        Error message, if routing failed.
    metadata:
        Arbitrary extra context for the handler.
    """

    status: RoutingStatus
    decision: RoutingDecision
    target_plugin: str = ""
    target_capability: str = ""
    all_matching_plugins: list[str] = field(default_factory=list)
    fallback_plugin: str = ""
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_routed(self) -> bool:
        """Whether a target plugin was successfully resolved."""
        return self.status in (RoutingStatus.ROUTED, RoutingStatus.FALLBACK)

    @property
    def is_error(self) -> bool:
        """Whether routing encountered an error."""
        return self.status == RoutingStatus.ERROR

    @property
    def effective_plugin(self) -> str:
        """The plugin that will actually handle the message (primary or fallback)."""
        return self.target_plugin or self.fallback_plugin
