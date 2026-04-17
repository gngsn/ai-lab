"""Plugin dispatcher handler — routes inbound messages to service plugins via AI classification.

This handler bridges the messaging pipeline and the plugin system by:

1. Receiving an :class:`InboundMessage` from the pipeline.
2. Using the :class:`ServiceRouter` to classify the message intent and resolve
   the target plugin.
3. Building a :class:`PluginContext` with the user's merged configuration.
4. Dispatching to the plugin's ``execute()`` method.
5. Converting the :class:`PluginResult` into a :class:`MessageResponse`.

Design principles:
- **Channel agnosticism**: The dispatcher works with normalized messages only;
  it has no knowledge of Telegram, Slack, or any other platform.
- **Plugin isolation**: Plugins are accessed only through the registry and
  receive a :class:`PluginContext` — never raw pipeline internals.
- **Routing accuracy**: Confidence thresholds, fallback handling, and
  platform-intent shortcuts ensure correct dispatch.
- **Preference granularity**: User config is merged (defaults + overrides)
  before being passed to the plugin.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from app.messaging.handler import MessageHandler
from app.messaging.models import InboundMessage, MessageResponse, MessageType
from app.routing.router import ServiceRouter
from app.routing.types import RoutingResult, RoutingStatus
from app.services.plugin import PluginContext, PluginResult
from app.services.plugin_registry import PluginRegistry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# User config provider protocol — decouples from concrete DB implementation
# ---------------------------------------------------------------------------


class UserConfigProvider(Protocol):
    """Protocol for retrieving a user's merged plugin configuration.

    Implementations may read from Supabase, SQLAlchemy, an in-memory cache,
    or any other source.  The dispatcher only cares about the result: a flat
    ``dict[str, Any]`` of configuration key/value pairs for a given plugin.
    """

    async def get_user_plugin_config(
        self, user_id: str, plugin_name: str
    ) -> dict[str, Any]:
        """Return the user's config for a specific plugin.

        Returns an empty dict if the user has no overrides, so the plugin
        falls back to its manifest defaults.
        """
        ...


class NullConfigProvider:
    """Default config provider that always returns empty config.

    Used when no persistence backend is configured (e.g. in tests or
    during initial bootstrapping).
    """

    async def get_user_plugin_config(
        self, user_id: str, plugin_name: str
    ) -> dict[str, Any]:
        return {}


# ---------------------------------------------------------------------------
# Platform intent handler protocol
# ---------------------------------------------------------------------------


class PlatformIntentHandler(Protocol):
    """Protocol for handling platform-level intents (help, start, feedback).

    These intents are not routed to plugins but handled by the platform itself.
    """

    async def handle_platform_intent(
        self, intent: str, message: InboundMessage
    ) -> MessageResponse:
        ...


class DefaultPlatformIntentHandler:
    """Simple built-in handler for platform-level intents."""

    async def handle_platform_intent(
        self, intent: str, message: InboundMessage
    ) -> MessageResponse:
        responses = {
            "help": (
                "Here's what I can help you with:\n\n"
                "- Send me a message and I'll route it to the right service\n"
                "- Use /help for available commands\n"
                "- Use /preferences to manage your settings"
            ),
            "start": (
                "Welcome! I'm your personalized service assistant.\n"
                "Send me a message to get started, or type /help for commands."
            ),
            "feedback": (
                "Thank you for your feedback! We'll review it shortly.\n"
                "For urgent issues, please contact support."
            ),
        }
        text = responses.get(intent, f"Platform intent '{intent}' received.")
        return MessageResponse(text=text, handled=True)


# ---------------------------------------------------------------------------
# PluginDispatcherHandler
# ---------------------------------------------------------------------------


class PluginDispatcherHandler(MessageHandler):
    """Message handler that dispatches free-text messages to service plugins.

    Sits in the message pipeline at a medium priority (after command handlers,
    before the echo/fallback handler).  It handles ``TEXT`` messages by:

    1. Classifying the message via the ``ServiceRouter``.
    2. Resolving the target plugin from the ``PluginRegistry``.
    3. Fetching the user's config for that plugin.
    4. Calling ``plugin.execute()`` with a ``PluginContext``.
    5. Converting the ``PluginResult`` to a ``MessageResponse``.

    Parameters
    ----------
    router:
        The service router that classifies messages and resolves plugins.
    registry:
        The plugin registry to look up plugin instances.
    config_provider:
        Provider for per-user plugin configuration. Defaults to
        :class:`NullConfigProvider` (no user overrides).
    platform_intent_handler:
        Handler for platform-level intents (help, start, feedback).
        Defaults to :class:`DefaultPlatformIntentHandler`.
    handler_priority:
        Priority in the handler chain (default 50 — after commands at 10,
        before echo fallback at 999).
    """

    def __init__(
        self,
        router: ServiceRouter,
        registry: PluginRegistry,
        *,
        config_provider: UserConfigProvider | None = None,
        platform_intent_handler: PlatformIntentHandler | None = None,
        handler_priority: int = 50,
    ) -> None:
        self._router = router
        self._registry = registry
        self._config_provider = config_provider or NullConfigProvider()
        self._platform_handler = (
            platform_intent_handler or DefaultPlatformIntentHandler()
        )
        self._handler_priority = handler_priority
        self._dispatch_count: int = 0
        self._error_count: int = 0

    # -- MessageHandler interface -------------------------------------------

    @property
    def name(self) -> str:
        return "plugin_dispatcher"

    @property
    def priority(self) -> int:
        return self._handler_priority

    @property
    def supported_types(self) -> set[MessageType]:
        return {MessageType.TEXT}

    async def can_handle(self, message: InboundMessage) -> bool:
        """Accept any non-empty text message."""
        return message.is_text and bool(message.text.strip())

    async def handle(self, message: InboundMessage) -> MessageResponse:
        """Classify, resolve, and dispatch the message to a plugin.

        Returns a ``MessageResponse`` with the plugin's output, or a
        graceful degradation message if routing/dispatch fails.
        """
        self._dispatch_count += 1

        # Step 1: Route the message (classify + resolve plugin)
        routing_result = await self._route_message(message)

        # Step 2: Handle based on routing status
        return await self._handle_routing_result(routing_result, message)

    # -- Routing ------------------------------------------------------------

    async def _route_message(self, message: InboundMessage) -> RoutingResult:
        """Use the ServiceRouter to classify and resolve the target plugin."""
        return await self._router.route_message(
            message_text=message.text,
            user_id=message.source.sender_id,
            metadata={
                "platform": message.source.platform,
                "chat_id": message.source.chat_id,
                "message_id": message.message_id,
            },
        )

    # -- Dispatch logic based on routing status ----------------------------

    async def _handle_routing_result(
        self,
        result: RoutingResult,
        message: InboundMessage,
    ) -> MessageResponse:
        """Branch on routing status and dispatch accordingly."""

        if result.status == RoutingStatus.ROUTED:
            return await self._dispatch_to_plugin(result, message)

        if result.status == RoutingStatus.FALLBACK:
            return await self._dispatch_to_plugin(result, message)

        if result.status == RoutingStatus.PLATFORM_HANDLED:
            return await self._handle_platform_intent(result, message)

        if result.status == RoutingStatus.LOW_CONFIDENCE:
            return await self._handle_low_confidence(result, message)

        if result.status == RoutingStatus.NO_MATCH:
            return self._handle_no_match(result)

        if result.status == RoutingStatus.ERROR:
            return self._handle_routing_error(result)

        # Unexpected status — should not happen
        logger.warning("Unexpected routing status: %s", result.status)
        return MessageResponse(handled=False)

    # -- Plugin dispatch ----------------------------------------------------

    async def _dispatch_to_plugin(
        self,
        result: RoutingResult,
        message: InboundMessage,
    ) -> MessageResponse:
        """Look up the plugin, build context, call execute(), convert result."""
        plugin_name = result.effective_plugin
        if not plugin_name:
            logger.error("Routing resolved but no plugin name provided")
            self._error_count += 1
            return MessageResponse(
                text="Something went wrong — no service could handle your message.",
                handled=True,
                error="routing_resolved_no_plugin",
            )

        # Look up the plugin instance
        plugin = self._registry.get_active(plugin_name)
        if plugin is None:
            logger.warning(
                "Plugin '%s' resolved by router but not active in registry",
                plugin_name,
            )
            self._error_count += 1
            return MessageResponse(
                text="The requested service is temporarily unavailable. Please try again later.",
                handled=True,
                error=f"plugin_not_active:{plugin_name}",
            )

        # Fetch user config for this plugin
        user_config = await self._config_provider.get_user_plugin_config(
            user_id=message.source.sender_id,
            plugin_name=plugin_name,
        )

        # Merge with plugin defaults
        merged_config = plugin.merge_config(user_config)

        # Build plugin context
        context = PluginContext(
            user_id=message.source.sender_id,
            user_config=merged_config,
            message=message.text,
            metadata={
                "platform": message.source.platform,
                "chat_id": message.source.chat_id,
                "message_id": message.message_id,
                "routing_status": result.status.value,
                "routing_confidence": result.decision.confidence,
                "routing_intent": result.decision.intent.value,
                "routing_sub_intent": result.decision.sub_intent,
                "routing_capability": result.target_capability,
                "extracted_entities": result.decision.extracted_entities,
            },
        )

        # Execute the plugin
        try:
            plugin_result = await plugin.execute(context)
        except Exception as exc:
            logger.exception(
                "Plugin '%s' raised during execute() for user %s",
                plugin_name,
                message.source.sender_id,
            )
            self._error_count += 1
            return MessageResponse(
                text="An error occurred while processing your request. Please try again.",
                handled=True,
                error=f"plugin_execution_error:{plugin_name}:{exc}",
            )

        # Convert PluginResult to MessageResponse
        return self._plugin_result_to_response(plugin_result, result)

    @staticmethod
    def _plugin_result_to_response(
        plugin_result: PluginResult,
        routing_result: RoutingResult,
    ) -> MessageResponse:
        """Convert a PluginResult to a MessageResponse."""
        if plugin_result.is_error:
            return MessageResponse(
                text=plugin_result.error or "An unknown error occurred.",
                handled=True,
                error=plugin_result.error,
            )

        # Build metadata combining plugin and routing info
        metadata: dict[str, Any] = {
            **plugin_result.metadata,
            "routing_status": routing_result.status.value,
            "target_plugin": routing_result.effective_plugin,
            "target_capability": routing_result.target_capability,
        }

        return MessageResponse(
            text=plugin_result.text,
            rich_content=plugin_result.content if plugin_result.content else None,
            metadata=metadata,
            handled=True,
        )

    # -- Platform intent handling -------------------------------------------

    async def _handle_platform_intent(
        self,
        result: RoutingResult,
        message: InboundMessage,
    ) -> MessageResponse:
        """Handle platform-level intents (help, start, feedback)."""
        intent = result.decision.intent.value
        return await self._platform_handler.handle_platform_intent(intent, message)

    # -- Graceful degradation -----------------------------------------------

    async def _handle_low_confidence(
        self,
        result: RoutingResult,
        message: InboundMessage,
    ) -> MessageResponse:
        """Handle low-confidence classifications.

        If a fallback plugin is configured, dispatch to it. Otherwise,
        return a helpful message asking the user to clarify.
        """
        # If a fallback plugin is available, try dispatching to it
        if result.fallback_plugin:
            return await self._dispatch_to_plugin(result, message)

        confidence = result.decision.confidence
        return MessageResponse(
            text=(
                "I'm not quite sure what you're asking for. "
                "Could you rephrase that, or try /help for available commands?"
            ),
            handled=True,
            metadata={
                "routing_status": "low_confidence",
                "confidence": confidence,
            },
        )

    @staticmethod
    def _handle_no_match(result: RoutingResult) -> MessageResponse:
        """Handle when no plugin matches the classified intent."""
        return MessageResponse(
            text=(
                "I understood your request, but I don't have a service "
                "that can handle it right now. Try /help to see what's available."
            ),
            handled=True,
            metadata={
                "routing_status": "no_match",
                "intent": result.decision.intent.value,
                "error": result.error,
            },
        )

    @staticmethod
    def _handle_routing_error(result: RoutingResult) -> MessageResponse:
        """Handle routing errors."""
        return MessageResponse(
            text="I had trouble processing your message. Please try again.",
            handled=True,
            error=result.error,
            metadata={"routing_status": "error"},
        )

    # -- Introspection ------------------------------------------------------

    @property
    def dispatch_count(self) -> int:
        """Total number of messages dispatched."""
        return self._dispatch_count

    @property
    def error_count(self) -> int:
        """Total number of dispatch errors."""
        return self._error_count

    def get_dispatch_info(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of dispatcher state."""
        return {
            "handler_name": self.name,
            "priority": self.priority,
            "dispatch_count": self._dispatch_count,
            "error_count": self._error_count,
            "router_info": self._router.get_routing_info(),
        }
