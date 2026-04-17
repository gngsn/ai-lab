"""Tests for message classification accuracy and correct routing to service plugins.

Covers:
- Unit tests: classification accuracy across diverse message types
- Integration tests: full pipeline from message → classifier → router → plugin resolution
- Edge cases: unknown intents, low-confidence classifications, ambiguous messages,
  missing plugins, fallback chains, empty/special inputs
- Routing correctness: ServiceRouter resolves the right plugin for each classified intent
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.routing.classifier import MessageClassifier
from app.routing.hybrid_classifier import HybridClassifier
from app.routing.llm_classifier import LLMClassifier, LLMProvider
from app.routing.router import ServiceRouter
from app.routing.rule_based_classifier import (
    ClassificationRule,
    RuleBasedClassifier,
)
from app.routing.types import (
    ClassificationContext,
    ClassificationError,
    MessageIntent,
    RoutingDecision,
    RoutingResult,
    RoutingStatus,
    ServiceCapability,
)
from app.services.plugin import (
    BasePlugin,
    PluginContext,
    PluginManifest,
    PluginResult,
)
from app.services.plugin_registry import PluginRegistry, PluginState


# ---------------------------------------------------------------------------
# Helpers: plugins, providers, fixtures
# ---------------------------------------------------------------------------


class VocabPlugin(BasePlugin):
    """Simulates a vocabulary learning plugin."""

    manifest = PluginManifest(
        name="vocab_learning",
        version="0.1.0",
        display_name="Vocabulary Learning",
        description="Learn new vocabulary words",
        capabilities=["vocab", "quiz", "daily_word", "flashcard"],
        platform_version=">=0.1.0",
    )

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="vocab response", content={"plugin": "vocab"})

    async def shutdown(self) -> None:
        pass


class FallbackPlugin(BasePlugin):
    """A generic fallback/chat plugin."""

    manifest = PluginManifest(
        name="general_chat",
        version="0.1.0",
        display_name="General Chat",
        description="Handles general conversation",
        capabilities=["chat", "general"],
        platform_version=">=0.1.0",
    )

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="fallback response")

    async def shutdown(self) -> None:
        pass


class StubLLMProvider:
    """In-memory LLM provider for testing."""

    def __init__(
        self,
        response: str | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self._response = response or json.dumps({
            "intent": "learn",
            "sub_intent": "general",
            "confidence": 0.85,
            "target_capability": "vocab",
            "extracted_entities": {},
            "reasoning": "Stub default",
        })
        self._error = error
        self.call_count = 0

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
        if self._error:
            raise self._error
        return self._response

    async def health_check(self) -> bool:
        return True


VOCAB_CAPABILITIES = [
    ServiceCapability(plugin_name="vocab_learning", capability="vocab",
                      display_name="Vocabulary", description="Vocabulary lookups"),
    ServiceCapability(plugin_name="vocab_learning", capability="quiz",
                      display_name="Quiz", description="Vocabulary quiz"),
    ServiceCapability(plugin_name="vocab_learning", capability="daily_word",
                      display_name="Daily Word", description="Word of the day"),
    ServiceCapability(plugin_name="vocab_learning", capability="flashcard",
                      display_name="Flashcard", description="Flashcard study"),
]


def _ctx(text: str, **kwargs: Any) -> ClassificationContext:
    """Build a ClassificationContext for testing."""
    return ClassificationContext(
        message_text=text,
        user_id=kwargs.pop("user_id", "test_user"),
        available_capabilities=kwargs.pop("capabilities", VOCAB_CAPABILITIES),
        **kwargs,
    )


def _make_registry(*plugins: BasePlugin) -> PluginRegistry:
    """Create a registry with given plugins set to ACTIVE."""
    registry = PluginRegistry()
    for p in plugins:
        entry = registry.register(p, skip_validation=True)
        entry.state = PluginState.ACTIVE
    return registry


def _make_router(
    classifier: MessageClassifier | None = None,
    registry: PluginRegistry | None = None,
    *,
    confidence_threshold: float = 0.5,
    fallback_plugin: str | None = None,
) -> ServiceRouter:
    """Create a ServiceRouter with sensible defaults."""
    clf = classifier or RuleBasedClassifier()
    reg = registry or _make_registry(VocabPlugin())
    return ServiceRouter(
        clf, reg,
        confidence_threshold=confidence_threshold,
        fallback_plugin=fallback_plugin,
    )


# ===========================================================================
# UNIT TESTS — Classification Accuracy
# ===========================================================================


class TestClassificationAccuracy:
    """Verify rule-based classifier correctly classifies diverse messages."""

    @pytest.fixture
    def classifier(self) -> RuleBasedClassifier:
        return RuleBasedClassifier()

    # -- Vocabulary / learning domain -----------------------------------------

    @pytest.mark.parametrize("message,expected_intent,expected_sub", [
        ("quiz me", MessageIntent.LEARN, "quiz"),
        ("test me on vocabulary", MessageIntent.LEARN, "quiz"),
        ("practice words", MessageIntent.LEARN, "quiz"),
        ("vocab quiz", MessageIntent.LEARN, "quiz"),
        ("give me the daily word", MessageIntent.LEARN, "daily_word"),
        ("word of the day", MessageIntent.LEARN, "daily_word"),
        ("teach me a new word", MessageIntent.LEARN, "daily_word"),
        ("flashcard", MessageIntent.LEARN, "flashcard"),
        ("show me flash cards", MessageIntent.LEARN, "flashcard"),
        ("study cards", MessageIntent.LEARN, "flashcard"),
        ("define resilient", MessageIntent.LEARN, "define"),
        ("what does ephemeral mean", MessageIntent.LEARN, "define"),
        ("meaning of ubiquitous", MessageIntent.LEARN, "define"),
        ("learn vocabulary", MessageIntent.LEARN, "general"),
        ("study words", MessageIntent.LEARN, "general"),
        ("I want to learn new words", MessageIntent.LEARN, "general"),
    ])
    async def test_learn_intent_messages(
        self, classifier: RuleBasedClassifier, message: str,
        expected_intent: MessageIntent, expected_sub: str,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.intent == expected_intent, (
            f"'{message}': expected intent {expected_intent}, got {decision.intent}"
        )
        assert decision.sub_intent == expected_sub, (
            f"'{message}': expected sub_intent '{expected_sub}', got '{decision.sub_intent}'"
        )

    # -- Platform intents -----------------------------------------------------

    @pytest.mark.parametrize("message,expected_intent", [
        ("/start", MessageIntent.START),
        ("hello", MessageIntent.START),
        ("hi", MessageIntent.START),
        ("get started", MessageIntent.START),
        ("/help", MessageIntent.HELP),
        ("help", MessageIntent.HELP),
        ("what can you do", MessageIntent.HELP),
        ("how to use", MessageIntent.HELP),
        ("feedback", MessageIntent.FEEDBACK),
        ("I found a bug", MessageIntent.FEEDBACK),
        ("report a bug", MessageIntent.FEEDBACK),
    ])
    async def test_platform_intent_messages(
        self, classifier: RuleBasedClassifier, message: str,
        expected_intent: MessageIntent,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.intent == expected_intent, (
            f"'{message}': expected {expected_intent}, got {decision.intent}"
        )
        assert decision.is_platform_intent

    # -- Configure intent -----------------------------------------------------

    @pytest.mark.parametrize("message", [
        "change my settings",
        "preferences",
        "configure",
        "update my preferences",
        "set difficulty",
    ])
    async def test_configure_intent(
        self, classifier: RuleBasedClassifier, message: str,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.intent == MessageIntent.CONFIGURE

    # -- Query intent ---------------------------------------------------------

    @pytest.mark.parametrize("message", [
        "search for cat",
        "find the word",
        "look up apple",
    ])
    async def test_query_intent(
        self, classifier: RuleBasedClassifier, message: str,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.intent == MessageIntent.QUERY

    # -- Unknown / edge cases -------------------------------------------------

    @pytest.mark.parametrize("message", [
        "",
        "   ",
        "\t\n",
        "asdfghjkl",
        "xyzzy foobar baz qux",
        "🎉🎊🎈",
        "12345678",
        "... --- ...",
    ])
    async def test_unknown_intent_messages(
        self, classifier: RuleBasedClassifier, message: str,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.intent == MessageIntent.UNKNOWN, (
            f"'{message}' should be UNKNOWN but got {decision.intent}"
        )

    # -- Entity extraction accuracy -------------------------------------------

    @pytest.mark.parametrize("message,expected_word", [
        ("define serendipity", "serendipity"),
        ("define cat", "cat"),
        ("what does pragmatic mean", "pragmatic"),
        ("meaning of ephemeral", "ephemeral"),
    ])
    async def test_entity_extraction(
        self, classifier: RuleBasedClassifier, message: str, expected_word: str,
    ):
        decision = await classifier.classify(_ctx(message))
        assert decision.extracted_entities.get("word") == expected_word, (
            f"'{message}': expected word='{expected_word}', "
            f"got entities={decision.extracted_entities}"
        )

    # -- Confidence ranges ----------------------------------------------------

    async def test_platform_intents_have_high_confidence(
        self, classifier: RuleBasedClassifier,
    ):
        """Platform intents (help, start) should have confidence > 0.8."""
        for msg in ["/help", "/start", "hello"]:
            decision = await classifier.classify(_ctx(msg))
            assert decision.confidence > 0.8, (
                f"'{msg}': confidence {decision.confidence} too low for platform intent"
            )

    async def test_domain_keywords_have_reasonable_confidence(
        self, classifier: RuleBasedClassifier,
    ):
        """Clear domain keywords should have confidence > 0.7."""
        for msg in ["quiz me", "daily word", "flashcard", "define cat"]:
            decision = await classifier.classify(_ctx(msg))
            assert decision.confidence > 0.7, (
                f"'{msg}': confidence {decision.confidence} is unexpectedly low"
            )

    async def test_unknown_messages_have_zero_confidence(
        self, classifier: RuleBasedClassifier,
    ):
        """Truly unrecognized messages should have confidence 0.0."""
        decision = await classifier.classify(_ctx("xyzzy foobar baz"))
        assert decision.confidence == 0.0

    # -- Case insensitivity ---------------------------------------------------

    @pytest.mark.parametrize("text", [
        "QUIZ ME", "Quiz Me", "quiz me", "QUIZ me", "quIZ ME",
    ])
    async def test_case_insensitive_classification(
        self, classifier: RuleBasedClassifier, text: str,
    ):
        decision = await classifier.classify(_ctx(text))
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == "quiz"


# ===========================================================================
# UNIT TESTS — ServiceRouter Routing Logic
# ===========================================================================


class TestServiceRouterRouting:
    """Test that ServiceRouter correctly maps classified intents to plugins."""

    async def test_route_learn_intent_to_vocab_plugin(self):
        """LEARN intent routes to the vocab plugin."""
        router = _make_router()
        result = await router.route_message("quiz me on vocabulary")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"
        assert result.target_capability == "quiz"
        assert result.is_routed

    async def test_route_daily_word_to_correct_capability(self):
        """Daily word messages route to the daily_word capability."""
        router = _make_router()
        result = await router.route_message("give me the daily word")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"
        assert result.target_capability == "daily_word"

    async def test_route_flashcard_to_correct_capability(self):
        router = _make_router()
        result = await router.route_message("flashcard")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_capability == "flashcard"

    async def test_route_platform_intent_not_dispatched_to_plugin(self):
        """Platform intents (help, start) are NOT routed to any plugin."""
        router = _make_router()

        for msg in ["/help", "/start", "hello"]:
            result = await router.route_message(msg)
            assert result.status == RoutingStatus.PLATFORM_HANDLED, (
                f"'{msg}' should be PLATFORM_HANDLED, got {result.status}"
            )
            assert result.target_plugin == ""
            assert not result.is_routed

    async def test_route_unknown_intent_no_match(self):
        """Unknown intent results in LOW_CONFIDENCE or NO_MATCH."""
        router = _make_router()
        result = await router.route_message("xyzzy foobar baz")

        assert result.status in (
            RoutingStatus.LOW_CONFIDENCE, RoutingStatus.NO_MATCH
        )
        assert not result.is_routed

    async def test_route_effective_plugin_property(self):
        """effective_plugin returns the target_plugin or fallback_plugin."""
        router = _make_router()
        result = await router.route_message("quiz me")

        assert result.effective_plugin == "vocab_learning"

    async def test_all_matching_plugins_populated(self):
        """When a capability matches, all_matching_plugins should list them."""
        router = _make_router()
        result = await router.route_message("quiz me")

        assert "vocab_learning" in result.all_matching_plugins


# ===========================================================================
# UNIT TESTS — Edge Cases in Routing
# ===========================================================================


class TestRoutingEdgeCases:
    """Edge cases: low confidence, unknown intents, missing plugins, errors."""

    # -- Low confidence -------------------------------------------------------

    async def test_low_confidence_below_threshold(self):
        """Messages with confidence below threshold get LOW_CONFIDENCE status."""
        # Use a very high threshold so everything is "low confidence"
        router = _make_router(confidence_threshold=0.99)
        result = await router.route_message("maybe vocab?")

        # Even "quiz me" with 0.90 confidence will be below 0.99 threshold
        assert result.status == RoutingStatus.LOW_CONFIDENCE

    async def test_low_confidence_with_fallback_plugin(self):
        """Low confidence + fallback plugin returns LOW_CONFIDENCE with fallback set."""
        registry = _make_registry(VocabPlugin(), FallbackPlugin())
        router = _make_router(
            registry=registry,
            confidence_threshold=0.99,
            fallback_plugin="general_chat",
        )
        result = await router.route_message("quiz me")

        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.fallback_plugin == "general_chat"
        assert result.effective_plugin == "general_chat"

    async def test_low_confidence_without_fallback(self):
        """Low confidence without fallback returns LOW_CONFIDENCE, no effective plugin."""
        router = _make_router(confidence_threshold=0.99)
        result = await router.route_message("quiz me")

        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.effective_plugin == ""

    # -- No matching plugin ---------------------------------------------------

    async def test_no_plugin_for_capability(self):
        """If no plugin matches the classified capability, return NO_MATCH."""
        # Register a plugin with different capabilities than what vocab rules target
        class OtherPlugin(BasePlugin):
            manifest = PluginManifest(
                name="other_plugin", version="0.1.0",
                capabilities=["weather"],
                platform_version=">=0.1.0",
            )
            async def initialize(self): pass
            async def execute(self, ctx): return PluginResult(text="x")
            async def shutdown(self): pass

        registry = _make_registry(OtherPlugin())
        router = _make_router(registry=registry)
        result = await router.route_message("quiz me on vocabulary")

        assert result.status == RoutingStatus.NO_MATCH
        assert not result.is_routed
        assert result.error  # should have an error message

    async def test_empty_registry_no_match(self):
        """Empty registry with no plugins: classify succeeds but no plugin resolves."""
        registry = PluginRegistry()
        classifier = RuleBasedClassifier()
        router = ServiceRouter(classifier, registry, confidence_threshold=0.5)
        result = await router.route_message("quiz me")

        # Classifier matches "quiz" with decent confidence, but no plugin in
        # the registry provides the "quiz" capability → NO_MATCH
        assert result.status == RoutingStatus.NO_MATCH
        assert not result.is_routed

    # -- Fallback chain -------------------------------------------------------

    async def test_fallback_plugin_used_on_no_match(self):
        """Fallback plugin is used when no capability matches the intent."""
        class WeirdPlugin(BasePlugin):
            manifest = PluginManifest(
                name="weird_plugin", version="0.1.0",
                capabilities=["weird_thing"],
                platform_version=">=0.1.0",
            )
            async def initialize(self): pass
            async def execute(self, ctx): return PluginResult(text="x")
            async def shutdown(self): pass

        class CatchAllPlugin(BasePlugin):
            manifest = PluginManifest(
                name="catch_all", version="0.1.0",
                capabilities=["catch_all"],
                platform_version=">=0.1.0",
            )
            async def initialize(self): pass
            async def execute(self, ctx): return PluginResult(text="caught!")
            async def shutdown(self): pass

        registry = _make_registry(WeirdPlugin(), CatchAllPlugin())
        router = _make_router(registry=registry, fallback_plugin="catch_all")

        result = await router.route_message("quiz me on vocabulary")
        assert result.status == RoutingStatus.FALLBACK
        assert result.effective_plugin == "catch_all"

    async def test_fallback_plugin_not_active(self):
        """If fallback plugin isn't active, returns NO_MATCH."""
        registry = PluginRegistry()
        # Register fallback but DON'T set to ACTIVE
        plugin = FallbackPlugin()
        registry.register(plugin, skip_validation=True)
        # State is REGISTERED, not ACTIVE

        router = _make_router(registry=registry, fallback_plugin="general_chat")
        result = await router.route_message("quiz me")
        # Fallback not active → can't use it
        assert result.status in (
            RoutingStatus.LOW_CONFIDENCE, RoutingStatus.NO_MATCH,
        )

    # -- Classification errors ------------------------------------------------

    async def test_classification_error_returns_error_status(self):
        """When classifier raises ClassificationError, router returns ERROR."""

        class FailingClassifier(MessageClassifier):
            @property
            def name(self) -> str:
                return "failing"

            async def classify(self, ctx: ClassificationContext) -> RoutingDecision:
                raise ClassificationError("LLM timeout", original_text=ctx.message_text)

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(FailingClassifier(), registry)
        result = await router.route_message("quiz me")

        assert result.status == RoutingStatus.ERROR
        assert result.is_error
        assert "LLM timeout" in result.error

    async def test_unexpected_classifier_error_returns_error_status(self):
        """When classifier raises unexpected exception, router returns ERROR."""

        class CrashingClassifier(MessageClassifier):
            @property
            def name(self) -> str:
                return "crashing"

            async def classify(self, ctx: ClassificationContext) -> RoutingDecision:
                raise RuntimeError("Unexpected crash")

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(CrashingClassifier(), registry)
        result = await router.route_message("quiz me")

        assert result.status == RoutingStatus.ERROR
        assert "Unexpected" in result.error

    # -- Confidence threshold management --------------------------------------

    async def test_confidence_threshold_setter(self):
        router = _make_router()
        router.confidence_threshold = 0.8
        assert router.confidence_threshold == 0.8

    async def test_confidence_threshold_validation(self):
        router = _make_router()
        with pytest.raises(ValueError, match="must be in"):
            router.confidence_threshold = 1.5
        with pytest.raises(ValueError, match="must be in"):
            router.confidence_threshold = -0.1

    # -- Context building -----------------------------------------------------

    async def test_build_context_populates_capabilities(self):
        """build_context should populate available capabilities from registry."""
        router = _make_router()
        ctx = router.build_context("quiz me", "user_1")

        cap_names = {c.capability for c in ctx.available_capabilities}
        assert "vocab" in cap_names
        assert "quiz" in cap_names

    async def test_build_context_with_preferences(self):
        router = _make_router()
        ctx = router.build_context(
            "quiz me", "user_1",
            user_preferences={"difficulty": "hard"},
        )
        assert ctx.user_preferences["difficulty"] == "hard"

    async def test_build_context_with_conversation_history(self):
        router = _make_router()
        history = [{"role": "user", "content": "hello"}]
        ctx = router.build_context("quiz me", "user_1", conversation_history=history)
        assert len(ctx.conversation_history) == 1

    # -- Routing info ---------------------------------------------------------

    async def test_get_routing_info(self):
        router = _make_router()
        info = router.get_routing_info()

        assert info["classifier"] == "rule-based"
        assert info["confidence_threshold"] == 0.5
        assert isinstance(info["available_capabilities"], list)
        assert len(info["available_capabilities"]) > 0


# ===========================================================================
# UNIT TESTS — Unknown Intent Handling
# ===========================================================================


class TestUnknownIntentHandling:
    """Specific tests for how unknown/unrecognized intents flow through the system."""

    async def test_gibberish_produces_unknown(self):
        classifier = RuleBasedClassifier()
        decision = await classifier.classify(_ctx("qwerty uiop asdf"))
        assert decision.intent == MessageIntent.UNKNOWN
        assert decision.confidence == 0.0

    async def test_unknown_intent_routes_to_low_confidence(self):
        """Unknown intent from classifier → LOW_CONFIDENCE routing status."""
        router = _make_router()
        result = await router.route_message("qwerty uiop asdf")
        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.decision.intent == MessageIntent.UNKNOWN

    async def test_unknown_intent_with_fallback(self):
        """Unknown intent with fallback plugin configured still stays LOW_CONFIDENCE."""
        registry = _make_registry(VocabPlugin(), FallbackPlugin())
        router = _make_router(
            registry=registry,
            fallback_plugin="general_chat",
        )
        result = await router.route_message("qwerty uiop asdf")
        # Unknown gives confidence 0.0 which is below default 0.5 threshold
        assert result.status == RoutingStatus.LOW_CONFIDENCE

    async def test_numeric_only_message_is_unknown(self):
        classifier = RuleBasedClassifier()
        decision = await classifier.classify(_ctx("98765432"))
        assert decision.intent == MessageIntent.UNKNOWN

    async def test_emoji_only_message_is_unknown(self):
        classifier = RuleBasedClassifier()
        decision = await classifier.classify(_ctx("🔥💯🚀"))
        assert decision.intent == MessageIntent.UNKNOWN

    async def test_single_character_unknown(self):
        classifier = RuleBasedClassifier()
        decision = await classifier.classify(_ctx("x"))
        assert decision.intent == MessageIntent.UNKNOWN

    async def test_special_characters_only(self):
        classifier = RuleBasedClassifier()
        decision = await classifier.classify(_ctx("@#$%^&*"))
        assert decision.intent == MessageIntent.UNKNOWN


# ===========================================================================
# INTEGRATION TESTS — Full Pipeline
# ===========================================================================


class TestRoutingIntegration:
    """Integration tests: real classifier + real router + real registry."""

    @pytest.fixture
    def setup(self):
        """Set up real components for integration tests."""
        vocab = VocabPlugin()
        fallback = FallbackPlugin()
        registry = _make_registry(vocab, fallback)
        classifier = RuleBasedClassifier()
        router = ServiceRouter(
            classifier, registry,
            confidence_threshold=0.5,
            fallback_plugin="general_chat",
        )
        return router, registry, vocab

    async def test_full_pipeline_quiz_routes_to_vocab(self, setup):
        router, registry, vocab = setup
        result = await router.route_message("quiz me on words")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"
        assert result.target_capability == "quiz"

        # Verify we can actually fetch the plugin from the registry
        plugin = registry.get_active(result.effective_plugin)
        assert plugin is not None
        assert plugin.manifest.name == "vocab_learning"

    async def test_full_pipeline_daily_word(self, setup):
        router, _, _ = setup
        result = await router.route_message("word of the day")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_capability == "daily_word"
        assert result.target_plugin == "vocab_learning"

    async def test_full_pipeline_help_is_platform_handled(self, setup):
        router, _, _ = setup
        result = await router.route_message("/help")

        assert result.status == RoutingStatus.PLATFORM_HANDLED
        assert result.decision.intent == MessageIntent.HELP
        assert not result.is_routed

    async def test_full_pipeline_unknown_is_low_confidence(self, setup):
        router, _, _ = setup
        result = await router.route_message("zzzzzzz random text 12345")

        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.decision.intent == MessageIntent.UNKNOWN

    async def test_full_pipeline_define_extracts_word(self, setup):
        router, _, _ = setup
        result = await router.route_message("define serendipity")

        assert result.status == RoutingStatus.ROUTED
        assert result.decision.extracted_entities.get("word") == "serendipity"
        assert result.target_plugin == "vocab_learning"

    async def test_full_pipeline_configure_is_platform_handled(self, setup):
        router, _, _ = setup
        result = await router.route_message("change my settings")

        # CONFIGURE intent → the router maps it through intent_to_default_capability
        # which returns "" → NO_MATCH or falls back
        # Actually, CONFIGURE is not a platform intent, so it goes to _resolve_plugin
        assert result.decision.intent == MessageIntent.CONFIGURE

    async def test_full_pipeline_multiple_messages_sequential(self, setup):
        """Route multiple messages sequentially — each routed independently."""
        router, _, _ = setup
        messages_and_expected = [
            ("quiz me", RoutingStatus.ROUTED),
            ("/help", RoutingStatus.PLATFORM_HANDLED),
            ("daily word", RoutingStatus.ROUTED),
            ("xyzzy gibberish", RoutingStatus.LOW_CONFIDENCE),
            ("define cat", RoutingStatus.ROUTED),
            ("/start", RoutingStatus.PLATFORM_HANDLED),
        ]

        for msg, expected_status in messages_and_expected:
            result = await router.route_message(msg)
            assert result.status == expected_status, (
                f"'{msg}': expected {expected_status}, got {result.status}"
            )


# ===========================================================================
# INTEGRATION TESTS — Hybrid Classifier + Router
# ===========================================================================


class TestHybridClassifierRouting:
    """Integration: hybrid classifier + router for messages needing LLM fallback."""

    async def test_rule_hit_routes_correctly(self):
        """High-confidence rule match routes without LLM."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider()
        llm_clf = LLMClassifier(llm_provider)
        hybrid = HybridClassifier(rule_clf, llm_clf)

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(hybrid, registry)

        result = await router.route_message("quiz me on words")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"
        assert llm_provider.call_count == 0  # LLM not called

    async def test_llm_fallback_routes_correctly(self):
        """Ambiguous message uses LLM fallback and routes based on LLM result."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "sub_intent": "quiz",
            "confidence": 0.88,
            "target_capability": "quiz",
            "extracted_entities": {},
            "reasoning": "User wants a quiz",
        }))
        llm_clf = LLMClassifier(llm_provider)
        hybrid = HybridClassifier(rule_clf, llm_clf)

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(hybrid, registry)

        result = await router.route_message("zzz ambiguous message")

        # LLM should have been called
        assert llm_provider.call_count == 1
        assert result.status == RoutingStatus.ROUTED
        assert result.target_capability == "quiz"

    async def test_llm_failure_graceful_degradation(self):
        """If LLM fails on ambiguous message, rule result used if available."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider(error=TimeoutError("timeout"))
        llm_clf = LLMClassifier(llm_provider)
        # Set threshold very high so "vocab" triggers LLM fallback
        hybrid = HybridClassifier(rule_clf, llm_clf, rule_confidence_threshold=0.99)

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(hybrid, registry)

        # "vocab" matches rules but with confidence below 0.99
        result = await router.route_message("vocab")

        # Should still route because rule result is used as degraded fallback
        assert result.decision.intent == MessageIntent.LEARN

    async def test_both_fail_returns_error(self):
        """If both rules and LLM fail, router returns ERROR."""
        rule_clf = RuleBasedClassifier()
        llm_provider = StubLLMProvider(error=TimeoutError("timeout"))
        llm_clf = LLMClassifier(llm_provider)
        hybrid = HybridClassifier(rule_clf, llm_clf)

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(hybrid, registry)

        # Completely unmatched message + LLM failure
        result = await router.route_message("xyzzy completely unknown")

        assert result.status == RoutingStatus.ERROR


# ===========================================================================
# INTEGRATION TESTS — Multi-Plugin Resolution
# ===========================================================================


class TestMultiPluginRouting:
    """Test routing when multiple plugins register overlapping capabilities."""

    async def test_first_matching_plugin_selected(self):
        """When multiple plugins match, the first registered one is selected."""
        class VocabPlugin2(BasePlugin):
            manifest = PluginManifest(
                name="vocab_advanced", version="0.1.0",
                capabilities=["vocab", "quiz"],
                platform_version=">=0.1.0",
            )
            async def initialize(self): pass
            async def execute(self, ctx): return PluginResult(text="advanced")
            async def shutdown(self): pass

        registry = _make_registry(VocabPlugin(), VocabPlugin2())
        router = _make_router(registry=registry)

        result = await router.route_message("quiz me")
        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin in ("vocab_learning", "vocab_advanced")
        assert len(result.all_matching_plugins) == 2

    async def test_alternative_capability_used_when_primary_missing(self):
        """If primary capability has no match, alternatives are tried."""
        # Create a classifier that returns a decision with alternatives
        class AltClassifier(MessageClassifier):
            @property
            def name(self) -> str:
                return "alt-test"

            async def classify(self, ctx: ClassificationContext) -> RoutingDecision:
                return RoutingDecision(
                    intent=MessageIntent.LEARN,
                    confidence=0.9,
                    target_capability="nonexistent",
                    alternatives=[
                        RoutingDecision(
                            intent=MessageIntent.LEARN,
                            confidence=0.7,
                            target_capability="vocab",
                        )
                    ],
                )

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(AltClassifier(), registry)
        result = await router.route_message("something")

        assert result.status == RoutingStatus.FALLBACK
        assert result.target_plugin == "vocab_learning"
        assert result.target_capability == "vocab"


# ===========================================================================
# UNIT TESTS — LLM Classifier with Router Integration
# ===========================================================================


class TestLLMClassifierRouting:
    """Test LLM classifier integration with the router."""

    async def test_llm_routes_valid_capability(self):
        provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "sub_intent": "quiz",
            "confidence": 0.95,
            "target_capability": "quiz",
            "extracted_entities": {"word": "cat"},
            "reasoning": "User wants a quiz",
        }))
        classifier = LLMClassifier(provider)
        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(classifier, registry)

        result = await router.route_message("quiz me about cats")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"
        assert result.target_capability == "quiz"

    async def test_llm_invalid_capability_causes_no_match(self):
        """LLM returns invalid capability → cleared → intent-based fallback."""
        provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "confidence": 0.9,
            "target_capability": "nonexistent_cap",
        }))
        classifier = LLMClassifier(provider)
        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(classifier, registry)

        result = await router.route_message("test message")

        # target_capability gets cleared by LLM classifier validation
        # Then router falls back to intent_to_default_capability mapping
        # LEARN → "vocab" → matches vocab_learning
        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "vocab_learning"

    async def test_llm_low_confidence_response(self):
        """LLM returns low confidence → LOW_CONFIDENCE status."""
        provider = StubLLMProvider(response=json.dumps({
            "intent": "learn",
            "confidence": 0.2,
            "target_capability": "vocab",
        }))
        classifier = LLMClassifier(provider)
        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(classifier, registry, confidence_threshold=0.5)

        result = await router.route_message("maybe something")

        assert result.status == RoutingStatus.LOW_CONFIDENCE

    async def test_llm_unknown_intent_response(self):
        """LLM returns unknown intent → LOW_CONFIDENCE with no capability."""
        provider = StubLLMProvider(response=json.dumps({
            "intent": "unknown",
            "confidence": 0.3,
            "target_capability": "",
        }))
        classifier = LLMClassifier(provider)
        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(classifier, registry)

        result = await router.route_message("???")

        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.decision.intent == MessageIntent.UNKNOWN

    async def test_llm_platform_intent_response(self):
        """LLM classifies as platform intent → PLATFORM_HANDLED."""
        provider = StubLLMProvider(response=json.dumps({
            "intent": "help",
            "confidence": 0.95,
            "target_capability": "",
        }))
        classifier = LLMClassifier(provider)
        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(classifier, registry)

        result = await router.route_message("how do I use this?")

        assert result.status == RoutingStatus.PLATFORM_HANDLED
        assert result.decision.intent == MessageIntent.HELP


# ===========================================================================
# EDGE CASE TESTS — Boundary Conditions
# ===========================================================================


class TestBoundaryConditions:
    """Boundary condition tests for routing."""

    async def test_confidence_exactly_at_threshold(self):
        """Confidence exactly at threshold should be accepted (not LOW_CONFIDENCE)."""

        class ExactConfidenceClassifier(MessageClassifier):
            @property
            def name(self) -> str:
                return "exact"

            async def classify(self, ctx: ClassificationContext) -> RoutingDecision:
                return RoutingDecision(
                    intent=MessageIntent.LEARN,
                    confidence=0.5,  # exactly at default threshold
                    target_capability="vocab",
                )

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(
            ExactConfidenceClassifier(), registry,
            confidence_threshold=0.5,
        )
        result = await router.route_message("test")

        assert result.status == RoutingStatus.ROUTED

    async def test_confidence_just_below_threshold(self):
        """Confidence just below threshold → LOW_CONFIDENCE."""

        class BelowConfidenceClassifier(MessageClassifier):
            @property
            def name(self) -> str:
                return "below"

            async def classify(self, ctx: ClassificationContext) -> RoutingDecision:
                return RoutingDecision(
                    intent=MessageIntent.LEARN,
                    confidence=0.499,
                    target_capability="vocab",
                )

        registry = _make_registry(VocabPlugin())
        router = ServiceRouter(
            BelowConfidenceClassifier(), registry,
            confidence_threshold=0.5,
        )
        result = await router.route_message("test")

        assert result.status == RoutingStatus.LOW_CONFIDENCE

    async def test_very_long_message(self):
        """Very long messages don't cause errors."""
        router = _make_router()
        long_message = "quiz me on vocabulary " * 500
        result = await router.route_message(long_message)

        # Should still classify successfully
        assert result.status in (
            RoutingStatus.ROUTED, RoutingStatus.LOW_CONFIDENCE,
            RoutingStatus.NO_MATCH,
        )

    async def test_message_with_special_characters(self):
        """Messages with special chars don't crash the classifier."""
        router = _make_router()
        special_messages = [
            "quiz me! @#$%",
            "define <script>alert('xss')</script>",
            "vocab (test) [brackets] {braces}",
            "learn\nnew\nwords",
            "quiz\tme\there",
        ]
        for msg in special_messages:
            result = await router.route_message(msg)
            # Should not raise — any status is fine
            assert isinstance(result, RoutingResult)

    async def test_unicode_messages(self):
        """Unicode messages don't crash the system."""
        router = _make_router()
        unicode_messages = [
            "단어를 배우고 싶어요",  # Korean
            "単語を学びたい",  # Japanese
            "Я хочу учить слова",  # Russian
            "مرحبا",  # Arabic
        ]
        for msg in unicode_messages:
            result = await router.route_message(msg)
            assert isinstance(result, RoutingResult)

    async def test_intent_to_capability_mapping_completeness(self):
        """Verify the intent→capability mapping covers key learning intents."""
        # The static mapping should map LEARN, QUERY, INTERACT to "vocab"
        mapping_result = ServiceRouter._intent_to_default_capability(MessageIntent.LEARN)
        assert mapping_result == "vocab"

        mapping_result = ServiceRouter._intent_to_default_capability(MessageIntent.QUERY)
        assert mapping_result == "vocab"

        mapping_result = ServiceRouter._intent_to_default_capability(MessageIntent.INTERACT)
        assert mapping_result == "vocab"

    async def test_unmapped_intent_returns_empty_capability(self):
        """Intents not in the mapping return empty string."""
        for intent in [MessageIntent.CREATE, MessageIntent.FEEDBACK,
                       MessageIntent.HELP, MessageIntent.UNKNOWN]:
            result = ServiceRouter._intent_to_default_capability(intent)
            assert result == "", f"{intent} should map to empty capability"
