"""Hybrid message classifier — rule-based fast path with LLM fallback.

Combines :class:`RuleBasedClassifier` and :class:`LLMClassifier` into a
single classifier that:

1. **Tries rules first** — fast, offline, deterministic.
2. **Falls back to the LLM** when rule confidence is below a threshold
   or no rule matches at all.
3. **Degrades gracefully** — if the LLM is unavailable, returns the
   rule-based result (even if low-confidence).

This is the recommended classifier for production deployments: most
high-signal messages (commands, clear intents) are handled by rules
without an LLM round-trip, while ambiguous or novel messages get the
full AI treatment.

Parameters
----------
rule_classifier:
    The rule-based classifier to try first.
llm_classifier:
    The LLM classifier to fall back to.
rule_confidence_threshold:
    Minimum rule-based confidence to accept without LLM fallback.
    Defaults to 0.75.
"""

from __future__ import annotations

import logging

from app.routing.classifier import MessageClassifier
from app.routing.llm_classifier import LLMClassifier
from app.routing.rule_based_classifier import RuleBasedClassifier
from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
)

logger = logging.getLogger(__name__)


class HybridClassifier(MessageClassifier):
    """Hybrid classifier: rule-based fast path + LLM fallback.

    Usage::

        rule_clf = RuleBasedClassifier()
        llm_clf = LLMClassifier(provider)
        classifier = HybridClassifier(rule_clf, llm_clf)

        decision = await classifier.classify(context)
    """

    def __init__(
        self,
        rule_classifier: RuleBasedClassifier,
        llm_classifier: LLMClassifier,
        *,
        rule_confidence_threshold: float = 0.75,
    ) -> None:
        self._rule_classifier = rule_classifier
        self._llm_classifier = llm_classifier
        self._rule_confidence_threshold = rule_confidence_threshold
        # Counters for observability
        self._rule_hits: int = 0
        self._llm_fallbacks: int = 0
        self._llm_failures: int = 0

    @property
    def name(self) -> str:
        return f"hybrid({self._rule_classifier.name}+{self._llm_classifier.name})"

    async def classify(self, context: ClassificationContext) -> RoutingDecision:
        """Classify using rules first, falling back to LLM if needed."""
        # Step 1: Try rule-based classification
        rule_decision = await self._rule_classifier.classify(context)

        # Accept rule result if confidence is high enough and not UNKNOWN
        if (
            rule_decision.intent != MessageIntent.UNKNOWN
            and rule_decision.confidence >= self._rule_confidence_threshold
        ):
            self._rule_hits += 1
            logger.debug(
                "Hybrid: rule-based hit (conf=%.2f, intent=%s) for %r",
                rule_decision.confidence,
                rule_decision.intent.value,
                context.message_text[:60],
            )
            return rule_decision

        # Step 2: Fall back to LLM
        try:
            llm_decision = await self._llm_classifier.classify(context)
            self._llm_fallbacks += 1
            logger.debug(
                "Hybrid: LLM fallback (conf=%.2f, intent=%s) for %r",
                llm_decision.confidence,
                llm_decision.intent.value,
                context.message_text[:60],
            )

            # If LLM also returns UNKNOWN or low confidence, and we had a
            # rule match, prefer the rule result
            if (
                llm_decision.intent == MessageIntent.UNKNOWN
                and rule_decision.intent != MessageIntent.UNKNOWN
            ):
                return rule_decision

            return llm_decision

        except ClassificationError as exc:
            self._llm_failures += 1
            logger.warning(
                "Hybrid: LLM fallback failed (%s), using rule result (conf=%.2f)",
                exc,
                rule_decision.confidence,
            )
            # Degrade gracefully: return rule result even if low confidence
            if rule_decision.intent != MessageIntent.UNKNOWN:
                return rule_decision
            # Both failed — re-raise the LLM error
            raise

    async def health_check(self) -> bool:
        """Check health of both sub-classifiers."""
        rule_ok = await self._rule_classifier.health_check()
        llm_ok = await self._llm_classifier.health_check()
        # Healthy if at least the rule classifier works
        return rule_ok

    def get_stats(self) -> dict[str, int]:
        """Return hit/fallback/failure counters."""
        return {
            "rule_hits": self._rule_hits,
            "llm_fallbacks": self._llm_fallbacks,
            "llm_failures": self._llm_failures,
        }
