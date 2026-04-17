"""Base plugin interface for service plugins.

Service plugins are self-contained modules that provide specific functionality
(e.g., vocabulary learning, daily quotes). Each plugin declares its capabilities
and configuration options via a manifest, and implements lifecycle methods for
integration with the platform.

Plugins are platform-agnostic — they produce structured content that the platform
routes through the appropriate delivery channels.
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Manifest schema — describes what a plugin provides
# ---------------------------------------------------------------------------


class ConfigOptionType(str, Enum):
    """Supported types for user-configurable plugin options."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    SELECT = "select"  # single choice from a list
    MULTI_SELECT = "multi_select"  # multiple choices from a list


class ConfigOption(BaseModel):
    """A single user-configurable option exposed by a plugin.

    This enables preference_granularity: users can fine-tune individual
    settings rather than simple on/off toggles.
    """

    key: str = Field(..., description="Unique key for this option within the plugin")
    label: str = Field(..., description="Human-readable label")
    description: str = Field(default="", description="Help text for the user")
    type: ConfigOptionType = Field(..., description="Data type of the option value")
    default: Any = Field(default=None, description="Default value if user doesn't set one")
    required: bool = Field(default=False, description="Whether the user must provide a value")
    choices: list[str] | None = Field(
        default=None,
        description="Available choices for select / multi_select types",
    )

    def validate_value(self, value: Any) -> bool:
        """Check whether *value* is acceptable for this option."""
        if value is None:
            return not self.required
        if self.type == ConfigOptionType.SELECT:
            return self.choices is not None and value in self.choices
        if self.type == ConfigOptionType.MULTI_SELECT:
            return (
                self.choices is not None
                and isinstance(value, list)
                and all(v in self.choices for v in value)
            )
        type_map = {
            ConfigOptionType.STRING: str,
            ConfigOptionType.INTEGER: int,
            ConfigOptionType.FLOAT: (int, float),
            ConfigOptionType.BOOLEAN: bool,
        }
        expected = type_map.get(self.type)
        return expected is not None and isinstance(value, expected)


class PluginManifest(BaseModel):
    """Declarative manifest that every plugin must expose.

    The manifest tells the platform what the plugin is called, what it can do,
    and which settings users can configure.  It is read at registration time so
    the platform can present options to users without loading the full plugin.
    """

    name: str = Field(..., description="Unique machine-readable plugin name (e.g. 'vocab_learning')")
    version: str = Field(..., description="Semantic version string (e.g. '0.1.0')")
    display_name: str = Field(default="", description="Human-friendly name shown to users")
    description: str = Field(default="", description="Short description of what the plugin does")
    capabilities: list[str] = Field(
        default_factory=list,
        description=(
            "List of capability tags the plugin supports "
            "(e.g. ['vocab', 'quiz', 'daily_word']). "
            "Used by the AI router to match inbound messages to plugins."
        ),
    )
    config_options: list[ConfigOption] = Field(
        default_factory=list,
        description="User-configurable options for this plugin",
    )
    dependencies: list[str] = Field(
        default_factory=list,
        description=(
            "Names of other plugins that must be loaded before this one "
            "(e.g. ['core_vocab'] for a quiz plugin that depends on vocabulary data)"
        ),
    )
    platform_version: str = Field(
        default=">=0.1.0",
        description="Semver constraint for the minimum platform version required",
    )

    def defaults(self) -> dict[str, Any]:
        """Return a dict of ``{key: default}`` for every config option."""
        return {opt.key: opt.default for opt in self.config_options}

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        """Validate a full user-config dict.  Returns a list of error messages (empty = valid)."""
        errors: list[str] = []
        options_by_key = {opt.key: opt for opt in self.config_options}
        for key, opt in options_by_key.items():
            value = config.get(key, opt.default)
            if not opt.validate_value(value):
                errors.append(
                    f"Invalid value for '{key}': {value!r} "
                    f"(expected {opt.type.value})"
                )
        # Warn about unknown keys
        known_keys = set(options_by_key)
        for key in config:
            if key not in known_keys:
                errors.append(f"Unknown config key: '{key}'")
        return errors


# ---------------------------------------------------------------------------
# Plugin execution context — passed into execute()
# ---------------------------------------------------------------------------


class PluginContext(BaseModel):
    """Runtime context supplied by the platform when executing a plugin."""

    user_id: str
    user_config: dict[str, Any] = Field(
        default_factory=dict,
        description="Merged user preferences (defaults + overrides)",
    )
    message: str = Field(
        default="",
        description="Inbound user message (empty for scheduled/outbound triggers)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Extra platform metadata (channel, locale, etc.)",
    )


class PluginResult(BaseModel):
    """Structured output returned by a plugin's execute() method.

    The platform uses this to route content to the correct delivery channel(s).
    Content is channel-agnostic — the delivery layer adapts formatting.
    """

    content: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured content payload (plugin-defined schema)",
    )
    text: str = Field(
        default="",
        description="Plain-text representation for simple channels",
    )
    error: str | None = Field(
        default=None,
        description="Error message if the plugin encountered a problem",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional metadata for the delivery layer",
    )

    @property
    def is_error(self) -> bool:
        return self.error is not None


# ---------------------------------------------------------------------------
# Base plugin class — the contract every plugin must implement
# ---------------------------------------------------------------------------


class BasePlugin(ABC):
    """Abstract base class that all service plugins must inherit from.

    Lifecycle:
        1. ``initialize()`` — called once when the plugin is loaded.
        2. ``execute(context)`` — called for each user interaction / trigger.
        3. ``shutdown()``  — called once when the plugin is unloaded.

    Subclasses **must** provide a ``manifest`` class-level attribute
    (a ``PluginManifest`` instance) so the platform can introspect
    capabilities without instantiating the plugin.
    """

    manifest: PluginManifest  # subclasses must set this

    @abstractmethod
    async def initialize(self) -> None:
        """Set up any resources the plugin needs (DB connections, caches, etc.).

        Called once by the platform after the plugin object is created.
        """
        ...

    @abstractmethod
    async def execute(self, context: PluginContext) -> PluginResult:
        """Handle an inbound message or scheduled trigger.

        Args:
            context: Runtime context including user config and message.

        Returns:
            A ``PluginResult`` containing the response content.
        """
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Release any resources held by the plugin.

        Called once when the platform is shutting down or unloading the plugin.
        """
        ...

    # -- convenience helpers (non-abstract) ----------------------------------

    def get_manifest(self) -> PluginManifest:
        """Return the plugin's manifest."""
        return self.manifest

    def merge_config(self, user_overrides: dict[str, Any]) -> dict[str, Any]:
        """Merge user overrides on top of manifest defaults."""
        merged = self.manifest.defaults()
        merged.update(user_overrides)
        return merged
