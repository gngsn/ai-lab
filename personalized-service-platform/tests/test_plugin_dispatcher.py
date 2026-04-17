"""Tests for the plugin dispatcher handler.

Validates that the dispatcher correctly:
- Classifies inbound messages via the ServiceRouter
- Resolves the correct plugin from the PluginRegistry
- Builds a PluginContext with merged user config
- Dispatches to the plugin's execute() method
- Converts PluginResult to MessageResponse
- Handles platform intents, low confidence, no match, and errors
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.messaging.handlers.plugin_dispatcher import (
    DefaultPlatformIntentHandler,
    NullConfigProvider,
    PluginDispatcherHandler,
)
from app.messaging.models import (
    InboundMessage,
    MessageResponse,
    MessageSource,
    MessageType,
)
from app.routing.types import (
    ClassificationContext,
    MessageIntent,
    RoutingDecision,
    RoutingResult,
    RoutingStatus,
)
from app.services.plugin import (
    BasePlugin,
    PluginContext,
    PluginManifest,
    PluginResult,
)
from app.services.plugin_registry import PluginRegistry


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def _make_message(text: str = "quiz me on vocab", sender_id: str = "user_1") -> InboundMessage:
    """Create a minimal InboundMessage for testing."""
    return InboundMessage(
        source=MessageSource(platform="test", sender_id=sender_id, chat_id="chat_1"),
        message_type=MessageType.TEXT,
        text=text,
    )


class _StubPlugin(BasePlugin):
    """Minimal plugin for testing dispatch."""

    manifest = PluginManifest(
        name="stub_plugin",
        version="0.1.0",
        display_name="Stub Plugin",
        description="A test plugin",
        capabilities=["vocab", "quiz"],
        platform_version=">=0.1.0",
    )

    def __init__(self, result: PluginResult | None = None) -> None:
        self._result = result or PluginResult(
            text="Hello from stub plugin!",
            content={"intent": "quiz"},
        )
        self._last_context: PluginContext | None = None

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        self._last_context = context
        return self._result

    async def shutdown(self) -> None:
        pass


class _ErrorPlugin(BasePlugin):
    """Plugin that always raises during execute()."""

    manifest = PluginManifest(
        name="error_plugin",
        version="0.1.0",
        capabilities=["error"],
        platform_version=">=0.1.0",
    )

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        raise RuntimeError("Plugin crashed!")

    async def shutdown(self) -> None:
        pass


class _FakeConfigProvider:
    """Config provider that returns preset config."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config = config or {}

    async def get_user_plugin_config(self, user_id: str, plugin_name: str) -> dict[str, Any]:
        return dict(self._config)


def _make_router_mock(
    *,
    status: RoutingStatus = RoutingStatus.ROUTED,
    intent: MessageIntent = MessageIntent.LEARN,
    target_plugin: str = "stub_plugin",
    target_capability: str = "quiz",
    confidence: float = 0.9,
    fallback_plugin: str = "",
    error: str = "",
) -> MagicMock:
    """Create a mock ServiceRouter that returns a preset RoutingResult."""
    decision = RoutingDecision(
        intent=intent,
        sub_intent="quiz",
        confidence=confidence,
        target_capability=target_capability,
    )
    result = RoutingResult(
        status=status,
        decision=decision,
        target_plugin=target_plugin,
        target_capability=target_capability,
        fallback_plugin=fallback_plugin,
        error=error,
    )
    router = MagicMock()
    router.route_message = AsyncMock(return_value=result)
    router.get_routing_info.return_value = {"classifier": "mock", "active_plugins": []}
    return router


def _make_registry_with_plugin(plugin: BasePlugin | None = None) -> PluginRegistry:
    """Create a registry with one active plugin."""
    registry = PluginRegistry()
    p = plugin or _StubPlugin()
    entry = registry.register(p, skip_validation=True)
    # Manually set to ACTIVE for testing
    from app.services.plugin_registry import PluginState
    entry.state = PluginState.ACTIVE
    return registry


# ---------------------------------------------------------------------------
# Tests — successful dispatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_routes_text_message_to_plugin():
    """A standard text message is classified and dispatched to the correct plugin."""
    plugin = _StubPlugin()
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock(target_plugin="stub_plugin")

    handler = PluginDispatcherHandler(router, registry)
    message = _make_message("quiz me")

    response = await handler.handle(message)

    assert response.handled is True
    assert response.text == "Hello from stub plugin!"
    assert response.rich_content == {"intent": "quiz"}
    assert response.error is None

    # Verify plugin received the correct context
    assert plugin._last_context is not None
    assert plugin._last_context.user_id == "user_1"
    assert plugin._last_context.message == "quiz me"
    assert plugin._last_context.metadata["platform"] == "test"


@pytest.mark.asyncio
async def test_dispatch_passes_user_config_to_plugin():
    """User config from the provider is merged and passed to the plugin."""
    plugin = _StubPlugin()
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock()
    config_provider = _FakeConfigProvider({"difficulty_level": "hard", "words_per_day": 10})

    handler = PluginDispatcherHandler(router, registry, config_provider=config_provider)
    message = _make_message("quiz me")

    await handler.handle(message)

    # The merged config should contain the user overrides
    assert plugin._last_context is not None
    assert plugin._last_context.user_config["difficulty_level"] == "hard"
    assert plugin._last_context.user_config["words_per_day"] == 10


@pytest.mark.asyncio
async def test_dispatch_with_null_config_provider():
    """NullConfigProvider returns empty config, so plugin uses defaults."""
    plugin = _StubPlugin()
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock()

    handler = PluginDispatcherHandler(router, registry)
    message = _make_message("quiz me")

    await handler.handle(message)

    # Plugin should receive empty overrides → uses manifest defaults
    assert plugin._last_context is not None
    # merge_config with empty dict just returns defaults
    assert plugin._last_context.user_config == plugin.manifest.defaults()


@pytest.mark.asyncio
async def test_dispatch_routing_metadata_in_context():
    """Routing metadata (confidence, intent, entities) is passed to plugin context."""
    plugin = _StubPlugin()
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock(confidence=0.92, target_capability="quiz")

    handler = PluginDispatcherHandler(router, registry)
    message = _make_message("quiz me")

    await handler.handle(message)

    ctx = plugin._last_context
    assert ctx is not None
    assert ctx.metadata["routing_confidence"] == 0.92
    assert ctx.metadata["routing_intent"] == "learn"
    assert ctx.metadata["routing_capability"] == "quiz"


@pytest.mark.asyncio
async def test_dispatch_increments_count():
    """Dispatch count is incremented on each handle call."""
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)

    assert handler.dispatch_count == 0
    await handler.handle(_make_message("a"))
    assert handler.dispatch_count == 1
    await handler.handle(_make_message("b"))
    assert handler.dispatch_count == 2


# ---------------------------------------------------------------------------
# Tests — fallback dispatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_fallback_plugin():
    """When status is FALLBACK, the effective plugin is dispatched."""
    plugin = _StubPlugin(PluginResult(text="Fallback response"))
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock(
        status=RoutingStatus.FALLBACK,
        target_plugin="stub_plugin",
    )

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("something vague"))

    assert response.handled is True
    assert response.text == "Fallback response"
    assert response.metadata["routing_status"] == "fallback"


# ---------------------------------------------------------------------------
# Tests — platform intents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_platform_intent_help():
    """Platform-level HELP intent is handled without plugin dispatch."""
    router = _make_router_mock(
        status=RoutingStatus.PLATFORM_HANDLED,
        intent=MessageIntent.HELP,
        target_plugin="",
    )
    registry = _make_registry_with_plugin()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("help"))

    assert response.handled is True
    assert "help" in response.text.lower()


@pytest.mark.asyncio
async def test_dispatch_platform_intent_start():
    """Platform-level START intent returns a welcome message."""
    router = _make_router_mock(
        status=RoutingStatus.PLATFORM_HANDLED,
        intent=MessageIntent.START,
        target_plugin="",
    )
    registry = _make_registry_with_plugin()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("hello"))

    assert response.handled is True
    assert "welcome" in response.text.lower()


# ---------------------------------------------------------------------------
# Tests — low confidence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_low_confidence_no_fallback():
    """Low confidence without fallback returns a clarification message."""
    router = _make_router_mock(
        status=RoutingStatus.LOW_CONFIDENCE,
        confidence=0.3,
        target_plugin="",
    )
    registry = _make_registry_with_plugin()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("hmm"))

    assert response.handled is True
    assert "not quite sure" in response.text.lower() or "rephrase" in response.text.lower()


@pytest.mark.asyncio
async def test_dispatch_low_confidence_with_fallback():
    """Low confidence with a fallback plugin dispatches to that plugin."""
    plugin = _StubPlugin(PluginResult(text="Fallback handled it!"))
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock(
        status=RoutingStatus.LOW_CONFIDENCE,
        confidence=0.3,
        target_plugin="",
        fallback_plugin="stub_plugin",
    )

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("hmm"))

    assert response.handled is True
    assert response.text == "Fallback handled it!"


# ---------------------------------------------------------------------------
# Tests — no match
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_no_match():
    """NO_MATCH status returns a helpful message."""
    router = _make_router_mock(
        status=RoutingStatus.NO_MATCH,
        target_plugin="",
        error="No plugin found for capability 'unknown'",
    )
    registry = _make_registry_with_plugin()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("do something impossible"))

    assert response.handled is True
    assert "don't have a service" in response.text.lower() or "help" in response.text.lower()


# ---------------------------------------------------------------------------
# Tests — error handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_routing_error():
    """ERROR status from the router returns a user-friendly error."""
    router = _make_router_mock(
        status=RoutingStatus.ERROR,
        target_plugin="",
        error="LLM provider timeout",
    )
    registry = _make_registry_with_plugin()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("quiz me"))

    assert response.handled is True
    assert response.error == "LLM provider timeout"


@pytest.mark.asyncio
async def test_dispatch_plugin_not_active():
    """If the resolved plugin isn't active, return an error response."""
    registry = PluginRegistry()  # empty registry — no active plugins
    router = _make_router_mock(target_plugin="nonexistent_plugin")

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("quiz me"))

    assert response.handled is True
    assert "unavailable" in response.text.lower()
    assert handler.error_count == 1


@pytest.mark.asyncio
async def test_dispatch_plugin_execution_error():
    """If plugin.execute() raises, return an error response."""
    plugin = _ErrorPlugin()
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock(target_plugin="error_plugin")

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("cause an error"))

    assert response.handled is True
    assert "error occurred" in response.text.lower()
    assert response.error is not None
    assert "plugin_execution_error" in response.error
    assert handler.error_count == 1


@pytest.mark.asyncio
async def test_dispatch_plugin_returns_error_result():
    """If plugin returns a PluginResult with error, it's reflected in response."""
    plugin = _StubPlugin(PluginResult(error="Word not found"))
    registry = _make_registry_with_plugin(plugin)
    router = _make_router_mock()

    handler = PluginDispatcherHandler(router, registry)
    response = await handler.handle(_make_message("define xyzzy"))

    assert response.handled is True
    assert response.text == "Word not found"
    assert response.error == "Word not found"


# ---------------------------------------------------------------------------
# Tests — can_handle filtering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_can_handle_only_text_messages():
    """Dispatcher only handles TEXT type messages."""
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)

    text_msg = _make_message("quiz me")
    assert await handler.can_handle(text_msg) is True

    empty_msg = _make_message("")
    assert await handler.can_handle(empty_msg) is False

    whitespace_msg = _make_message("   ")
    assert await handler.can_handle(whitespace_msg) is False


def test_supported_types():
    """Supported types is TEXT only."""
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)
    assert handler.supported_types == {MessageType.TEXT}


# ---------------------------------------------------------------------------
# Tests — handler properties
# ---------------------------------------------------------------------------


def test_handler_name():
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)
    assert handler.name == "plugin_dispatcher"


def test_handler_priority_default():
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)
    assert handler.priority == 50


def test_handler_priority_custom():
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry, handler_priority=75)
    assert handler.priority == 75


def test_get_dispatch_info():
    """get_dispatch_info returns a summary of the dispatcher state."""
    registry = _make_registry_with_plugin()
    router = _make_router_mock()
    handler = PluginDispatcherHandler(router, registry)

    info = handler.get_dispatch_info()
    assert info["handler_name"] == "plugin_dispatcher"
    assert info["dispatch_count"] == 0
    assert info["error_count"] == 0
    assert "router_info" in info


# ---------------------------------------------------------------------------
# Tests — DefaultPlatformIntentHandler
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_default_platform_intent_handler_help():
    handler = DefaultPlatformIntentHandler()
    response = await handler.handle_platform_intent("help", _make_message("help"))
    assert response.handled is True
    assert "help" in response.text.lower()


@pytest.mark.asyncio
async def test_default_platform_intent_handler_unknown():
    handler = DefaultPlatformIntentHandler()
    response = await handler.handle_platform_intent("custom_intent", _make_message("x"))
    assert response.handled is True
    assert "custom_intent" in response.text


# ---------------------------------------------------------------------------
# Tests — NullConfigProvider
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_null_config_provider():
    provider = NullConfigProvider()
    config = await provider.get_user_plugin_config("user_1", "any_plugin")
    assert config == {}


# ---------------------------------------------------------------------------
# Tests — end-to-end with real ServiceRouter + RuleBasedClassifier
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_e2e_dispatcher_with_real_router():
    """Full integration: real router + classifier + plugin registry + dispatcher."""
    from app.routing.rule_based_classifier import RuleBasedClassifier
    from app.routing.router import ServiceRouter

    # Set up real components
    plugin = _StubPlugin()
    registry = _make_registry_with_plugin(plugin)
    classifier = RuleBasedClassifier()
    router = ServiceRouter(classifier, registry)

    handler = PluginDispatcherHandler(router, registry)

    # Send a message that should route to vocab/quiz
    message = _make_message("quiz me on vocabulary")
    response = await handler.handle(message)

    assert response.handled is True
    assert response.text == "Hello from stub plugin!"
    assert response.error is None

    # Plugin received the correct context
    ctx = plugin._last_context
    assert ctx is not None
    assert ctx.user_id == "user_1"
    assert ctx.message == "quiz me on vocabulary"
    assert ctx.metadata["routing_intent"] == "learn"


@pytest.mark.asyncio
async def test_e2e_dispatcher_platform_intent():
    """Real router classifies /help-like messages as platform intents."""
    from app.routing.rule_based_classifier import RuleBasedClassifier
    from app.routing.router import ServiceRouter

    registry = _make_registry_with_plugin()
    classifier = RuleBasedClassifier()
    router = ServiceRouter(classifier, registry)

    handler = PluginDispatcherHandler(router, registry)
    message = _make_message("help me")

    response = await handler.handle(message)

    assert response.handled is True
    # Should be handled by platform intent handler, not plugin
    assert "help" in response.text.lower()
