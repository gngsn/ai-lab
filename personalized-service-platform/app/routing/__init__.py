"""AI-powered message routing — classifies inbound messages and resolves target plugins.

This package defines the core interfaces and types that the AI router uses to:

1. **Classify** inbound messages into structured intents (:class:`MessageIntent`).
2. **Resolve** which service plugin(s) should handle a given intent (:class:`RoutingResult`).
3. **Abstract** the LLM provider so routing logic is provider-agnostic.

Key types:

- :class:`MessageIntent` — structured classification of a user message
  (service domain, action, confidence, extracted entities).
- :class:`RoutingResult` — resolution outcome mapping an intent to one or
  more target plugins, with fallback handling.
- :class:`MessageClassifier` — abstract interface for AI-based message
  classification (LLM-provider-agnostic).
- :class:`ServiceRouter` — orchestrates classification + plugin resolution,
  bridging the messaging pipeline and the plugin registry.

Concrete classifiers:

- :class:`RuleBasedClassifier` — fast, offline, keyword/pattern matching.
- :class:`LLMClassifier` — LLM-provider-agnostic AI classification.
- :class:`HybridClassifier` — rules first, LLM fallback.
"""

from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
    RoutingResult,
    RoutingStatus,
    ServiceCapability,
)
from app.routing.classifier import MessageClassifier
from app.routing.hybrid_classifier import HybridClassifier
from app.routing.llm_classifier import LLMClassifier, LLMProvider
from app.routing.rule_based_classifier import (
    ClassificationRule,
    RuleBasedClassifier,
)
from app.routing.router import ServiceRouter

__all__ = [
    "ClassificationContext",
    "ClassificationError",
    "ClassificationRule",
    "HybridClassifier",
    "LLMClassifier",
    "LLMProvider",
    "MessageClassifier",
    "MessageIntent",
    "RoutingDecision",
    "RoutingResult",
    "RoutingStatus",
    "RuleBasedClassifier",
    "ServiceCapability",
    "ServiceRouter",
]
