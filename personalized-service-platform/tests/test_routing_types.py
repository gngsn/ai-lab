"""Tests for the routing types, classifier interface, and service router."""

from __future__ import annotations

import pytest

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
from app.routing.router import ServiceRouter
from app.services.plugin import BasePlugin, PluginContext, PluginManifest, PluginResult
from app.services.plugin_registry import PluginRegistry


# ---------------------------------------------------------------------------
# Fixtures — stub classifier and plugin
# ---------------------------------------------------------------------------


class StubClassifier(MessageClassifier):
    """Classifier that returns a pre-configured decision."""

    def __init__(
        self,
        decision: RoutingDecision | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self._decision = decision or RoutingDecision(
            intent=MessageIntent.LEARN,
            sub_intent="daily_word",
            confidence=0.95,
            target_capability="vocab",
        )
        self._error = error
        self.call_count = 0

    @property
    def name(self) -> str:
        return "stub-classifier"

    async def classify(self, context: ClassificationContext) -> RoutingDecision:
        self.call_count += 1
        if self._error:
            raise self._error
        return self._decision


class StubPlugin(BasePlugin):
    """Minimal plugin for testing."""

    manifest = PluginManifest(
        name="test_vocab",
        version="0.1.0",
        display_name="Test Vocab",
        description="Test vocabulary plugin",
        capabilities=["vocab", "quiz"],
    )

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="stub response")

    async def shutdown(self) -> None:
        pass


@pytest.fixture
def plugin_registry() -> PluginRegistry:
    registry = PluginRegistry()
    return registry


@pytest.fixture
async def active_registry() -> PluginRegistry:
    registry = PluginRegistry()
    registry.register(StubPlugin())
    await registry.initialize_all()
    return registry


# ---------------------------------------------------------------------------
# MessageIntent tests
# ---------------------------------------------------------------------------


class TestMessageIntent:
    def test_intent_values(self):
        assert MessageIntent.LEARN.value == "learn"
        assert MessageIntent.CONFIGURE.value == "configure"
        assert MessageIntent.UNKNOWN.value == "unknown"

    def test_all_intents_have_string_values(self):
        for intent in MessageIntent:
            assert isinstance(intent.value, str)
            assert len(intent.value) > 0


# ---------------------------------------------------------------------------
# RoutingDecision tests
# ---------------------------------------------------------------------------


class TestRoutingDecision:
    def test_default_values(self):
        decision = RoutingDecision(intent=MessageIntent.LEARN)
        assert decision.intent == MessageIntent.LEARN
        assert decision.sub_intent == ""
        assert decision.confidence == 1.0
        assert decision.target_capability == ""
        assert decision.extracted_entities == {}
        assert decision.alternatives == []

    def test_high_confidence(self):
        high = RoutingDecision(intent=MessageIntent.LEARN, confidence=0.9)
        low = RoutingDecision(intent=MessageIntent.LEARN, confidence=0.3)
        assert high.is_high_confidence is True
        assert low.is_high_confidence is False

    def test_boundary_confidence(self):
        at_threshold = RoutingDecision(intent=MessageIntent.LEARN, confidence=0.7)
        assert at_threshold.is_high_confidence is True

    def test_platform_intent(self):
        help_decision = RoutingDecision(intent=MessageIntent.HELP)
        learn_decision = RoutingDecision(intent=MessageIntent.LEARN)
        start_decision = RoutingDecision(intent=MessageIntent.START)

        assert help_decision.is_platform_intent is True
        assert start_decision.is_platform_intent is True
        assert learn_decision.is_platform_intent is False

    def test_with_entities(self):
        decision = RoutingDecision(
            intent=MessageIntent.LEARN,
            sub_intent="define",
            target_capability="vocab",
            extracted_entities={"word": "ephemeral"},
        )
        assert decision.extracted_entities["word"] == "ephemeral"
        assert decision.sub_intent == "define"

    def test_with_alternatives(self):
        alt = RoutingDecision(
            intent=MessageIntent.QUERY,
            confidence=0.6,
            target_capability="search",
        )
        decision = RoutingDecision(
            intent=MessageIntent.LEARN,
            confidence=0.8,
            target_capability="vocab",
            alternatives=[alt],
        )
        assert len(decision.alternatives) == 1
        assert decision.alternatives[0].intent == MessageIntent.QUERY


# ---------------------------------------------------------------------------
# RoutingResult tests
# ---------------------------------------------------------------------------


class TestRoutingResult:
    def test_routed_status(self):
        result = RoutingResult(
            status=RoutingStatus.ROUTED,
            decision=RoutingDecision(intent=MessageIntent.LEARN),
            target_plugin="vocab_learning",
        )
        assert result.is_routed is True
        assert result.is_error is False
        assert result.effective_plugin == "vocab_learning"

    def test_fallback_status(self):
        result = RoutingResult(
            status=RoutingStatus.FALLBACK,
            decision=RoutingDecision(intent=MessageIntent.LEARN),
            fallback_plugin="default_handler",
        )
        assert result.is_routed is True
        assert result.effective_plugin == "default_handler"

    def test_no_match_status(self):
        result = RoutingResult(
            status=RoutingStatus.NO_MATCH,
            decision=RoutingDecision(intent=MessageIntent.UNKNOWN),
        )
        assert result.is_routed is False
        assert result.effective_plugin == ""

    def test_error_status(self):
        result = RoutingResult(
            status=RoutingStatus.ERROR,
            decision=RoutingDecision(intent=MessageIntent.UNKNOWN),
            error="classifier unavailable",
        )
        assert result.is_error is True
        assert result.error == "classifier unavailable"

    def test_effective_plugin_prefers_target(self):
        result = RoutingResult(
            status=RoutingStatus.ROUTED,
            decision=RoutingDecision(intent=MessageIntent.LEARN),
            target_plugin="primary",
            fallback_plugin="fallback",
        )
        assert result.effective_plugin == "primary"


# ---------------------------------------------------------------------------
# ServiceCapability tests
# ---------------------------------------------------------------------------


class TestServiceCapability:
    def test_frozen_dataclass(self):
        cap = ServiceCapability(plugin_name="vocab", capability="quiz")
        assert cap.plugin_name == "vocab"
        assert cap.capability == "quiz"

        with pytest.raises(AttributeError):
            cap.plugin_name = "other"  # type: ignore[misc]

    def test_optional_fields(self):
        cap = ServiceCapability(
            plugin_name="vocab",
            capability="quiz",
            display_name="Vocabulary Quiz",
            description="Test your vocab knowledge",
        )
        assert cap.display_name == "Vocabulary Quiz"


# ---------------------------------------------------------------------------
# ClassificationContext tests
# ---------------------------------------------------------------------------


class TestClassificationContext:
    def test_minimal_context(self):
        ctx = ClassificationContext(message_text="hello")
        assert ctx.message_text == "hello"
        assert ctx.user_id == ""
        assert ctx.available_capabilities == []

    def test_full_context(self):
        cap = ServiceCapability(plugin_name="vocab", capability="quiz")
        ctx = ClassificationContext(
            message_text="quiz me",
            user_id="user_123",
            available_capabilities=[cap],
            conversation_history=[{"role": "user", "content": "hi"}],
            user_preferences={"difficulty": "hard"},
            metadata={"locale": "en-US"},
        )
        assert len(ctx.available_capabilities) == 1
        assert ctx.user_preferences["difficulty"] == "hard"


# ---------------------------------------------------------------------------
# ClassificationError tests
# ---------------------------------------------------------------------------


class TestClassificationError:
    def test_basic_error(self):
        err = ClassificationError("LLM timeout")
        assert str(err) == "LLM timeout"
        assert err.original_text == ""
        assert err.cause is None

    def test_error_with_context(self):
        cause = TimeoutError("API timeout")
        err = ClassificationError(
            "Failed to classify",
            original_text="quiz me",
            cause=cause,
        )
        assert err.original_text == "quiz me"
        assert err.cause is cause


# ---------------------------------------------------------------------------
# MessageClassifier interface tests
# ---------------------------------------------------------------------------


class TestMessageClassifier:
    @pytest.mark.asyncio
    async def test_stub_classifier(self):
        classifier = StubClassifier()
        ctx = ClassificationContext(message_text="hello")
        decision = await classifier.classify(ctx)

        assert decision.intent == MessageIntent.LEARN
        assert decision.confidence == 0.95
        assert classifier.name == "stub-classifier"
        assert classifier.call_count == 1

    @pytest.mark.asyncio
    async def test_classify_batch_default(self):
        classifier = StubClassifier()
        contexts = [
            ClassificationContext(message_text="hello"),
            ClassificationContext(message_text="quiz"),
        ]
        results = await classifier.classify_batch(contexts)
        assert len(results) == 2
        assert classifier.call_count == 2

    @pytest.mark.asyncio
    async def test_health_check_default(self):
        classifier = StubClassifier()
        assert await classifier.health_check() is True


# ---------------------------------------------------------------------------
# ServiceRouter tests
# ---------------------------------------------------------------------------


class TestServiceRouter:
    @pytest.mark.asyncio
    async def test_route_to_plugin(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.LEARN,
                confidence=0.9,
                target_capability="vocab",
            )
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("give me a daily word")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "test_vocab"
        assert result.target_capability == "vocab"
        assert result.is_routed is True

    @pytest.mark.asyncio
    async def test_route_platform_intent(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(intent=MessageIntent.HELP, confidence=0.99)
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("/help")

        assert result.status == RoutingStatus.PLATFORM_HANDLED
        assert result.target_plugin == ""

    @pytest.mark.asyncio
    async def test_route_low_confidence(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.LEARN,
                confidence=0.2,
                target_capability="vocab",
            )
        )
        router = ServiceRouter(classifier, active_registry, confidence_threshold=0.5)
        result = await router.route_message("asdfgh")

        assert result.status == RoutingStatus.LOW_CONFIDENCE

    @pytest.mark.asyncio
    async def test_route_low_confidence_with_fallback(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.LEARN,
                confidence=0.2,
                target_capability="vocab",
            )
        )
        router = ServiceRouter(
            classifier,
            active_registry,
            confidence_threshold=0.5,
            fallback_plugin="test_vocab",
        )
        result = await router.route_message("asdfgh")

        assert result.status == RoutingStatus.LOW_CONFIDENCE
        assert result.fallback_plugin == "test_vocab"

    @pytest.mark.asyncio
    async def test_route_no_match(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.CREATE,
                confidence=0.9,
                target_capability="nonexistent_capability",
            )
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("create something")

        assert result.status == RoutingStatus.NO_MATCH
        assert "nonexistent_capability" in result.error

    @pytest.mark.asyncio
    async def test_route_classification_error(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            error=ClassificationError("LLM unavailable")
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("hello")

        assert result.status == RoutingStatus.ERROR
        assert result.is_error is True
        assert "LLM unavailable" in result.error

    @pytest.mark.asyncio
    async def test_route_unexpected_error(self, active_registry: PluginRegistry):
        classifier = StubClassifier(error=RuntimeError("kaboom"))
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("hello")

        assert result.status == RoutingStatus.ERROR
        assert "kaboom" in result.error

    @pytest.mark.asyncio
    async def test_build_context_populates_capabilities(self, active_registry: PluginRegistry):
        classifier = StubClassifier()
        router = ServiceRouter(classifier, active_registry)

        context = router.build_context("test message", user_id="u1")
        assert len(context.available_capabilities) == 2  # vocab + quiz
        cap_names = {c.capability for c in context.available_capabilities}
        assert "vocab" in cap_names
        assert "quiz" in cap_names

    @pytest.mark.asyncio
    async def test_route_with_alternative_fallback(self, active_registry: PluginRegistry):
        alt = RoutingDecision(
            intent=MessageIntent.LEARN,
            confidence=0.6,
            target_capability="quiz",
        )
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.CREATE,
                confidence=0.9,
                target_capability="nonexistent",
                alternatives=[alt],
            )
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("create something")

        assert result.status == RoutingStatus.FALLBACK
        assert result.target_plugin == "test_vocab"
        assert result.target_capability == "quiz"

    def test_confidence_threshold_property(self, plugin_registry: PluginRegistry):
        classifier = StubClassifier()
        router = ServiceRouter(classifier, plugin_registry, confidence_threshold=0.7)

        assert router.confidence_threshold == 0.7
        router.confidence_threshold = 0.3
        assert router.confidence_threshold == 0.3

        with pytest.raises(ValueError):
            router.confidence_threshold = 1.5

    def test_get_routing_info(self, plugin_registry: PluginRegistry):
        classifier = StubClassifier()
        router = ServiceRouter(classifier, plugin_registry, fallback_plugin="fallback")

        info = router.get_routing_info()
        assert info["classifier"] == "stub-classifier"
        assert info["fallback_plugin"] == "fallback"
        assert isinstance(info["available_capabilities"], list)

    @pytest.mark.asyncio
    async def test_route_infers_capability_from_intent(self, active_registry: PluginRegistry):
        """When classifier doesn't provide target_capability, router infers it from intent."""
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.LEARN,
                confidence=0.9,
                target_capability="",  # no explicit capability
            )
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("teach me words")

        assert result.status == RoutingStatus.ROUTED
        assert result.target_plugin == "test_vocab"
        assert result.target_capability == "vocab"

    @pytest.mark.asyncio
    async def test_all_matching_plugins(self, active_registry: PluginRegistry):
        classifier = StubClassifier(
            RoutingDecision(
                intent=MessageIntent.LEARN,
                confidence=0.9,
                target_capability="vocab",
            )
        )
        router = ServiceRouter(classifier, active_registry)
        result = await router.route_message("vocab")

        assert result.all_matching_plugins == ["test_vocab"]
