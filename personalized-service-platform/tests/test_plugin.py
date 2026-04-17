"""Tests for the base plugin interface and manifest schema."""

import pytest

from app.services.plugin import (
    BasePlugin,
    ConfigOption,
    ConfigOptionType,
    PluginContext,
    PluginManifest,
    PluginResult,
)


# ---------------------------------------------------------------------------
# Concrete test plugin (minimal implementation)
# ---------------------------------------------------------------------------


class _DummyPlugin(BasePlugin):
    """Minimal concrete plugin for testing the ABC contract."""

    manifest = PluginManifest(
        name="dummy",
        version="1.0.0",
        display_name="Dummy Plugin",
        description="A test plugin",
        capabilities=["test", "dummy"],
        config_options=[
            ConfigOption(
                key="difficulty",
                label="Difficulty",
                type=ConfigOptionType.SELECT,
                default="medium",
                choices=["easy", "medium", "hard"],
            ),
            ConfigOption(
                key="daily_count",
                label="Words per day",
                type=ConfigOptionType.INTEGER,
                default=5,
            ),
            ConfigOption(
                key="notifications",
                label="Enable notifications",
                type=ConfigOptionType.BOOLEAN,
                default=True,
            ),
        ],
    )

    def __init__(self) -> None:
        self._initialized = False
        self._shut_down = False

    async def initialize(self) -> None:
        self._initialized = True

    async def execute(self, context: PluginContext) -> PluginResult:
        merged = self.merge_config(context.user_config)
        return PluginResult(
            text=f"Hello {context.user_id}, difficulty={merged['difficulty']}",
            content={"merged_config": merged},
        )

    async def shutdown(self) -> None:
        self._shut_down = True


# ---------------------------------------------------------------------------
# PluginManifest tests
# ---------------------------------------------------------------------------


class TestPluginManifest:
    def test_minimal_manifest(self):
        m = PluginManifest(name="foo", version="0.1.0")
        assert m.name == "foo"
        assert m.version == "0.1.0"
        assert m.capabilities == []
        assert m.config_options == []

    def test_defaults(self):
        m = _DummyPlugin.manifest
        defaults = m.defaults()
        assert defaults == {"difficulty": "medium", "daily_count": 5, "notifications": True}

    def test_validate_config_valid(self):
        m = _DummyPlugin.manifest
        errors = m.validate_config({"difficulty": "hard", "daily_count": 10, "notifications": False})
        assert errors == []

    def test_validate_config_invalid_select(self):
        m = _DummyPlugin.manifest
        errors = m.validate_config({"difficulty": "nightmare"})
        assert any("difficulty" in e for e in errors)

    def test_validate_config_invalid_type(self):
        m = _DummyPlugin.manifest
        errors = m.validate_config({"daily_count": "not_a_number"})
        assert any("daily_count" in e for e in errors)

    def test_validate_config_unknown_key(self):
        m = _DummyPlugin.manifest
        errors = m.validate_config({"unknown_key": 42})
        assert any("Unknown" in e for e in errors)

    def test_validate_config_uses_defaults_for_missing(self):
        """Missing keys fall back to defaults and should be valid."""
        m = _DummyPlugin.manifest
        errors = m.validate_config({})
        assert errors == []


# ---------------------------------------------------------------------------
# ConfigOption.validate_value tests
# ---------------------------------------------------------------------------


class TestConfigOption:
    def test_string_option(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.STRING)
        assert opt.validate_value("hello") is True
        assert opt.validate_value(123) is False

    def test_integer_option(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.INTEGER)
        assert opt.validate_value(10) is True
        assert opt.validate_value("10") is False

    def test_float_option(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.FLOAT)
        assert opt.validate_value(1.5) is True
        assert opt.validate_value(1) is True  # int is acceptable for float
        assert opt.validate_value("1.5") is False

    def test_boolean_option(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.BOOLEAN)
        assert opt.validate_value(True) is True
        assert opt.validate_value(0) is False

    def test_select_option(self):
        opt = ConfigOption(
            key="x", label="X", type=ConfigOptionType.SELECT, choices=["a", "b"]
        )
        assert opt.validate_value("a") is True
        assert opt.validate_value("c") is False

    def test_multi_select_option(self):
        opt = ConfigOption(
            key="x", label="X", type=ConfigOptionType.MULTI_SELECT, choices=["a", "b", "c"]
        )
        assert opt.validate_value(["a", "c"]) is True
        assert opt.validate_value(["a", "z"]) is False
        assert opt.validate_value("a") is False  # must be a list

    def test_required_none(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.STRING, required=True)
        assert opt.validate_value(None) is False

    def test_optional_none(self):
        opt = ConfigOption(key="x", label="X", type=ConfigOptionType.STRING, required=False)
        assert opt.validate_value(None) is True


# ---------------------------------------------------------------------------
# BasePlugin lifecycle tests
# ---------------------------------------------------------------------------


class TestBasePluginLifecycle:
    @pytest.fixture
    def plugin(self):
        return _DummyPlugin()

    @pytest.mark.asyncio
    async def test_initialize(self, plugin):
        assert not plugin._initialized
        await plugin.initialize()
        assert plugin._initialized

    @pytest.mark.asyncio
    async def test_execute(self, plugin):
        ctx = PluginContext(
            user_id="user-1",
            user_config={"difficulty": "hard"},
            message="hello",
        )
        result = await plugin.execute(ctx)
        assert "hard" in result.text
        assert result.content["merged_config"]["difficulty"] == "hard"
        # defaults are filled in
        assert result.content["merged_config"]["daily_count"] == 5

    @pytest.mark.asyncio
    async def test_shutdown(self, plugin):
        assert not plugin._shut_down
        await plugin.shutdown()
        assert plugin._shut_down

    def test_get_manifest(self, plugin):
        m = plugin.get_manifest()
        assert m.name == "dummy"
        assert m.version == "1.0.0"

    def test_merge_config(self, plugin):
        merged = plugin.merge_config({"difficulty": "easy"})
        assert merged["difficulty"] == "easy"
        assert merged["daily_count"] == 5
        assert merged["notifications"] is True


# ---------------------------------------------------------------------------
# PluginResult tests
# ---------------------------------------------------------------------------


class TestPluginResult:
    def test_is_error_false(self):
        r = PluginResult(text="ok")
        assert not r.is_error

    def test_is_error_true(self):
        r = PluginResult(error="something went wrong")
        assert r.is_error


# ---------------------------------------------------------------------------
# ABC enforcement tests
# ---------------------------------------------------------------------------


class TestABCEnforcement:
    def test_cannot_instantiate_base(self):
        with pytest.raises(TypeError):
            BasePlugin()  # type: ignore[abstract]

    def test_incomplete_subclass(self):
        class _Incomplete(BasePlugin):
            manifest = PluginManifest(name="inc", version="0.0.1")

            async def initialize(self) -> None: ...
            # missing execute and shutdown

        with pytest.raises(TypeError):
            _Incomplete()  # type: ignore[abstract]
