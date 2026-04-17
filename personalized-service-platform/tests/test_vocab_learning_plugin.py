"""Integration tests for the VocabLearningPlugin.

This test module validates that the vocabulary-learning plugin:
1. Provides a valid manifest that passes registry validation.
2. Implements the full BasePlugin lifecycle (initialize → execute → shutdown).
3. Routes inbound messages to the correct intent handler.
4. Respects user configuration for content personalization.
5. Produces channel-agnostic PluginResult output.
6. Works correctly when loaded through the PluginRegistry.
"""

import pytest

from app.plugins.vocab_learning import (
    VOCAB_LEARNING_MANIFEST,
    VocabLearningPlugin,
    _detect_intent,
)
from app.services.plugin import (
    ConfigOptionType,
    PluginContext,
    PluginResult,
)
from app.services.plugin_registry import (
    PluginRegistry,
    PluginState,
    validate_manifest,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def plugin() -> VocabLearningPlugin:
    """Return a fresh, uninitialized plugin instance."""
    return VocabLearningPlugin()


@pytest.fixture
async def initialized_plugin() -> VocabLearningPlugin:
    """Return an initialized plugin instance ready for execute()."""
    p = VocabLearningPlugin()
    await p.initialize()
    return p


def _make_context(
    message: str = "",
    user_id: str = "test-user-1",
    config: dict | None = None,
) -> PluginContext:
    return PluginContext(
        user_id=user_id,
        user_config=config or {},
        message=message,
    )


# ---------------------------------------------------------------------------
# Manifest validation tests
# ---------------------------------------------------------------------------


class TestManifestValidity:
    """Ensure the manifest passes all registry validation rules."""

    def test_manifest_passes_registry_validation(self):
        errors = validate_manifest(VOCAB_LEARNING_MANIFEST)
        assert errors == [], f"Manifest validation failed: {errors}"

    def test_manifest_has_required_fields(self):
        m = VOCAB_LEARNING_MANIFEST
        assert m.name == "vocab_learning"
        assert m.version == "0.1.0"
        assert m.display_name != ""
        assert m.description != ""

    def test_manifest_declares_capabilities(self):
        caps = VOCAB_LEARNING_MANIFEST.capabilities
        assert "vocab" in caps
        assert "daily_word" in caps
        assert "quiz" in caps
        assert "flashcard" in caps

    def test_manifest_has_config_options(self):
        opts = VOCAB_LEARNING_MANIFEST.config_options
        assert len(opts) >= 5, "Should have at least 5 configurable options"
        keys = {opt.key for opt in opts}
        assert "difficulty_level" in keys
        assert "words_per_day" in keys
        assert "include_examples" in keys
        assert "quiz_style" in keys
        assert "content_categories" in keys

    def test_manifest_config_option_types(self):
        """Verify that the plugin uses multiple config option types (granularity)."""
        opts = VOCAB_LEARNING_MANIFEST.config_options
        types_used = {opt.type for opt in opts}
        assert ConfigOptionType.SELECT in types_used
        assert ConfigOptionType.INTEGER in types_used
        assert ConfigOptionType.BOOLEAN in types_used
        assert ConfigOptionType.MULTI_SELECT in types_used

    def test_manifest_defaults_are_valid(self):
        """All default values must pass their own validation."""
        for opt in VOCAB_LEARNING_MANIFEST.config_options:
            if opt.default is not None:
                assert opt.validate_value(opt.default), (
                    f"Config option '{opt.key}' has invalid default: {opt.default!r}"
                )

    def test_manifest_validate_config_with_defaults(self):
        """Empty user config should be valid (all defaults apply)."""
        errors = VOCAB_LEARNING_MANIFEST.validate_config({})
        assert errors == []

    def test_manifest_validate_config_with_overrides(self):
        errors = VOCAB_LEARNING_MANIFEST.validate_config({
            "difficulty_level": "hard",
            "words_per_day": 10,
            "include_examples": False,
            "quiz_style": "fill_in_blank",
            "content_categories": ["words", "idioms"],
        })
        assert errors == []

    def test_manifest_validate_config_rejects_invalid(self):
        errors = VOCAB_LEARNING_MANIFEST.validate_config({
            "difficulty_level": "nightmare",  # not a valid choice
        })
        assert len(errors) > 0
        assert any("difficulty_level" in e for e in errors)

    def test_manifest_validate_config_rejects_unknown_keys(self):
        errors = VOCAB_LEARNING_MANIFEST.validate_config({
            "nonexistent_option": "value",
        })
        assert any("Unknown" in e for e in errors)

    def test_manifest_platform_version_compatible(self):
        assert VOCAB_LEARNING_MANIFEST.platform_version == ">=0.1.0"

    def test_manifest_no_dependencies(self):
        """Vocab learning is a standalone plugin — no deps."""
        assert VOCAB_LEARNING_MANIFEST.dependencies == []


# ---------------------------------------------------------------------------
# Lifecycle tests
# ---------------------------------------------------------------------------


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_initialize(self, plugin):
        assert not plugin.is_initialized
        await plugin.initialize()
        assert plugin.is_initialized

    @pytest.mark.asyncio
    async def test_shutdown(self, plugin):
        await plugin.initialize()
        assert plugin.is_initialized
        await plugin.shutdown()
        assert not plugin.is_initialized

    @pytest.mark.asyncio
    async def test_execute_before_init_returns_error(self, plugin):
        result = await plugin.execute(_make_context())
        assert result.is_error
        assert "not initialized" in result.error.lower()

    @pytest.mark.asyncio
    async def test_interaction_count(self, initialized_plugin):
        assert initialized_plugin.interaction_count == 0
        await initialized_plugin.execute(_make_context(message="daily word"))
        await initialized_plugin.execute(_make_context(message="quiz"))
        assert initialized_plugin.interaction_count == 2

    @pytest.mark.asyncio
    async def test_get_manifest(self, plugin):
        m = plugin.get_manifest()
        assert m is VOCAB_LEARNING_MANIFEST
        assert m.name == "vocab_learning"

    @pytest.mark.asyncio
    async def test_merge_config_applies_defaults(self, plugin):
        merged = plugin.merge_config({})
        assert merged["difficulty_level"] == "medium"
        assert merged["words_per_day"] == 5
        assert merged["include_examples"] is True

    @pytest.mark.asyncio
    async def test_merge_config_overrides(self, plugin):
        merged = plugin.merge_config({"difficulty_level": "hard", "words_per_day": 10})
        assert merged["difficulty_level"] == "hard"
        assert merged["words_per_day"] == 10
        # Non-overridden options keep defaults
        assert merged["include_examples"] is True


# ---------------------------------------------------------------------------
# Intent detection tests
# ---------------------------------------------------------------------------


class TestIntentDetection:
    def test_quiz_intent(self):
        assert _detect_intent("give me a quiz") == "quiz"
        assert _detect_intent("test me") == "quiz"
        assert _detect_intent("practice vocabulary") == "quiz"

    def test_daily_word_intent(self):
        assert _detect_intent("daily word") == "daily_word"
        assert _detect_intent("word of the day") == "daily_word"

    def test_flashcard_intent(self):
        assert _detect_intent("show me a flashcard") == "flashcard"

    def test_define_intent(self):
        assert _detect_intent("define ephemeral") == "define"
        assert _detect_intent("what is resilient") == "define"

    def test_help_intent(self):
        assert _detect_intent("help") == "help"
        assert _detect_intent("what can you do") == "help"

    def test_empty_message_defaults_to_daily(self):
        assert _detect_intent("") == "daily_word"

    def test_unknown_message_defaults_to_daily(self):
        assert _detect_intent("random gibberish xyz") == "daily_word"


# ---------------------------------------------------------------------------
# Execute — daily word handler tests
# ---------------------------------------------------------------------------


class TestDailyWordHandler:
    @pytest.mark.asyncio
    async def test_daily_word_returns_content(self, initialized_plugin):
        result = await initialized_plugin.execute(_make_context(message="daily word"))
        assert not result.is_error
        assert result.text != ""
        assert result.content["intent"] == "daily_word"
        assert "words" in result.content
        assert len(result.content["words"]) > 0

    @pytest.mark.asyncio
    async def test_daily_word_respects_difficulty(self, initialized_plugin):
        ctx = _make_context(message="daily word", config={"difficulty_level": "hard"})
        result = await initialized_plugin.execute(ctx)
        assert result.content["difficulty"] == "hard"

    @pytest.mark.asyncio
    async def test_daily_word_respects_word_count(self, initialized_plugin):
        ctx = _make_context(message="daily word", config={"words_per_day": 2})
        result = await initialized_plugin.execute(ctx)
        assert result.content["word_count"] <= 2

    @pytest.mark.asyncio
    async def test_daily_word_includes_examples_when_enabled(self, initialized_plugin):
        ctx = _make_context(message="daily word", config={"include_examples": True})
        result = await initialized_plugin.execute(ctx)
        assert "Example" in result.text

    @pytest.mark.asyncio
    async def test_daily_word_excludes_examples_when_disabled(self, initialized_plugin):
        ctx = _make_context(message="daily word", config={"include_examples": False})
        result = await initialized_plugin.execute(ctx)
        assert "Example" not in result.text

    @pytest.mark.asyncio
    async def test_daily_word_has_metadata(self, initialized_plugin):
        ctx = _make_context(message="daily word", user_id="user-42")
        result = await initialized_plugin.execute(ctx)
        assert result.metadata["plugin"] == "vocab_learning"
        assert result.metadata["intent"] == "daily_word"
        assert result.metadata["user_id"] == "user-42"


# ---------------------------------------------------------------------------
# Execute — quiz handler tests
# ---------------------------------------------------------------------------


class TestQuizHandler:
    @pytest.mark.asyncio
    async def test_quiz_multiple_choice(self, initialized_plugin):
        ctx = _make_context(message="quiz me", config={"quiz_style": "multiple_choice"})
        result = await initialized_plugin.execute(ctx)
        assert not result.is_error
        assert result.content["intent"] == "quiz"
        assert result.content["quiz_style"] == "multiple_choice"
        assert "options" in result.content
        assert "correct_index" in result.content

    @pytest.mark.asyncio
    async def test_quiz_fill_in_blank(self, initialized_plugin):
        ctx = _make_context(message="test me", config={"quiz_style": "fill_in_blank"})
        result = await initialized_plugin.execute(ctx)
        assert result.content["quiz_style"] == "fill_in_blank"
        assert "sentence_with_blank" in result.content
        assert "______" in result.content["sentence_with_blank"]

    @pytest.mark.asyncio
    async def test_quiz_definition_match(self, initialized_plugin):
        ctx = _make_context(message="quiz", config={"quiz_style": "definition_match"})
        result = await initialized_plugin.execute(ctx)
        assert result.content["quiz_style"] == "definition_match"
        assert "word" in result.content
        assert "definition" in result.content


# ---------------------------------------------------------------------------
# Execute — flashcard handler tests
# ---------------------------------------------------------------------------


class TestFlashcardHandler:
    @pytest.mark.asyncio
    async def test_flashcard_basic(self, initialized_plugin):
        ctx = _make_context(message="flashcard")
        result = await initialized_plugin.execute(ctx)
        assert not result.is_error
        assert result.content["intent"] == "flashcard"
        assert "front" in result.content
        assert "back" in result.content

    @pytest.mark.asyncio
    async def test_flashcard_respects_config(self, initialized_plugin):
        ctx = _make_context(
            message="flashcard",
            config={"include_examples": False, "include_part_of_speech": False},
        )
        result = await initialized_plugin.execute(ctx)
        # Back should not contain "Example:" or part of speech markers
        back = result.content["back"]
        assert "Example:" not in back


# ---------------------------------------------------------------------------
# Execute — define handler tests
# ---------------------------------------------------------------------------


class TestDefineHandler:
    @pytest.mark.asyncio
    async def test_define_known_word(self, initialized_plugin):
        ctx = _make_context(message="define resilient")
        result = await initialized_plugin.execute(ctx)
        assert result.content["intent"] == "define"
        assert result.content["found"] is True
        assert result.content["word"]["word"] == "resilient"

    @pytest.mark.asyncio
    async def test_define_unknown_word(self, initialized_plugin):
        ctx = _make_context(message="define xyznonexistent")
        result = await initialized_plugin.execute(ctx)
        assert result.content["intent"] == "define"
        assert result.content["found"] is False

    @pytest.mark.asyncio
    async def test_define_case_insensitive(self, initialized_plugin):
        ctx = _make_context(message="what is Ephemeral")
        result = await initialized_plugin.execute(ctx)
        assert result.content["found"] is True


# ---------------------------------------------------------------------------
# Execute — help handler tests
# ---------------------------------------------------------------------------


class TestHelpHandler:
    @pytest.mark.asyncio
    async def test_help(self, initialized_plugin):
        ctx = _make_context(message="help")
        result = await initialized_plugin.execute(ctx)
        assert result.content["intent"] == "help"
        assert "capabilities" in result.content
        assert "config_options" in result.content
        assert "Quiz" in result.text or "quiz" in result.text.lower()


# ---------------------------------------------------------------------------
# Channel agnosticism — PluginResult structure tests
# ---------------------------------------------------------------------------


class TestChannelAgnosticism:
    """Verify that results contain both structured content and plain text,
    enabling any delivery channel to format the output appropriately."""

    @pytest.mark.asyncio
    async def test_result_has_text_and_content(self, initialized_plugin):
        """Every result must have both text (simple channels) and content (rich channels)."""
        for message in ["daily word", "quiz", "flashcard", "help"]:
            result = await initialized_plugin.execute(_make_context(message=message))
            assert result.text != "", f"Missing text for intent triggered by '{message}'"
            assert result.content != {}, f"Missing content for intent triggered by '{message}'"

    @pytest.mark.asyncio
    async def test_result_content_is_json_serializable(self, initialized_plugin):
        """Content dict must be JSON-serializable (no custom objects)."""
        import json
        for message in ["daily word", "quiz", "flashcard", "define resilient", "help"]:
            result = await initialized_plugin.execute(_make_context(message=message))
            # Should not raise
            json.dumps(result.content)
            json.dumps(result.metadata)


# ---------------------------------------------------------------------------
# Registry integration tests
# ---------------------------------------------------------------------------


class TestRegistryIntegration:
    """Test that the plugin works correctly when managed by the PluginRegistry."""

    @pytest.mark.asyncio
    async def test_register_and_validate(self):
        registry = PluginRegistry()
        entry = registry.register(VocabLearningPlugin())
        assert entry.name == "vocab_learning"
        assert entry.state == PluginState.REGISTERED

    @pytest.mark.asyncio
    async def test_initialize_through_registry(self):
        registry = PluginRegistry()
        registry.register(VocabLearningPlugin())
        await registry.initialize_plugin("vocab_learning")
        entry = registry.get_entry("vocab_learning")
        assert entry.state == PluginState.ACTIVE

    @pytest.mark.asyncio
    async def test_find_by_capability(self):
        registry = PluginRegistry()
        registry.register(VocabLearningPlugin())
        await registry.initialize_all()

        for cap in ["vocab", "daily_word", "quiz", "flashcard"]:
            plugins = registry.find_by_capability(cap)
            assert len(plugins) == 1, f"Expected 1 plugin for capability '{cap}'"
            assert isinstance(plugins[0], VocabLearningPlugin)

    @pytest.mark.asyncio
    async def test_execute_through_registry(self):
        registry = PluginRegistry()
        registry.register(VocabLearningPlugin())
        await registry.initialize_all()

        plugin = registry.get_active("vocab_learning")
        assert plugin is not None
        result = await plugin.execute(_make_context(message="daily word"))
        assert not result.is_error
        assert result.content["intent"] == "daily_word"

    @pytest.mark.asyncio
    async def test_shutdown_through_registry(self):
        registry = PluginRegistry()
        plugin = VocabLearningPlugin()
        registry.register(plugin)
        await registry.initialize_all()
        await registry.shutdown_all()
        assert registry.get_entry("vocab_learning").state == PluginState.STOPPED
        assert not plugin.is_initialized

    @pytest.mark.asyncio
    async def test_summary_includes_vocab(self):
        registry = PluginRegistry()
        registry.register(VocabLearningPlugin())
        await registry.initialize_all()
        summary = registry.summary()
        assert "vocab_learning" in summary["plugins"]
        info = summary["plugins"]["vocab_learning"]
        assert info["state"] == "active"
        assert "vocab" in info["capabilities"]

    @pytest.mark.asyncio
    async def test_discover_in_plugins_package(self):
        """The plugin should be discoverable via package scanning."""
        from app.services.plugin_registry import discover_plugins_in_package

        classes = discover_plugins_in_package("app.plugins")
        names = {cls.manifest.name for cls in classes}
        assert "vocab_learning" in names
