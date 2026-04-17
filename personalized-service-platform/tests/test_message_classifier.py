"""Tests for the concrete message classifier implementations.

Covers:
- RuleBasedClassifier — keyword matching, pattern matching, entity extraction,
  confidence scoring, capability-aware filtering, alternatives.
- LLMClassifier — prompt construction, response parsing, error handling,
  capability validation.
- HybridClassifier — rule fast-path, LLM fallback, graceful degradation.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
    ServiceCapability,
)
from app.routing.rule_based_classifier import (
    ClassificationRule,
    RuleBasedClassifier,
    build_default_rules,
)
from app.routing.llm_classifier import (
    LLMClassifier,
    LLMProvider,
    _parse_llm_response,
)
from app.routing.hybrid_classifier import HybridClassifier


# ---------------------------------------------------------------------------
# Fixtures — capabilities and contexts
# ---------------------------------------------------------------------------


VOCAB_CAPABILITIES = [
    ServiceCapability(
        plugin_name="vocab_learning",
        capability="vocab",
        display_name="Vocabulary Learning",
        description="General vocabulary lookups",
    ),
    ServiceCapability(
        plugin_name="vocab_learning",
        capability="quiz",
        display_name="Vocabulary Quiz",
        description="Quiz and practice",
    ),
    ServiceCapability(
        plugin_name="vocab_learning",
        capability="daily_word",
        display_name="Daily Word",
        description="Word of the day",
    ),
    ServiceCapability(
        plugin_name="vocab_learning",
        capability="flashcard",
        display_name="Flashcard",
        description="Flashcard review",
    ),
]


def _ctx(text: str, **kwargs: Any) -> ClassificationContext:
    """Shortcut for building a classification context."""
    return ClassificationContext(
        message_text=text,
        user_id=kwargs.pop("user_id", "test_user"),
        available_capabilities=kwargs.pop("capabilities", VOCAB_CAPABILITIES),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Stub LLM Provider
# ---------------------------------------------------------------------------


class StubLLMProvider:
    """In-memory LLM provider for testing."""

    def __init__(
        self,
        response: str | None = None,
        *,
        error: Exception | None = None,
        healthy: bool = True,
    ) -> None:
        self._response = response or json.dumps({
            "intent": "learn",
            "sub_intent": "daily_word",
            "confidence": 0.92,
            "target_capability": "vocab",
            "extracted_entities": {},
            "reasoning": "User wants vocabulary content",
        })
        self._error = error
        self._healthy = healthy
        self.call_count = 0
        self.last_system_prompt: str = ""
        self.last_user_message: str = ""

    @property
    def provider_name(self) -> str:
        return "stub"

    async def complete(
        self,
        system_prompt: str,
        user_message: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 512,
    ) -> str:
        self.call_count += 1
        self.last_system_prompt = system_prompt
        self.last_user_message = user_message
        if self._error:
            raise self._error
        return self._response

    async def health_check(self) -> bool:
        return self._healthy


# ===========================================================================
# RuleBasedClassifier Tests
# ===========================================================================


class TestRuleBasedClassifier:
    """Tests for the rule-based classifier."""

    @pytest.fixture
    def classifier(self) -> RuleBasedClassifier:
        return RuleBasedClassifier()

    # -- Basic intent classification ----------------------------------------

    @pytest.mark.asyncio
    async def test_classify_quiz_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("quiz me on vocabulary"))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "quiz"
        assert decision.target_capability == "quiz"
        assert decision.confidence > 0.7

    @pytest.mark.asyncio
    async def test_classify_daily_word_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("give me the daily word"))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "daily_word"
        assert decision.target_capability == "daily_word"

    @pytest.mark.asyncio
    async def test_classify_flashcard_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("show me a flashcard"))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "flashcard"
        assert decision.target_capability == "flashcard"

    @pytest.mark.asyncio
    async def test_classify_define_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("define ephemeral"))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "define"
        assert "word" in decision.extracted_entities
        assert decision.extracted_entities["word"] == "ephemeral"

    @pytest.mark.asyncio
    async def test_classify_help_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("/help"))
        assert decision.intent == MessageIntent.HELP
        assert decision.is_platform_intent

    @pytest.mark.asyncio
    async def test_classify_start_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("/start"))
        assert decision.intent == MessageIntent.START
        assert decision.is_platform_intent

    @pytest.mark.asyncio
    async def test_classify_feedback_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("I want to report a bug"))
        assert decision.intent == MessageIntent.FEEDBACK

    @pytest.mark.asyncio
    async def test_classify_configure_intent(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("change my settings"))
        assert decision.intent == MessageIntent.CONFIGURE

    @pytest.mark.asyncio
    async def test_classify_general_vocab(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("I want to learn new words"))
        assert decision.intent == MessageIntent.LEARN

    # -- Edge cases ---------------------------------------------------------

    @pytest.mark.asyncio
    async def test_empty_message(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx(""))
        assert decision.intent == MessageIntent.UNKNOWN
        assert decision.confidence == 0.0

    @pytest.mark.asyncio
    async def test_whitespace_only(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("   "))
        assert decision.intent == MessageIntent.UNKNOWN

    @pytest.mark.asyncio
    async def test_gibberish_message(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("xyzzy foobar baz"))
        assert decision.intent == MessageIntent.UNKNOWN

    # -- Confidence scoring -------------------------------------------------

    @pytest.mark.asyncio
    async def test_exact_keyword_higher_confidence(self, classifier: RuleBasedClassifier):
        # Exact match should have higher confidence than substring
        exact = await classifier.classify(_ctx("quiz"))
        substring = await classifier.classify(_ctx("I think I might want a quiz later"))
        assert exact.confidence >= substring.confidence

    @pytest.mark.asyncio
    async def test_confidence_in_valid_range(self, classifier: RuleBasedClassifier):
        for text in ["quiz me", "daily word", "help", "define cat", "hello", "settings"]:
            decision = await classifier.classify(_ctx(text))
            assert 0.0 <= decision.confidence <= 1.0

    # -- Alternatives -------------------------------------------------------

    @pytest.mark.asyncio
    async def test_alternatives_included(self, classifier: RuleBasedClassifier):
        """A message matching multiple rules should include alternatives."""
        # "test me" matches quiz, and potentially others
        decision = await classifier.classify(_ctx("test me on vocabulary words"))
        # Should have main decision + possibly alternatives
        assert isinstance(decision.alternatives, list)

    @pytest.mark.asyncio
    async def test_alternatives_have_different_intents(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("help me learn vocabulary"))
        if decision.alternatives:
            main_key = (decision.intent, decision.sub_intent)
            for alt in decision.alternatives:
                assert (alt.intent, alt.sub_intent) != main_key

    # -- Entity extraction --------------------------------------------------

    @pytest.mark.asyncio
    async def test_entity_extraction_define(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("define serendipity"))
        assert decision.extracted_entities.get("word") == "serendipity"

    @pytest.mark.asyncio
    async def test_entity_extraction_what_does_mean(self, classifier: RuleBasedClassifier):
        decision = await classifier.classify(_ctx("what does ephemeral mean"))
        assert "word" in decision.extracted_entities

    # -- Capability-aware filtering -----------------------------------------

    @pytest.mark.asyncio
    async def test_capability_penalty_when_unavailable(self):
        """Rules targeting unavailable capabilities get a confidence penalty."""
        classifier = RuleBasedClassifier()
        # With capabilities that include quiz
        with_caps = await classifier.classify(_ctx("quiz me", capabilities=VOCAB_CAPABILITIES))
        # Without any capabilities
        without_caps = await classifier.classify(
            _ctx("quiz me", capabilities=[
                ServiceCapability(plugin_name="other", capability="other_cap")
            ])
        )
        assert with_caps.confidence > without_caps.confidence

    # -- Custom rules -------------------------------------------------------

    @pytest.mark.asyncio
    async def test_add_custom_rule(self):
        classifier = RuleBasedClassifier(rules=[])
        classifier.add_rule(ClassificationRule(
            intent=MessageIntent.CREATE,
            sub_intent="list",
            keywords=["create list", "new list", "make a list"],
            target_capability="list_manager",
            base_confidence=0.90,
        ))
        decision = await classifier.classify(_ctx("create list of words"))
        assert decision.intent == MessageIntent.CREATE
        assert decision.sub_intent == "list"

    @pytest.mark.asyncio
    async def test_remove_rules(self):
        classifier = RuleBasedClassifier()
        removed = classifier.remove_rules_for_intent(MessageIntent.HELP)
        assert removed > 0
        # Help should no longer match
        decision = await classifier.classify(_ctx("/help"))
        assert decision.intent != MessageIntent.HELP

    # -- Classifier name ----------------------------------------------------

    def test_classifier_name(self, classifier: RuleBasedClassifier):
        assert classifier.name == "rule-based"

    # -- Health check -------------------------------------------------------

    @pytest.mark.asyncio
    async def test_health_check(self, classifier: RuleBasedClassifier):
        assert await classifier.health_check() is True

    # -- Default rules sanity -----------------------------------------------

    def test_default_rules_not_empty(self):
        rules = build_default_rules()
        assert len(rules) > 0

    def test_default_rules_cover_all_platform_intents(self):
        rules = build_default_rules()
        intents = {r.intent for r in rules}
        assert MessageIntent.HELP in intents
        assert MessageIntent.START in intents
        assert MessageIntent.FEEDBACK in intents

    def test_default_rules_cover_learn_sub_intents(self):
        rules = build_default_rules()
        learn_subs = {r.sub_intent for r in rules if r.intent == MessageIntent.LEARN}
        assert "quiz" in learn_subs
        assert "daily_word" in learn_subs
        assert "flashcard" in learn_subs
        assert "define" in learn_subs


# ===========================================================================
# LLM Response Parsing Tests
# ===========================================================================


class TestLLMResponseParsing:
    """Tests for parsing LLM JSON responses."""

    def test_parse_valid_json(self):
        response = json.dumps({
            "intent": "learn",
            "sub_intent": "quiz",
            "confidence": 0.95,
            "target_capability": "quiz",
            "extracted_entities": {"word": "cat"},
            "reasoning": "User wants a quiz",
        })
        decision = _parse_llm_response(response)
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "quiz"
        assert decision.confidence == 0.95
        assert decision.target_capability == "quiz"
        assert decision.extracted_entities == {"word": "cat"}

    def test_parse_json_with_code_fence(self):
        response = '```json\n{"intent": "help", "confidence": 0.9}\n```'
        decision = _parse_llm_response(response)
        assert decision.intent == MessageIntent.HELP

    def test_parse_unknown_intent(self):
        response = json.dumps({"intent": "nonexistent", "confidence": 0.5})
        decision = _parse_llm_response(response)
        assert decision.intent == MessageIntent.UNKNOWN

    def test_parse_missing_fields_uses_defaults(self):
        response = json.dumps({"intent": "learn"})
        decision = _parse_llm_response(response)
        assert decision.sub_intent == ""
        assert decision.target_capability == ""
        assert decision.extracted_entities == {}

    def test_parse_invalid_confidence_clamps(self):
        response = json.dumps({"intent": "learn", "confidence": 1.5})
        decision = _parse_llm_response(response)
        assert decision.confidence == 1.0

        response2 = json.dumps({"intent": "learn", "confidence": -0.5})
        decision2 = _parse_llm_response(response2)
        assert decision2.confidence == 0.0

    def test_parse_invalid_json_raises(self):
        with pytest.raises(ClassificationError, match="Failed to parse"):
            _parse_llm_response("not json at all")

    def test_parse_non_numeric_confidence(self):
        response = json.dumps({"intent": "learn", "confidence": "high"})
        decision = _parse_llm_response(response)
        assert decision.confidence == 0.5  # fallback

    def test_raw_response_preserved(self):
        data = {"intent": "learn", "confidence": 0.8, "extra_field": "test"}
        decision = _parse_llm_response(json.dumps(data))
        assert decision.raw_response == data


# ===========================================================================
# LLMClassifier Tests
# ===========================================================================


class TestLLMClassifier:
    """Tests for the LLM-powered classifier."""

    @pytest.mark.asyncio
    async def test_basic_classification(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        decision = await classifier.classify(_ctx("quiz me"))

        assert decision.intent == MessageIntent.LEARN
        assert decision.confidence > 0.0
        assert provider.call_count == 1

    @pytest.mark.asyncio
    async def test_classifier_name_includes_provider(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        assert classifier.name == "llm-stub"

    @pytest.mark.asyncio
    async def test_system_prompt_includes_capabilities(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        await classifier.classify(_ctx("test"))

        assert "vocab" in provider.last_system_prompt
        assert "quiz" in provider.last_system_prompt
        assert "daily_word" in provider.last_system_prompt

    @pytest.mark.asyncio
    async def test_user_message_includes_text(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        await classifier.classify(_ctx("define ephemeral"))

        assert "define ephemeral" in provider.last_user_message

    @pytest.mark.asyncio
    async def test_conversation_history_included(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        ctx = _ctx(
            "yes please",
            conversation_history=[
                {"role": "user", "content": "want a quiz?"},
                {"role": "assistant", "content": "Sure! Ready?"},
            ],
        )
        await classifier.classify(ctx)
        assert "want a quiz?" in provider.last_user_message

    @pytest.mark.asyncio
    async def test_user_preferences_included(self):
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        ctx = _ctx("teach me", user_preferences={"difficulty": "hard"})
        await classifier.classify(ctx)
        assert "hard" in provider.last_user_message

    @pytest.mark.asyncio
    async def test_provider_error_raises_classification_error(self):
        provider = StubLLMProvider(error=TimeoutError("API timeout"))
        classifier = LLMClassifier(provider)

        with pytest.raises(ClassificationError, match="LLM provider error"):
            await classifier.classify(_ctx("hello"))

    @pytest.mark.asyncio
    async def test_invalid_json_response_raises(self):
        provider = StubLLMProvider(response="I don't understand")
        classifier = LLMClassifier(provider)

        with pytest.raises(ClassificationError):
            await classifier.classify(_ctx("hello"))

    @pytest.mark.asyncio
    async def test_invalid_capability_cleared(self):
        """LLM returning a non-existent capability should be cleared."""
        provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "confidence": 0.9,
            "target_capability": "nonexistent_cap",
        }))
        classifier = LLMClassifier(provider)
        decision = await classifier.classify(_ctx("test"))
        assert decision.target_capability == ""

    @pytest.mark.asyncio
    async def test_valid_capability_preserved(self):
        provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "confidence": 0.9,
            "target_capability": "quiz",
        }))
        classifier = LLMClassifier(provider)
        decision = await classifier.classify(_ctx("test"))
        assert decision.target_capability == "quiz"

    @pytest.mark.asyncio
    async def test_health_check_delegates_to_provider(self):
        healthy = LLMClassifier(StubLLMProvider(healthy=True))
        unhealthy = LLMClassifier(StubLLMProvider(healthy=False))
        assert await healthy.health_check() is True
        assert await unhealthy.health_check() is False

    @pytest.mark.asyncio
    async def test_health_check_catches_exception(self):
        provider = StubLLMProvider()
        provider._healthy = True  # type: ignore
        # Override health_check to raise
        original = provider.health_check
        async def failing_health() -> bool:
            raise RuntimeError("boom")
        provider.health_check = failing_health  # type: ignore
        classifier = LLMClassifier(provider)
        assert await classifier.health_check() is False

    @pytest.mark.asyncio
    async def test_no_capabilities_in_context(self):
        """Should work even without capabilities (prompt says 'none registered')."""
        provider = StubLLMProvider()
        classifier = LLMClassifier(provider)
        ctx = ClassificationContext(message_text="hello", available_capabilities=[])
        await classifier.classify(ctx)
        assert "none registered" in provider.last_system_prompt


# ===========================================================================
# HybridClassifier Tests
# ===========================================================================


class TestHybridClassifier:
    """Tests for the hybrid (rule + LLM) classifier."""

    @pytest.fixture
    def rule_classifier(self) -> RuleBasedClassifier:
        return RuleBasedClassifier()

    @pytest.fixture
    def llm_provider(self) -> StubLLMProvider:
        return StubLLMProvider()

    @pytest.fixture
    def llm_classifier(self, llm_provider: StubLLMProvider) -> LLMClassifier:
        return LLMClassifier(llm_provider)

    @pytest.fixture
    def hybrid(
        self, rule_classifier: RuleBasedClassifier, llm_classifier: LLMClassifier
    ) -> HybridClassifier:
        return HybridClassifier(rule_classifier, llm_classifier)

    @pytest.mark.asyncio
    async def test_rule_hit_skips_llm(
        self, hybrid: HybridClassifier, llm_provider: StubLLMProvider
    ):
        """High-confidence rule match should not call the LLM."""
        decision = await hybrid.classify(_ctx("quiz me"))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "quiz"
        assert llm_provider.call_count == 0
        assert hybrid._rule_hits == 1

    @pytest.mark.asyncio
    async def test_llm_fallback_on_low_rule_confidence(
        self, hybrid: HybridClassifier, llm_provider: StubLLMProvider
    ):
        """Ambiguous messages should fall back to the LLM."""
        decision = await hybrid.classify(_ctx("zxyq plmkn wrtv"))
        # The LLM should have been called since rules can't match
        assert llm_provider.call_count == 1
        assert hybrid._llm_fallbacks == 1

    @pytest.mark.asyncio
    async def test_llm_fallback_on_unknown_rule(
        self, hybrid: HybridClassifier, llm_provider: StubLLMProvider
    ):
        """UNKNOWN rule result should trigger LLM fallback."""
        decision = await hybrid.classify(_ctx("xyzzy foobar"))
        assert llm_provider.call_count == 1

    @pytest.mark.asyncio
    async def test_graceful_degradation_on_llm_failure(self):
        """If LLM fails and rules matched (low confidence), use rule result."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider(error=TimeoutError("timeout"))
        llm_clf = LLMClassifier(llm_provider)
        hybrid = HybridClassifier(
            rule_clf, llm_clf, rule_confidence_threshold=0.99
        )

        # "vocab" will match rules but below threshold — LLM fallback will fail
        # but since rules did match, should return the rule result
        decision = await hybrid.classify(_ctx("vocab"))
        assert decision.intent == MessageIntent.LEARN
        assert hybrid._llm_failures == 1

    @pytest.mark.asyncio
    async def test_llm_failure_with_no_rule_match_raises(self):
        """If both rules and LLM fail, should raise ClassificationError."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider(error=TimeoutError("timeout"))
        llm_clf = LLMClassifier(llm_provider)
        hybrid = HybridClassifier(rule_clf, llm_clf)

        with pytest.raises(ClassificationError):
            await hybrid.classify(_ctx("xyzzy completely unknown"))

    @pytest.mark.asyncio
    async def test_classifier_name(self, hybrid: HybridClassifier):
        assert "hybrid" in hybrid.name
        assert "rule-based" in hybrid.name
        assert "llm-stub" in hybrid.name

    @pytest.mark.asyncio
    async def test_stats_tracking(
        self, hybrid: HybridClassifier, llm_provider: StubLLMProvider
    ):
        # Rule hit
        await hybrid.classify(_ctx("quiz me"))
        # LLM fallback (use text with no keyword matches)
        await hybrid.classify(_ctx("zxyq plmkn wrtv"))

        stats = hybrid.get_stats()
        assert stats["rule_hits"] == 1
        assert stats["llm_fallbacks"] == 1
        assert stats["llm_failures"] == 0

    @pytest.mark.asyncio
    async def test_health_check(self, hybrid: HybridClassifier):
        assert await hybrid.health_check() is True

    @pytest.mark.asyncio
    async def test_prefers_rule_over_unknown_llm(self):
        """If LLM returns UNKNOWN but rules had a match, prefer rules."""
        rule_clf = RuleBasedClassifier()
        # LLM returns UNKNOWN
        llm_provider = StubLLMProvider(response=json.dumps({
            "intent": "unknown",
            "confidence": 0.3,
        }))
        llm_clf = LLMClassifier(llm_provider)
        # Set threshold very high so rules always fall through to LLM
        hybrid = HybridClassifier(rule_clf, llm_clf, rule_confidence_threshold=0.99)

        decision = await hybrid.classify(_ctx("vocab"))
        # Should prefer the rule result since LLM said UNKNOWN
        assert decision.intent == MessageIntent.LEARN

    @pytest.mark.asyncio
    async def test_custom_threshold(self):
        """Lower threshold means more rule hits, fewer LLM calls."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider()
        llm_clf = LLMClassifier(llm_provider)

        # Very low threshold — almost everything should be a rule hit
        hybrid = HybridClassifier(rule_clf, llm_clf, rule_confidence_threshold=0.3)
        await hybrid.classify(_ctx("vocab"))
        assert llm_provider.call_count == 0  # Rule should handle it


# ===========================================================================
# Integration: RuleBasedClassifier + ServiceRouter
# ===========================================================================


class TestRuleBasedClassifierIntegration:
    """Integration tests verifying rule-based classifier works with ServiceRouter."""

    @pytest.mark.asyncio
    async def test_end_to_end_classification_scenarios(self):
        """Verify diverse message types are classified correctly."""
        classifier = RuleBasedClassifier()
        scenarios = [
            ("quiz me", MessageIntent.LEARN, "quiz"),
            ("give me today's word", MessageIntent.LEARN, "daily_word"),
            ("show flashcard", MessageIntent.LEARN, "flashcard"),
            ("define resilient", MessageIntent.LEARN, "define"),
            ("/help", MessageIntent.HELP, ""),
            ("/start", MessageIntent.START, ""),
            ("change my settings", MessageIntent.CONFIGURE, "settings"),
            ("I want to give feedback", MessageIntent.FEEDBACK, ""),
            ("learn vocabulary", MessageIntent.LEARN, "general"),
        ]

        for text, expected_intent, expected_sub in scenarios:
            decision = await classifier.classify(_ctx(text))
            assert decision.intent == expected_intent, (
                f"Message '{text}': expected {expected_intent}, got {decision.intent}"
            )
            if expected_sub:
                assert decision.sub_intent == expected_sub, (
                    f"Message '{text}': expected sub_intent '{expected_sub}', "
                    f"got '{decision.sub_intent}'"
                )

    @pytest.mark.asyncio
    async def test_case_insensitivity(self):
        """Classification should be case-insensitive."""
        classifier = RuleBasedClassifier()
        for text in ["QUIZ ME", "Quiz Me", "quiz me", "QuIz Me"]:
            decision = await classifier.classify(_ctx(text))
            assert decision.intent == MessageIntent.LEARN
            assert decision.sub_intent == "quiz"

    @pytest.mark.asyncio
    async def test_batch_classification(self):
        """Test the batch classification interface."""
        classifier = RuleBasedClassifier()
        contexts = [
            _ctx("quiz me"),
            _ctx("daily word"),
            _ctx("/help"),
            _ctx("xyzzy unknown"),
        ]
        results = await classifier.classify_batch(contexts)
        assert len(results) == 4
        assert results[0].intent == MessageIntent.LEARN
        assert results[1].intent == MessageIntent.LEARN
        assert results[2].intent == MessageIntent.HELP
        assert results[3].intent == MessageIntent.UNKNOWN
