"""Abstract message classifier interface — LLM-provider-agnostic.

The :class:`MessageClassifier` defines the contract that any AI-based
message classification backend must implement.  This keeps the routing
layer decoupled from specific LLM providers (OpenAI, Anthropic, local
models, etc.).

Concrete implementations live outside this module and are injected at
startup via dependency injection.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.routing.types import (
    ClassificationContext,
    RoutingDecision,
)


class MessageClassifier(ABC):
    """Abstract interface for AI-powered message classification.

    Implementations translate a user's free-text message into a
    :class:`RoutingDecision` that the :class:`ServiceRouter` uses to
    resolve the target plugin.

    The classifier is deliberately stateless — any conversation history
    or user context is passed in via :class:`ClassificationContext`.

    Implementations must be LLM-provider-agnostic at the interface level;
    provider-specific details (API keys, model names, prompt templates)
    belong in the concrete subclass.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name of this classifier (e.g. ``"openai-gpt4"``)."""
        ...

    @abstractmethod
    async def classify(self, context: ClassificationContext) -> RoutingDecision:
        """Classify a user message and return a routing decision.

        Parameters
        ----------
        context:
            Full classification context including the message text,
            available capabilities, and optional conversation history.

        Returns
        -------
        RoutingDecision
            Structured classification result with intent, confidence,
            target capability, and extracted entities.

        Raises
        ------
        ClassificationError
            If the classification fails (network error, invalid LLM
            response, etc.).  The router will treat this as a fallback.
        """
        ...

    async def classify_batch(
        self, contexts: list[ClassificationContext]
    ) -> list[RoutingDecision]:
        """Classify multiple messages in a batch.

        Default implementation calls :meth:`classify` sequentially.
        Subclasses may override for batch-optimized API calls.

        Parameters
        ----------
        contexts:
            List of classification contexts.

        Returns
        -------
        List of routing decisions, one per input context (same order).
        """
        return [await self.classify(ctx) for ctx in contexts]

    async def health_check(self) -> bool:
        """Check whether the classifier backend is reachable.

        Returns ``True`` if healthy, ``False`` otherwise.
        Default implementation returns ``True``.
        """
        return True
