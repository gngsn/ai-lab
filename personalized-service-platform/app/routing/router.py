"""Service router — bridges message classification and plugin resolution.

The :class:`ServiceRouter` is the orchestrator that:

1. Receives an inbound message (as a :class:`ClassificationContext`).
2. Delegates to a :class:`MessageClassifier` to determine the intent.
3. Resolves the target plugin(s) from the :class:`PluginRegistry`.
4. Returns a :class:`RoutingResult` that the messaging pipeline uses to
   dispatch the message.

Design principles:
- **Plugin isolation**: The router references plugins by name, never by
  direct instance.  Plugin lookup goes through the registry.
- **Channel agnosticism**: The router is unaware of delivery channels.
- **Routing accuracy**: Confidence thresholds and fallback chains ensure
  messages are routed correctly or gracefully degraded.
- **LLM-provider-agnostic**: The classifier is injected, not hardcoded.
"""

from __future__ import annotations

import logging
from typing import Any

from app.routing.classifier import MessageClassifier
from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
    RoutingResult,
    RoutingStatus,
    ServiceCapability,
)
from app.services.plugin_registry import PluginRegistry

logger = logging.getLogger(__name__)

# Default confidence threshold — below this, the router flags LOW_CONFIDENCE
DEFAULT_CONFIDENCE_THRESHOLD = 0.5


class ServiceRouter:
    """Orchestrates AI-based message classification and plugin resolution.

    Usage::

        classifier = MyLLMClassifier(api_key="...")
        registry = PluginRegistry()
        router = ServiceRouter(classifier, registry)

        # Build context and route
        context = router.build_context(
            message_text="quiz me on vocabulary",
            user_id="user_123",
        )
        result = await router.route(context)

        if result.is_routed:
            plugin = registry.get_active(result.effective_plugin)
            response = await plugin.execute(plugin_context)
    """

    def __init__(
        self,
        classifier: MessageClassifier,
        plugin_registry: PluginRegistry,
        *,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
        fallback_plugin: str | None = None,
    ) -> None:
        """
        Parameters
        ----------
        classifier:
            The AI message classifier to use.
        plugin_registry:
            The plugin registry to resolve target plugins from.
        confidence_threshold:
            Minimum confidence score to accept a classification.
            Below this, the routing result is flagged LOW_CONFIDENCE.
        fallback_plugin:
            Optional plugin name to use when no match is found.
        """
        self._classifier = classifier
        self._registry = plugin_registry
        self._confidence_threshold = confidence_threshold
        self._fallback_plugin = fallback_plugin

    # -- Context building ---------------------------------------------------

    def build_context(
        self,
        message_text: str,
        user_id: str = "",
        *,
        conversation_history: list[dict[str, str]] | None = None,
        user_preferences: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ClassificationContext:
        """Build a :class:`ClassificationContext` from message data.

        Automatically populates ``available_capabilities`` from the
        plugin registry.
        """
        capabilities = self._get_available_capabilities()
        return ClassificationContext(
            message_text=message_text,
            user_id=user_id,
            available_capabilities=capabilities,
            conversation_history=conversation_history or [],
            user_preferences=user_preferences or {},
            metadata=metadata or {},
        )

    def _get_available_capabilities(self) -> list[ServiceCapability]:
        """Extract capabilities from all active plugins in the registry."""
        capabilities: list[ServiceCapability] = []
        for plugin in self._registry.list_active():
            manifest = plugin.manifest
            for cap in manifest.capabilities:
                capabilities.append(
                    ServiceCapability(
                        plugin_name=manifest.name,
                        capability=cap,
                        display_name=manifest.display_name,
                        description=manifest.description,
                    )
                )
        return capabilities

    # -- Routing ------------------------------------------------------------

    async def route(self, context: ClassificationContext) -> RoutingResult:
        """Classify a message and resolve the target plugin.

        This is the main entry point. It:
        1. Calls the classifier to get a :class:`RoutingDecision`.
        2. Checks confidence against the threshold.
        3. Resolves the target plugin from the registry.
        4. Falls back if the primary target is unavailable.

        Parameters
        ----------
        context:
            Classification context with message text and available capabilities.

        Returns
        -------
        RoutingResult
            Full routing outcome including status, target plugin, and metadata.
        """
        # Step 1: Classify the message
        try:
            decision = await self._classifier.classify(context)
        except ClassificationError as exc:
            logger.error(
                "Classification failed for user %s: %s",
                context.user_id,
                exc,
            )
            return RoutingResult(
                status=RoutingStatus.ERROR,
                decision=RoutingDecision(intent=MessageIntent.UNKNOWN),
                error=str(exc),
            )
        except Exception as exc:
            logger.exception(
                "Unexpected error during classification for user %s",
                context.user_id,
            )
            return RoutingResult(
                status=RoutingStatus.ERROR,
                decision=RoutingDecision(intent=MessageIntent.UNKNOWN),
                error=f"Unexpected classification error: {exc}",
            )

        # Step 2: Handle platform-level intents
        if decision.is_platform_intent:
            return RoutingResult(
                status=RoutingStatus.PLATFORM_HANDLED,
                decision=decision,
                metadata={"intent": decision.intent.value},
            )

        # Step 3: Check confidence threshold
        if decision.confidence < self._confidence_threshold:
            logger.info(
                "Low confidence (%.2f < %.2f) for message from user %s: %r",
                decision.confidence,
                self._confidence_threshold,
                context.user_id,
                context.message_text[:80],
            )
            # Try fallback if available
            if self._fallback_plugin:
                fallback = self._registry.get_active(self._fallback_plugin)
                if fallback:
                    return RoutingResult(
                        status=RoutingStatus.LOW_CONFIDENCE,
                        decision=decision,
                        fallback_plugin=self._fallback_plugin,
                        metadata={"original_confidence": decision.confidence},
                    )
            return RoutingResult(
                status=RoutingStatus.LOW_CONFIDENCE,
                decision=decision,
            )

        # Step 4: Resolve target plugin(s) by capability
        return self._resolve_plugin(decision)

    def _resolve_plugin(self, decision: RoutingDecision) -> RoutingResult:
        """Map a classification decision to concrete plugin(s)."""
        capability = decision.target_capability

        if not capability:
            # No capability specified — try to infer from intent
            capability = self._intent_to_default_capability(decision.intent)

        # Find plugins that declare this capability
        matching_plugins = self._registry.find_by_capability(capability)
        matching_names = [p.manifest.name for p in matching_plugins]

        if matching_plugins:
            primary = matching_names[0]
            return RoutingResult(
                status=RoutingStatus.ROUTED,
                decision=decision,
                target_plugin=primary,
                target_capability=capability,
                all_matching_plugins=matching_names,
            )

        # Try alternative classifications
        for alt in decision.alternatives:
            if alt.target_capability:
                alt_plugins = self._registry.find_by_capability(alt.target_capability)
                if alt_plugins:
                    primary = alt_plugins[0].manifest.name
                    return RoutingResult(
                        status=RoutingStatus.FALLBACK,
                        decision=decision,
                        target_plugin=primary,
                        target_capability=alt.target_capability,
                        all_matching_plugins=[p.manifest.name for p in alt_plugins],
                        metadata={"fallback_reason": "primary_capability_unavailable"},
                    )

        # Try fallback plugin
        if self._fallback_plugin:
            fallback = self._registry.get_active(self._fallback_plugin)
            if fallback:
                return RoutingResult(
                    status=RoutingStatus.FALLBACK,
                    decision=decision,
                    fallback_plugin=self._fallback_plugin,
                    metadata={"fallback_reason": "no_capability_match"},
                )

        # No match at all
        return RoutingResult(
            status=RoutingStatus.NO_MATCH,
            decision=decision,
            error=f"No active plugin found for capability '{capability}'",
        )

    @staticmethod
    def _intent_to_default_capability(intent: MessageIntent) -> str:
        """Map a high-level intent to a default capability tag.

        This is a best-effort heuristic used when the classifier doesn't
        provide an explicit ``target_capability``.
        """
        mapping: dict[MessageIntent, str] = {
            MessageIntent.LEARN: "vocab",
            MessageIntent.QUERY: "vocab",
            MessageIntent.INTERACT: "vocab",
        }
        return mapping.get(intent, "")

    # -- Convenience --------------------------------------------------------

    async def route_message(
        self,
        message_text: str,
        user_id: str = "",
        *,
        conversation_history: list[dict[str, str]] | None = None,
        user_preferences: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> RoutingResult:
        """Convenience method: build context + route in one call."""
        context = self.build_context(
            message_text=message_text,
            user_id=user_id,
            conversation_history=conversation_history,
            user_preferences=user_preferences,
            metadata=metadata,
        )
        return await self.route(context)

    # -- Introspection ------------------------------------------------------

    @property
    def classifier_name(self) -> str:
        """Name of the current classifier backend."""
        return self._classifier.name

    @property
    def confidence_threshold(self) -> float:
        """Current confidence threshold."""
        return self._confidence_threshold

    @confidence_threshold.setter
    def confidence_threshold(self, value: float) -> None:
        """Update the confidence threshold at runtime."""
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"Threshold must be in [0.0, 1.0], got {value}")
        self._confidence_threshold = value

    def get_routing_info(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of the router configuration."""
        return {
            "classifier": self._classifier.name,
            "confidence_threshold": self._confidence_threshold,
            "fallback_plugin": self._fallback_plugin,
            "available_capabilities": [
                {"plugin": c.plugin_name, "capability": c.capability}
                for c in self._get_available_capabilities()
            ],
            "active_plugins": self._registry.list_names(),
        }
