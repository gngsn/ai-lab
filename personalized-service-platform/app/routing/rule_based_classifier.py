"""Rule-based message classifier — keyword and pattern matching.

A concrete :class:`MessageClassifier` implementation that uses configurable
keyword patterns and regex rules to classify inbound messages.  This
classifier requires no external LLM API and works entirely offline, making
it suitable as:

- A **default classifier** when no LLM provider is configured.
- A **fast pre-filter** in a hybrid setup (high-confidence rule matches
  skip the LLM call entirely).
- A **fallback** when the LLM backend is unavailable.

Design:
- Rules are organized by :class:`MessageIntent` and optional sub-intent.
- Each rule has keywords/patterns and a target capability tag.
- Confidence is computed from match quality (exact keyword > substring).
- Entity extraction uses simple regex patterns.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.routing.classifier import MessageClassifier
from app.routing.types import (
    ClassificationContext,
    MessageIntent,
    RoutingDecision,
    ServiceCapability,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ClassificationRule — a single matching rule
# ---------------------------------------------------------------------------


@dataclass
class ClassificationRule:
    """A single classification rule used by the rule-based classifier.

    Attributes
    ----------
    intent:
        The intent this rule maps to.
    sub_intent:
        Optional sub-intent (e.g. "quiz", "daily_word").
    keywords:
        Exact keywords that trigger this rule (matched case-insensitively).
    patterns:
        Regex patterns that trigger this rule.
    target_capability:
        The capability tag to route to if this rule matches.
    base_confidence:
        The base confidence score for a keyword match (0.0–1.0).
        Pattern matches receive ``base_confidence * 0.9``.
    entity_patterns:
        Named regex patterns to extract entities from the message.
        Keys are entity names, values are regex patterns with one capture group.
    priority:
        Lower number = higher priority. Used to break ties when multiple
        rules match with similar confidence.
    """

    intent: MessageIntent
    sub_intent: str = ""
    keywords: list[str] = field(default_factory=list)
    patterns: list[str] = field(default_factory=list)
    target_capability: str = ""
    base_confidence: float = 0.85
    entity_patterns: dict[str, str] = field(default_factory=dict)
    priority: int = 100

    def __post_init__(self) -> None:
        # Pre-compile regex patterns for performance
        self._compiled_patterns: list[re.Pattern[str]] = [
            re.compile(p, re.IGNORECASE) for p in self.patterns
        ]
        self._compiled_entity_patterns: dict[str, re.Pattern[str]] = {
            name: re.compile(p, re.IGNORECASE)
            for name, p in self.entity_patterns.items()
        }


# ---------------------------------------------------------------------------
# Match result (internal)
# ---------------------------------------------------------------------------


@dataclass
class _RuleMatch:
    """Internal result of matching a message against a rule."""

    rule: ClassificationRule
    confidence: float
    matched_keyword: str = ""
    matched_pattern: str = ""
    extracted_entities: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Default rule set
# ---------------------------------------------------------------------------


def build_default_rules() -> list[ClassificationRule]:
    """Build the default set of classification rules.

    This rule set covers the vocabulary learning domain and platform-level
    intents.  Additional rules can be added at runtime via
    :meth:`RuleBasedClassifier.add_rule`.
    """
    return [
        # -- Platform intents (highest priority) ----------------------------
        ClassificationRule(
            intent=MessageIntent.START,
            keywords=["/start", "start", "get started", "begin", "hello", "hi"],
            patterns=[r"^/start\b"],
            target_capability="",
            base_confidence=0.95,
            priority=10,
        ),
        ClassificationRule(
            intent=MessageIntent.HELP,
            keywords=["/help", "help", "how to", "usage", "commands", "what can you do"],
            patterns=[r"^/help\b", r"\bhelp me\b"],
            target_capability="",
            base_confidence=0.95,
            priority=10,
        ),
        ClassificationRule(
            intent=MessageIntent.FEEDBACK,
            keywords=["feedback", "bug", "report", "suggestion", "issue"],
            patterns=[r"\b(?:report|file)\s+(?:a\s+)?bug\b", r"\bgive\s+feedback\b"],
            target_capability="",
            base_confidence=0.85,
            priority=15,
        ),

        # -- CONFIGURE intent -----------------------------------------------
        ClassificationRule(
            intent=MessageIntent.CONFIGURE,
            sub_intent="settings",
            keywords=["settings", "preferences", "configure", "config", "setup"],
            patterns=[
                r"\b(?:change|set|update)\s+(?:my\s+)?(?:settings|preferences|config)\b",
                r"\bset\s+difficulty\b",
                r"\bchange\s+(?:to|my)\b",
            ],
            target_capability="",
            base_confidence=0.90,
            priority=20,
            entity_patterns={
                "setting_name": r"\bset\s+(\w+)\b",
                "setting_value": r"\bto\s+['\"]?(\w+)['\"]?\b",
            },
        ),

        # -- LEARN / vocab intents (domain-specific) ------------------------
        ClassificationRule(
            intent=MessageIntent.LEARN,
            sub_intent="quiz",
            keywords=["quiz", "test", "test me", "review", "practice", "check my knowledge"],
            patterns=[
                r"\b(?:quiz|test)\s+me\b",
                r"\bvocab(?:ulary)?\s+(?:quiz|test)\b",
                r"\bpractice\s+(?:words|vocab)\b",
            ],
            target_capability="quiz",
            base_confidence=0.90,
            priority=30,
        ),
        ClassificationRule(
            intent=MessageIntent.LEARN,
            sub_intent="flashcard",
            keywords=["flashcard", "flash card", "flip card", "study card"],
            patterns=[r"\bflash\s*cards?\b", r"\bstudy\s+cards?\b"],
            target_capability="flashcard",
            base_confidence=0.90,
            priority=30,
        ),
        ClassificationRule(
            intent=MessageIntent.LEARN,
            sub_intent="daily_word",
            keywords=[
                "daily word", "word of the day", "wotd", "today's word",
                "new word", "give me a word", "teach me",
            ],
            patterns=[
                r"\bdaily\s+word\b",
                r"\bword\s+of\s+the\s+day\b",
                r"\bteach\s+me\s+(?:a\s+)?(?:new\s+)?word\b",
                r"\bgive\s+me\s+(?:a\s+)?(?:new\s+)?word\b",
            ],
            target_capability="daily_word",
            base_confidence=0.90,
            priority=30,
        ),
        ClassificationRule(
            intent=MessageIntent.LEARN,
            sub_intent="define",
            keywords=["define", "definition", "meaning", "what does", "what is"],
            patterns=[
                r"\bdefine\s+(\w+)\b",
                r"\bwhat\s+(?:does|is)\s+['\"]?(\w+)['\"]?\s+mean\b",
                r"\bmeaning\s+of\s+['\"]?(\w+)['\"]?\b",
            ],
            target_capability="vocab",
            base_confidence=0.88,
            priority=35,
            entity_patterns={
                "word": r"\bdefine\s+['\"]?(\w+)['\"]?",
                "word_alt": r"\bwhat\s+(?:does|is)\s+['\"]?(\w+)['\"]?\s+mean\b",
                "word_alt2": r"\bmeaning\s+of\s+['\"]?(\w+)['\"]?",
            },
        ),

        # -- General vocab (catch-all for learning domain) ------------------
        ClassificationRule(
            intent=MessageIntent.LEARN,
            sub_intent="general",
            keywords=[
                "vocab", "vocabulary", "learn", "study", "words",
                "language", "spelling",
            ],
            patterns=[
                r"\blearn\s+(?:new\s+)?(?:words?|vocab)\b",
                r"\bstudy\s+(?:words?|vocab)\b",
                r"\bvocab(?:ulary)?\b",
            ],
            target_capability="vocab",
            base_confidence=0.80,
            priority=50,
        ),

        # -- QUERY intent ---------------------------------------------------
        ClassificationRule(
            intent=MessageIntent.QUERY,
            sub_intent="search",
            keywords=["search", "find", "look up", "lookup"],
            patterns=[
                r"\b(?:search|find|look\s*up)\s+(?:for\s+)?['\"]?(\w+)['\"]?\b",
            ],
            target_capability="vocab",
            base_confidence=0.80,
            priority=40,
            entity_patterns={
                "query": r"\b(?:search|find|look\s*up)\s+(?:for\s+)?['\"]?(\w+)['\"]?",
            },
        ),

        # -- INTERACT (general conversation) --------------------------------
        ClassificationRule(
            intent=MessageIntent.INTERACT,
            sub_intent="chat",
            keywords=["chat", "talk", "tell me", "how are you"],
            patterns=[r"\btell\s+me\s+(?:about|a)\b"],
            target_capability="vocab",
            base_confidence=0.60,
            priority=90,
        ),
    ]


# ---------------------------------------------------------------------------
# RuleBasedClassifier
# ---------------------------------------------------------------------------


class RuleBasedClassifier(MessageClassifier):
    """Keyword and pattern-based message classifier.

    Evaluates the message against a list of :class:`ClassificationRule`
    objects and returns the best match as a :class:`RoutingDecision`.

    The classifier supports:
    - **Exact keyword matching** (case-insensitive, word-boundary aware).
    - **Regex pattern matching** for more flexible detection.
    - **Entity extraction** via named regex groups.
    - **Capability-aware filtering** — rules targeting capabilities not
      in the current context receive a confidence penalty.
    - **Alternative classifications** — the top-N matches are returned
      as ``alternatives`` in the decision.

    Parameters
    ----------
    rules:
        List of classification rules.  Defaults to :func:`build_default_rules`.
    max_alternatives:
        Maximum number of alternative classifications to include.
    unknown_threshold:
        Confidence below this value results in UNKNOWN intent.
    """

    def __init__(
        self,
        rules: list[ClassificationRule] | None = None,
        *,
        max_alternatives: int = 3,
        unknown_threshold: float = 0.3,
    ) -> None:
        self._rules = rules if rules is not None else build_default_rules()
        self._max_alternatives = max_alternatives
        self._unknown_threshold = unknown_threshold

    @property
    def name(self) -> str:
        return "rule-based"

    # -- Public API ---------------------------------------------------------

    def add_rule(self, rule: ClassificationRule) -> None:
        """Add a classification rule at runtime."""
        self._rules.append(rule)

    def remove_rules_for_intent(self, intent: MessageIntent) -> int:
        """Remove all rules for a given intent.  Returns the count removed."""
        before = len(self._rules)
        self._rules = [r for r in self._rules if r.intent != intent]
        return before - len(self._rules)

    # -- Classification -----------------------------------------------------

    async def classify(self, context: ClassificationContext) -> RoutingDecision:
        """Classify a message using keyword/pattern rules."""
        text = context.message_text.strip()
        if not text:
            return RoutingDecision(
                intent=MessageIntent.UNKNOWN,
                confidence=0.0,
                reasoning="Empty message",
            )

        # Collect all matches
        matches = self._evaluate_rules(text, context)

        if not matches:
            return RoutingDecision(
                intent=MessageIntent.UNKNOWN,
                confidence=0.0,
                reasoning="No rule matched",
            )

        # Sort: highest confidence first, then by priority (lower = better)
        matches.sort(key=lambda m: (-m.confidence, m.rule.priority))

        best = matches[0]

        # Build alternatives from remaining matches (deduplicate by intent+sub_intent)
        alternatives: list[RoutingDecision] = []
        seen: set[tuple[MessageIntent, str]] = {(best.rule.intent, best.rule.sub_intent)}
        for m in matches[1:]:
            key = (m.rule.intent, m.rule.sub_intent)
            if key not in seen and len(alternatives) < self._max_alternatives:
                seen.add(key)
                alternatives.append(self._match_to_decision(m))

        decision = self._match_to_decision(best, alternatives=alternatives)

        # If confidence is too low, override to UNKNOWN
        if decision.confidence < self._unknown_threshold:
            decision = RoutingDecision(
                intent=MessageIntent.UNKNOWN,
                confidence=decision.confidence,
                reasoning=f"Best match confidence ({decision.confidence:.2f}) below threshold ({self._unknown_threshold})",
                alternatives=alternatives,
            )

        logger.debug(
            "Rule-based classification: intent=%s sub=%s conf=%.2f cap=%s for %r",
            decision.intent.value,
            decision.sub_intent,
            decision.confidence,
            decision.target_capability,
            text[:60],
        )
        return decision

    # -- Internal matching --------------------------------------------------

    def _evaluate_rules(
        self, text: str, context: ClassificationContext
    ) -> list[_RuleMatch]:
        """Evaluate all rules against the message text."""
        text_lower = text.lower()
        available_caps = {c.capability for c in context.available_capabilities}
        matches: list[_RuleMatch] = []

        for rule in self._rules:
            match = self._try_match_rule(rule, text, text_lower, available_caps)
            if match is not None:
                matches.append(match)

        return matches

    def _try_match_rule(
        self,
        rule: ClassificationRule,
        text: str,
        text_lower: str,
        available_caps: set[str],
    ) -> _RuleMatch | None:
        """Try to match a single rule against the message.  Returns None if no match."""
        best_confidence = 0.0
        matched_keyword = ""
        matched_pattern = ""

        # 1. Check keyword matches
        for kw in rule.keywords:
            kw_lower = kw.lower()
            if kw_lower == text_lower:
                # Exact full match — highest confidence
                confidence = rule.base_confidence
                if confidence > best_confidence:
                    best_confidence = confidence
                    matched_keyword = kw
            elif kw_lower in text_lower:
                # Substring match — slightly lower confidence
                # Boost if the keyword is at a word boundary
                word_boundary = re.search(
                    r'\b' + re.escape(kw_lower) + r'\b', text_lower
                )
                if word_boundary:
                    confidence = rule.base_confidence * 0.95
                else:
                    confidence = rule.base_confidence * 0.80
                if confidence > best_confidence:
                    best_confidence = confidence
                    matched_keyword = kw

        # 2. Check regex pattern matches
        for i, compiled in enumerate(rule._compiled_patterns):
            if compiled.search(text):
                confidence = rule.base_confidence * 0.90
                if confidence > best_confidence:
                    best_confidence = confidence
                    matched_pattern = rule.patterns[i]

        if best_confidence == 0.0:
            return None

        # 3. Capability availability penalty
        if rule.target_capability and available_caps and rule.target_capability not in available_caps:
            best_confidence *= 0.7

        # 4. Extract entities
        entities = self._extract_entities(rule, text)

        return _RuleMatch(
            rule=rule,
            confidence=min(best_confidence, 1.0),
            matched_keyword=matched_keyword,
            matched_pattern=matched_pattern,
            extracted_entities=entities,
        )

    def _extract_entities(
        self, rule: ClassificationRule, text: str
    ) -> dict[str, Any]:
        """Extract entities from the message using the rule's entity patterns."""
        entities: dict[str, Any] = {}
        for entity_name, compiled in rule._compiled_entity_patterns.items():
            match = compiled.search(text)
            if match and match.groups():
                # Use the first non-None capture group
                value = next((g for g in match.groups() if g is not None), None)
                if value:
                    # Normalize entity name: strip _alt, _alt2 suffixes
                    clean_name = re.sub(r"_alt\d*$", "", entity_name)
                    entities[clean_name] = value
        return entities

    def _match_to_decision(
        self,
        match: _RuleMatch,
        *,
        alternatives: list[RoutingDecision] | None = None,
    ) -> RoutingDecision:
        """Convert an internal match to a RoutingDecision."""
        reasoning_parts: list[str] = []
        if match.matched_keyword:
            reasoning_parts.append(f"keyword '{match.matched_keyword}'")
        if match.matched_pattern:
            reasoning_parts.append(f"pattern '{match.matched_pattern}'")
        reasoning = f"Matched by {', '.join(reasoning_parts)}" if reasoning_parts else "Rule match"

        return RoutingDecision(
            intent=match.rule.intent,
            sub_intent=match.rule.sub_intent,
            confidence=match.confidence,
            target_capability=match.rule.target_capability,
            extracted_entities=match.extracted_entities,
            reasoning=reasoning,
            alternatives=alternatives or [],
        )
