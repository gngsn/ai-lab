"""LLM-powered message classifier — provider-agnostic AI classification.

A concrete :class:`MessageClassifier` implementation that delegates to an
LLM provider for natural language understanding.  The LLM provider is
abstracted behind the :class:`LLMProvider` protocol, keeping this module
fully decoupled from any specific API (OpenAI, Anthropic, local models, etc.).

Design principles:
- **Provider agnosticism**: LLM calls go through :class:`LLMProvider`, not
  a hardcoded SDK.
- **Structured output**: The prompt instructs the LLM to respond in JSON,
  which is parsed into a :class:`RoutingDecision`.
- **Graceful degradation**: Parse errors and timeouts are caught and
  converted to :class:`ClassificationError`.
- **Prompt engineering**: The system prompt and few-shot examples are
  configurable and include the available capabilities so the LLM only
  routes to valid targets.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol, runtime_checkable

from app.routing.classifier import MessageClassifier
from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLMProvider protocol — the abstraction for any LLM backend
# ---------------------------------------------------------------------------


@runtime_checkable
class LLMProvider(Protocol):
    """Abstract LLM provider interface.

    Implementations wrap a specific LLM API (OpenAI, Anthropic, Ollama,
    etc.) behind this uniform interface so the classifier stays
    provider-agnostic.

    Implementations should raise ``Exception`` on transient errors (the
    classifier will convert them to :class:`ClassificationError`).
    """

    @property
    def provider_name(self) -> str:
        """Human-readable provider name (e.g. ``"openai"``, ``"anthropic"``)."""
        ...

    async def complete(
        self,
        system_prompt: str,
        user_message: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 512,
    ) -> str:
        """Send a prompt to the LLM and return the raw text response.

        Parameters
        ----------
        system_prompt:
            System-level instructions for the LLM.
        user_message:
            The user's message / prompt body.
        temperature:
            Sampling temperature (lower = more deterministic).
        max_tokens:
            Maximum tokens in the response.

        Returns
        -------
        The raw text content of the LLM response.
        """
        ...

    async def health_check(self) -> bool:
        """Return ``True`` if the provider is reachable."""
        ...


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


_SYSTEM_PROMPT_TEMPLATE = """\
You are a message intent classifier for a personalized service platform.
Your job is to analyze the user's message and determine:
1. The high-level intent (one of the allowed intents below)
2. A more specific sub-intent if applicable
3. Your confidence level (0.0 to 1.0)
4. The target capability to route to (from the available capabilities)
5. Any entities extracted from the message

## Allowed Intents
- learn: vocabulary / education content requests
- configure: user wants to change preferences or settings
- query: information lookup or search
- create: user wants to create something (e.g. a list)
- interact: general conversation with a service
- help: help / usage instructions
- start: onboarding / first interaction
- feedback: user feedback / bug report
- unknown: cannot determine intent

## Available Capabilities
{capabilities}

## Response Format
Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "intent": "<intent>",
  "sub_intent": "<sub_intent or empty string>",
  "confidence": <float 0.0-1.0>,
  "target_capability": "<capability tag or empty string>",
  "extracted_entities": {{}},
  "reasoning": "<brief explanation>"
}}

Important rules:
- target_capability MUST be one of the available capabilities listed above, or empty string for platform intents
- confidence should reflect how certain you are about the classification
- Extract relevant entities like word names, settings, etc.
- For greetings like "hi" or "hello", classify as "start"
- For ambiguous messages, use lower confidence
"""


def _build_system_prompt(context: ClassificationContext) -> str:
    """Build the system prompt with available capabilities."""
    if context.available_capabilities:
        cap_lines = "\n".join(
            f"- {c.capability}: {c.description or c.display_name or c.plugin_name}"
            for c in context.available_capabilities
        )
    else:
        cap_lines = "(none registered)"
    return _SYSTEM_PROMPT_TEMPLATE.format(capabilities=cap_lines)


def _build_user_message(context: ClassificationContext) -> str:
    """Build the user message including conversation history."""
    parts: list[str] = []

    if context.conversation_history:
        parts.append("Recent conversation:")
        for msg in context.conversation_history[-5:]:  # Last 5 messages
            role = msg.get("role", "user")
            content = msg.get("content", "")
            parts.append(f"  [{role}]: {content}")
        parts.append("")

    if context.user_preferences:
        parts.append(f"User preferences: {json.dumps(context.user_preferences)}")
        parts.append("")

    parts.append(f"User message: {context.message_text}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


_INTENT_MAP: dict[str, MessageIntent] = {
    intent.value: intent for intent in MessageIntent
}


def _parse_llm_response(raw_response: str) -> RoutingDecision:
    """Parse the LLM's JSON response into a RoutingDecision.

    Raises
    ------
    ClassificationError
        If the response cannot be parsed.
    """
    # Strip markdown code fences if present
    text = raw_response.strip()
    if text.startswith("```"):
        # Remove ```json and trailing ```
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ClassificationError(
            f"Failed to parse LLM response as JSON: {e}",
            original_text=raw_response,
            cause=e,
        )

    # Parse intent
    intent_str = data.get("intent", "unknown")
    intent = _INTENT_MAP.get(intent_str, MessageIntent.UNKNOWN)

    # Parse confidence
    try:
        confidence = float(data.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.5

    return RoutingDecision(
        intent=intent,
        sub_intent=data.get("sub_intent", ""),
        confidence=confidence,
        target_capability=data.get("target_capability", ""),
        extracted_entities=data.get("extracted_entities", {}),
        reasoning=data.get("reasoning", ""),
        raw_response=data,
    )


# ---------------------------------------------------------------------------
# LLMClassifier
# ---------------------------------------------------------------------------


class LLMClassifier(MessageClassifier):
    """LLM-powered message classifier.

    Sends the user's message to an LLM provider with a structured prompt
    and parses the JSON response into a :class:`RoutingDecision`.

    Parameters
    ----------
    provider:
        The LLM provider to use for classification.
    temperature:
        Sampling temperature for the LLM (lower = more deterministic).
    max_tokens:
        Maximum tokens in the LLM response.

    Usage::

        from app.routing.llm_classifier import LLMClassifier

        provider = MyOpenAIProvider(api_key="sk-...")
        classifier = LLMClassifier(provider)

        context = ClassificationContext(message_text="quiz me on vocab")
        decision = await classifier.classify(context)
    """

    def __init__(
        self,
        provider: LLMProvider,
        *,
        temperature: float = 0.1,
        max_tokens: int = 512,
    ) -> None:
        self._provider = provider
        self._temperature = temperature
        self._max_tokens = max_tokens

    @property
    def name(self) -> str:
        return f"llm-{self._provider.provider_name}"

    async def classify(self, context: ClassificationContext) -> RoutingDecision:
        """Classify a message using the LLM provider."""
        system_prompt = _build_system_prompt(context)
        user_message = _build_user_message(context)

        try:
            raw_response = await self._provider.complete(
                system_prompt=system_prompt,
                user_message=user_message,
                temperature=self._temperature,
                max_tokens=self._max_tokens,
            )
        except Exception as exc:
            raise ClassificationError(
                f"LLM provider error: {exc}",
                original_text=context.message_text,
                cause=exc,
            )

        try:
            decision = _parse_llm_response(raw_response)
        except ClassificationError:
            raise
        except Exception as exc:
            raise ClassificationError(
                f"Failed to parse LLM response: {exc}",
                original_text=context.message_text,
                cause=exc,
            )

        # Validate target_capability against available capabilities
        if decision.target_capability and context.available_capabilities:
            valid_caps = {c.capability for c in context.available_capabilities}
            if decision.target_capability not in valid_caps:
                logger.warning(
                    "LLM returned invalid capability '%s', clearing it. Valid: %s",
                    decision.target_capability,
                    valid_caps,
                )
                decision.target_capability = ""

        return decision

    async def health_check(self) -> bool:
        """Check whether the LLM provider is reachable."""
        try:
            return await self._provider.health_check()
        except Exception:
            return False
