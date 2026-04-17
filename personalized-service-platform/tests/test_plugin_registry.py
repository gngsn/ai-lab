"""Tests for the plugin registry — discovery, loading, validation, and management."""

import pytest

from app.services.plugin import (
    BasePlugin,
    ConfigOption,
    ConfigOptionType,
    PluginContext,
    PluginManifest,
    PluginResult,
)
from app.services.plugin_registry import (
    PLATFORM_VERSION,
    PluginDependencyError,
    PluginEntry,
    PluginLoadError,
    PluginRegistry,
    PluginState,
    PluginValidationError,
    _check_version_constraint,
    _topological_sort,
    discover_plugins_in_module,
    validate_manifest,
)


# ---------------------------------------------------------------------------
# Test plugin implementations
# ---------------------------------------------------------------------------


def _make_manifest(
    name: str = "test_plugin",
    version: str = "1.0.0",
    capabilities: list[str] | None = None,
    dependencies: list[str] | None = None,
    config_options: list[ConfigOption] | None = None,
    platform_version: str = ">=0.1.0",
) -> PluginManifest:
    return PluginManifest(
        name=name,
        version=version,
        display_name=name.replace("_", " ").title(),
        description=f"Test plugin: {name}",
        capabilities=capabilities or [],
        config_options=config_options or [],
        dependencies=dependencies or [],
        platform_version=platform_version,
    )


class DummyPlugin(BasePlugin):
    """A basic test plugin."""

    manifest = _make_manifest("dummy_plugin", capabilities=["test", "dummy"])

    def __init__(self) -> None:
        self._initialized = False
        self._shut_down = False

    async def initialize(self) -> None:
        self._initialized = True

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="dummy response")

    async def shutdown(self) -> None:
        self._shut_down = True


class VocabPlugin(BasePlugin):
    """Simulates a vocabulary learning plugin."""

    manifest = _make_manifest(
        "vocab_learning",
        capabilities=["vocab", "daily_word"],
        config_options=[
            ConfigOption(
                key="difficulty",
                label="Difficulty",
                type=ConfigOptionType.SELECT,
                default="medium",
                choices=["easy", "medium", "hard"],
            ),
            ConfigOption(
                key="words_per_day",
                label="Words per day",
                type=ConfigOptionType.INTEGER,
                default=5,
            ),
        ],
    )

    def __init__(self) -> None:
        self._initialized = False

    async def initialize(self) -> None:
        self._initialized = True

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="vocab word")

    async def shutdown(self) -> None:
        pass


class QuizPlugin(BasePlugin):
    """A quiz plugin that depends on vocab_learning."""

    manifest = _make_manifest(
        "quiz_plugin",
        capabilities=["quiz"],
        dependencies=["vocab_learning"],
    )

    async def initialize(self) -> None:
        pass

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(text="quiz question")

    async def shutdown(self) -> None:
        pass


class FailingPlugin(BasePlugin):
    """A plugin whose initialize() always raises."""

    manifest = _make_manifest("failing_plugin", capabilities=["fail"])

    async def initialize(self) -> None:
        raise RuntimeError("Intentional init failure")

    async def execute(self, context: PluginContext) -> PluginResult:
        return PluginResult(error="should never run")

    async def shutdown(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Manifest validation tests
# ---------------------------------------------------------------------------


class TestValidateManifest:
    def test_valid_manifest(self):
        m = _make_manifest("my_plugin", version="1.2.3")
        assert validate_manifest(m) == []

    def test_invalid_name_uppercase(self):
        m = _make_manifest("MyPlugin")
        errors = validate_manifest(m)
        assert any("name" in e.lower() for e in errors)

    def test_invalid_name_starts_with_number(self):
        m = _make_manifest("1plugin")
        errors = validate_manifest(m)
        assert any("name" in e.lower() for e in errors)

    def test_invalid_name_too_short(self):
        m = _make_manifest("x")
        errors = validate_manifest(m)
        assert any("name" in e.lower() for e in errors)

    def test_invalid_version(self):
        m = _make_manifest("ok_name", version="not_a_version")
        errors = validate_manifest(m)
        assert any("version" in e.lower() for e in errors)

    def test_platform_version_unsatisfied(self):
        m = _make_manifest("ok_name", platform_version=">=99.0.0")
        errors = validate_manifest(m)
        assert any("platform" in e.lower() for e in errors)

    def test_duplicate_config_key(self):
        m = _make_manifest(
            "ok_name",
            config_options=[
                ConfigOption(key="dup", label="A", type=ConfigOptionType.STRING),
                ConfigOption(key="dup", label="B", type=ConfigOptionType.STRING),
            ],
        )
        errors = validate_manifest(m)
        assert any("duplicate" in e.lower() for e in errors)

    def test_select_without_choices(self):
        m = _make_manifest(
            "ok_name",
            config_options=[
                ConfigOption(key="sel", label="S", type=ConfigOptionType.SELECT),
            ],
        )
        errors = validate_manifest(m)
        assert any("choices" in e.lower() for e in errors)

    def test_invalid_default(self):
        m = _make_manifest(
            "ok_name",
            config_options=[
                ConfigOption(
                    key="num",
                    label="N",
                    type=ConfigOptionType.INTEGER,
                    default="not_int",
                ),
            ],
        )
        errors = validate_manifest(m)
        assert any("default" in e.lower() for e in errors)

    def test_invalid_dependency_name(self):
        m = _make_manifest("ok_name", dependencies=["Invalid-Dep!"])
        errors = validate_manifest(m)
        assert any("dependency" in e.lower() for e in errors)


# ---------------------------------------------------------------------------
# Version constraint tests
# ---------------------------------------------------------------------------


class TestVersionConstraint:
    def test_gte(self):
        assert _check_version_constraint(">=0.1.0", "0.1.0") is True
        assert _check_version_constraint(">=0.1.0", "1.0.0") is True
        assert _check_version_constraint(">=0.2.0", "0.1.0") is False

    def test_eq(self):
        assert _check_version_constraint("==0.1.0", "0.1.0") is True
        assert _check_version_constraint("==0.1.0", "0.1.1") is False

    def test_bare_version(self):
        assert _check_version_constraint("0.1.0", "0.1.0") is True
        assert _check_version_constraint("0.1.0", "0.2.0") is False

    def test_lt(self):
        assert _check_version_constraint("<1.0.0", "0.9.9") is True
        assert _check_version_constraint("<1.0.0", "1.0.0") is False

    def test_neq(self):
        assert _check_version_constraint("!=0.1.0", "0.2.0") is True
        assert _check_version_constraint("!=0.1.0", "0.1.0") is False


# ---------------------------------------------------------------------------
# Registry — registration tests
# ---------------------------------------------------------------------------


class TestRegistryRegistration:
    @pytest.fixture
    def registry(self):
        return PluginRegistry()

    def test_register_plugin(self, registry):
        entry = registry.register(DummyPlugin())
        assert entry.name == "dummy_plugin"
        assert entry.state == PluginState.REGISTERED
        assert "dummy_plugin" in registry

    def test_register_duplicate_raises(self, registry):
        registry.register(DummyPlugin())
        with pytest.raises(ValueError, match="already registered"):
            registry.register(DummyPlugin())

    def test_register_invalid_manifest_raises(self, registry):
        class BadPlugin(BasePlugin):
            manifest = PluginManifest(name="Bad", version="nope")

            async def initialize(self): ...
            async def execute(self, ctx): ...
            async def shutdown(self): ...

        with pytest.raises(PluginValidationError):
            registry.register(BadPlugin())

    def test_register_skip_validation(self, registry):
        class BadPlugin(BasePlugin):
            manifest = PluginManifest(name="Bad", version="nope")

            async def initialize(self): ...
            async def execute(self, ctx): ...
            async def shutdown(self): ...

        # Should not raise with skip_validation=True
        entry = registry.register(BadPlugin(), skip_validation=True)
        assert entry.name == "Bad"

    def test_register_class(self, registry):
        entry = registry.register_class(DummyPlugin)
        assert entry.name == "dummy_plugin"

    def test_unregister(self, registry):
        registry.register(DummyPlugin())
        entry = registry.unregister("dummy_plugin")
        assert entry is not None
        assert "dummy_plugin" not in registry

    def test_unregister_nonexistent(self, registry):
        assert registry.unregister("nope") is None

    def test_count_and_len(self, registry):
        assert len(registry) == 0
        registry.register(DummyPlugin())
        assert registry.count == 1
        assert len(registry) == 1


# ---------------------------------------------------------------------------
# Registry — capability index tests
# ---------------------------------------------------------------------------


class TestCapabilityIndex:
    @pytest.fixture
    def registry(self):
        r = PluginRegistry()
        r.register(DummyPlugin())
        r.register(VocabPlugin())
        return r

    def test_capability_index_built(self, registry):
        caps = registry.list_capabilities()
        assert "test" in caps
        assert "dummy" in caps
        assert "vocab" in caps
        assert "daily_word" in caps

    def test_capability_cleaned_on_unregister(self, registry):
        registry.unregister("dummy_plugin")
        caps = registry.list_capabilities()
        # "test" and "dummy" should be gone
        assert "test" not in caps
        assert "dummy" not in caps
        # vocab caps remain
        assert "vocab" in caps


# ---------------------------------------------------------------------------
# Registry — dependency checking tests
# ---------------------------------------------------------------------------


class TestDependencyChecking:
    def test_no_missing_deps(self):
        registry = PluginRegistry()
        registry.register(VocabPlugin())
        registry.register(QuizPlugin())
        assert registry.check_dependencies() == {}

    def test_missing_dep(self):
        registry = PluginRegistry()
        registry.register(QuizPlugin())  # depends on vocab_learning, not loaded
        missing = registry.check_dependencies()
        assert "quiz_plugin" in missing
        assert "vocab_learning" in missing["quiz_plugin"]

    def test_check_single_plugin(self):
        registry = PluginRegistry()
        registry.register(QuizPlugin())
        missing = registry.check_dependencies("quiz_plugin")
        assert "quiz_plugin" in missing


# ---------------------------------------------------------------------------
# Registry — initialization tests
# ---------------------------------------------------------------------------


class TestRegistryInitialization:
    @pytest.mark.asyncio
    async def test_initialize_single(self):
        registry = PluginRegistry()
        registry.register(DummyPlugin())
        await registry.initialize_plugin("dummy_plugin")
        entry = registry.get_entry("dummy_plugin")
        assert entry is not None
        assert entry.state == PluginState.ACTIVE
        assert entry.plugin._initialized is True

    @pytest.mark.asyncio
    async def test_initialize_already_active(self):
        registry = PluginRegistry()
        registry.register(DummyPlugin())
        await registry.initialize_plugin("dummy_plugin")
        # Should be a no-op, not raise
        await registry.initialize_plugin("dummy_plugin")
        assert registry.get_entry("dummy_plugin").state == PluginState.ACTIVE

    @pytest.mark.asyncio
    async def test_initialize_missing_dep_raises(self):
        registry = PluginRegistry()
        registry.register(QuizPlugin())
        with pytest.raises(PluginDependencyError):
            await registry.initialize_plugin("quiz_plugin")

    @pytest.mark.asyncio
    async def test_initialize_failing_plugin(self):
        registry = PluginRegistry()
        registry.register(FailingPlugin())
        with pytest.raises(PluginLoadError):
            await registry.initialize_plugin("failing_plugin")
        entry = registry.get_entry("failing_plugin")
        assert entry.state == PluginState.FAILED
        assert entry.error is not None

    @pytest.mark.asyncio
    async def test_initialize_all_respects_dependency_order(self):
        registry = PluginRegistry()
        registry.register(QuizPlugin())  # depends on vocab_learning
        registry.register(VocabPlugin())  # no deps
        initialized = await registry.initialize_all()
        # vocab_learning must come before quiz_plugin
        assert initialized.index("vocab_learning") < initialized.index("quiz_plugin")

    @pytest.mark.asyncio
    async def test_initialize_all_skips_missing_deps(self):
        registry = PluginRegistry()
        registry.register(DummyPlugin())  # no deps
        registry.register(QuizPlugin())  # depends on vocab_learning (not registered)
        initialized = await registry.initialize_all()
        assert "dummy_plugin" in initialized
        assert "quiz_plugin" not in initialized
        assert registry.get_entry("quiz_plugin").state == PluginState.FAILED

    @pytest.mark.asyncio
    async def test_initialize_all_with_failing_plugin(self):
        registry = PluginRegistry()
        registry.register(DummyPlugin())
        registry.register(FailingPlugin())
        initialized = await registry.initialize_all()
        assert "dummy_plugin" in initialized
        assert "failing_plugin" not in initialized

    @pytest.mark.asyncio
    async def test_initialize_cascading_deps(self):
        """A plugin that depends on quiz_plugin which depends on vocab_learning."""

        class AdvancedQuiz(BasePlugin):
            manifest = _make_manifest(
                "advanced_quiz",
                capabilities=["advanced_quiz"],
                dependencies=["quiz_plugin"],
            )

            async def initialize(self): ...
            async def execute(self, ctx): return PluginResult(text="adv")
            async def shutdown(self): ...

        registry = PluginRegistry()
        registry.register(AdvancedQuiz())
        registry.register(QuizPlugin())
        registry.register(VocabPlugin())
        initialized = await registry.initialize_all()
        assert initialized == ["vocab_learning", "quiz_plugin", "advanced_quiz"]


# ---------------------------------------------------------------------------
# Registry — shutdown tests
# ---------------------------------------------------------------------------


class TestRegistryShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_plugin(self):
        registry = PluginRegistry()
        plugin = DummyPlugin()
        registry.register(plugin)
        await registry.initialize_plugin("dummy_plugin")
        await registry.shutdown_plugin("dummy_plugin")
        assert plugin._shut_down is True
        assert registry.get_entry("dummy_plugin").state == PluginState.STOPPED

    @pytest.mark.asyncio
    async def test_shutdown_all(self):
        registry = PluginRegistry()
        p1, p2 = DummyPlugin(), VocabPlugin()
        registry.register(p1)
        registry.register(p2)
        await registry.initialize_all()
        await registry.shutdown_all()
        assert registry.get_entry("dummy_plugin").state == PluginState.STOPPED
        assert registry.get_entry("vocab_learning").state == PluginState.STOPPED

    @pytest.mark.asyncio
    async def test_shutdown_uninitialized_is_noop(self):
        registry = PluginRegistry()
        registry.register(DummyPlugin())
        # Should not raise for REGISTERED state
        await registry.shutdown_plugin("dummy_plugin")


# ---------------------------------------------------------------------------
# Registry — query tests
# ---------------------------------------------------------------------------


class TestRegistryQuery:
    @pytest.fixture
    async def registry(self):
        r = PluginRegistry()
        r.register(DummyPlugin())
        r.register(VocabPlugin())
        await r.initialize_all()
        return r

    @pytest.mark.asyncio
    async def test_get(self, registry):
        plugin = registry.get("dummy_plugin")
        assert plugin is not None
        assert isinstance(plugin, DummyPlugin)

    @pytest.mark.asyncio
    async def test_get_nonexistent(self, registry):
        assert registry.get("nope") is None

    @pytest.mark.asyncio
    async def test_get_active(self, registry):
        plugin = registry.get_active("vocab_learning")
        assert plugin is not None
        assert isinstance(plugin, VocabPlugin)

    @pytest.mark.asyncio
    async def test_find_by_capability(self, registry):
        plugins = registry.find_by_capability("vocab")
        assert len(plugins) == 1
        assert isinstance(plugins[0], VocabPlugin)

    @pytest.mark.asyncio
    async def test_find_by_capability_empty(self, registry):
        assert registry.find_by_capability("nonexistent") == []

    @pytest.mark.asyncio
    async def test_list_plugins(self, registry):
        entries = registry.list_plugins()
        assert len(entries) == 2

    @pytest.mark.asyncio
    async def test_list_active(self, registry):
        active = registry.list_active()
        assert len(active) == 2

    @pytest.mark.asyncio
    async def test_list_names(self, registry):
        names = registry.list_names()
        assert set(names) == {"dummy_plugin", "vocab_learning"}

    @pytest.mark.asyncio
    async def test_summary(self, registry):
        s = registry.summary()
        assert s["total"] == 2
        assert s["by_state"]["active"] == 2
        assert "dummy_plugin" in s["plugins"]
        assert s["plugins"]["dummy_plugin"]["state"] == "active"


# ---------------------------------------------------------------------------
# Topological sort tests
# ---------------------------------------------------------------------------


class TestTopologicalSort:
    def test_no_deps(self):
        entries = {
            "a": PluginEntry(plugin=DummyPlugin()),
            "b": PluginEntry(plugin=VocabPlugin()),
        }
        # Monkey-patch manifests to have no deps (they already don't)
        order = _topological_sort(entries)
        assert set(order) == {"a", "b"}

    def test_linear_deps(self):
        """a -> b -> c"""

        class PluginB(BasePlugin):
            manifest = _make_manifest("bb", dependencies=["a"])
            async def initialize(self): ...
            async def execute(self, ctx): return PluginResult()
            async def shutdown(self): ...

        class PluginC(BasePlugin):
            manifest = _make_manifest("cc", dependencies=["bb"])
            async def initialize(self): ...
            async def execute(self, ctx): return PluginResult()
            async def shutdown(self): ...

        entries = {
            "a": PluginEntry(plugin=DummyPlugin()),
            "bb": PluginEntry(plugin=PluginB()),
            "cc": PluginEntry(plugin=PluginC()),
        }
        # Rename dummy manifest name for the dict key lookup
        entries["a"].plugin.manifest = _make_manifest("a")

        order = _topological_sort(entries)
        assert order.index("a") < order.index("bb")
        assert order.index("bb") < order.index("cc")

    def test_cycle_raises(self):
        class PluginA(BasePlugin):
            manifest = _make_manifest("aa", dependencies=["bb_cycle"])
            async def initialize(self): ...
            async def execute(self, ctx): return PluginResult()
            async def shutdown(self): ...

        class PluginB(BasePlugin):
            manifest = _make_manifest("bb_cycle", dependencies=["aa"])
            async def initialize(self): ...
            async def execute(self, ctx): return PluginResult()
            async def shutdown(self): ...

        entries = {
            "aa": PluginEntry(plugin=PluginA()),
            "bb_cycle": PluginEntry(plugin=PluginB()),
        }
        with pytest.raises(PluginDependencyError, match="circular"):
            _topological_sort(entries)


# ---------------------------------------------------------------------------
# Discovery tests (using the current module's classes)
# ---------------------------------------------------------------------------


class TestDiscovery:
    def test_discover_in_module(self):
        import tests.test_plugin_registry as this_module

        classes = discover_plugins_in_module(this_module)
        names = {cls.manifest.name for cls in classes}
        # Should find DummyPlugin, VocabPlugin, QuizPlugin, FailingPlugin
        assert "dummy_plugin" in names
        assert "vocab_learning" in names
        assert "quiz_plugin" in names
        assert "failing_plugin" in names
