"""Feature & Channel Registry — unified source of truth for available features and channels.

This module provides:
1. A registry of **available features** derived from registered plugins.
2. A registry of **supported channels** derived from registered delivery channels.
3. **Validation** that user preference selections reference only valid features/channels.

Design principles:
- Single source of truth: features come from plugin manifests, channels from the
  delivery channel registry — no separate static configuration to keep in sync.
- Validation returns structured errors (not exceptions) so callers can present
  user-friendly feedback.
- Feature entries carry their configurable option schemas so UIs can render
  settings forms dynamically.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Feature descriptor — what a single feature looks like to consumers
# ---------------------------------------------------------------------------


class FeatureConfigOption(BaseModel):
    """Schema for a single user-configurable option within a feature."""

    key: str
    label: str
    description: str = ""
    type: str  # "string", "integer", "float", "boolean", "select", "multi_select"
    default: Any = None
    required: bool = False
    choices: list[str] | None = None


class FeatureDescriptor(BaseModel):
    """Public description of an available feature.

    Built from a plugin's manifest but decoupled from the plugin internals
    so it can be serialised over API responses.
    """

    name: str = Field(..., description="Unique feature identifier (matches plugin name)")
    display_name: str = Field(default="", description="Human-friendly label")
    description: str = Field(default="", description="Short description")
    capabilities: list[str] = Field(default_factory=list)
    config_options: list[FeatureConfigOption] = Field(
        default_factory=list,
        description="User-configurable settings for this feature",
    )
    version: str = ""
    enabled_by_default: bool = False


# ---------------------------------------------------------------------------
# Channel descriptor — what a supported channel looks like to consumers
# ---------------------------------------------------------------------------


class ChannelDescriptor(BaseModel):
    """Public description of a supported delivery channel."""

    name: str = Field(..., description="Unique channel identifier (e.g. 'telegram', 'email')")
    channel_type: str = Field(default="", description="Channel category (e.g. 'chat', 'email', 'push')")
    supports_rich_content: bool = True
    supports_buttons: bool = False
    supports_images: bool = False
    supports_files: bool = False
    max_message_length: int | None = None


# ---------------------------------------------------------------------------
# Validation result
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    """Outcome of validating a user's feature/channel selections."""

    valid: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
        self.valid = False

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def merge(self, other: ValidationResult) -> None:
        """Merge another result into this one."""
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        if not other.valid:
            self.valid = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Feature & Channel Registry
# ---------------------------------------------------------------------------


class FeatureChannelRegistry:
    """Unified registry of available features and supported channels.

    Features and channels can be registered explicitly or populated from
    the plugin registry / delivery channel registry at startup.

    Usage::

        registry = FeatureChannelRegistry()

        # Register features (typically from plugin manifests)
        registry.register_feature(FeatureDescriptor(name="vocab_learning", ...))

        # Register channels (typically from delivery channel info)
        registry.register_channel(ChannelDescriptor(name="telegram", ...))

        # Validate user selections
        result = registry.validate_preferences(
            selected_features=["vocab_learning"],
            channels=["telegram"],
            feature_settings={"vocab_learning": {"difficulty_level": "hard"}},
        )
        assert result.valid
    """

    def __init__(self) -> None:
        self._features: dict[str, FeatureDescriptor] = {}
        self._channels: dict[str, ChannelDescriptor] = {}

    # -- Feature registration -----------------------------------------------

    def register_feature(self, feature: FeatureDescriptor) -> None:
        """Register a feature descriptor."""
        if feature.name in self._features:
            logger.warning(
                "Replacing existing feature '%s' in registry", feature.name
            )
        self._features[feature.name] = feature
        logger.info(
            "Registered feature '%s' (%s)", feature.name, feature.display_name or feature.name
        )

    def unregister_feature(self, name: str) -> FeatureDescriptor | None:
        """Remove a feature. Returns the removed descriptor or None."""
        return self._features.pop(name, None)

    def register_feature_from_plugin_manifest(self, manifest: Any) -> FeatureDescriptor:
        """Build and register a FeatureDescriptor from a PluginManifest.

        Parameters
        ----------
        manifest:
            A ``PluginManifest`` instance (imported type kept as ``Any`` to
            avoid circular imports).
        """
        config_options = [
            FeatureConfigOption(
                key=opt.key,
                label=opt.label,
                description=opt.description,
                type=opt.type.value if hasattr(opt.type, "value") else str(opt.type),
                default=opt.default,
                required=opt.required,
                choices=opt.choices,
            )
            for opt in manifest.config_options
        ]
        descriptor = FeatureDescriptor(
            name=manifest.name,
            display_name=manifest.display_name,
            description=manifest.description,
            capabilities=list(manifest.capabilities),
            config_options=config_options,
            version=manifest.version,
        )
        self.register_feature(descriptor)
        return descriptor

    # -- Channel registration -----------------------------------------------

    def register_channel(self, channel: ChannelDescriptor) -> None:
        """Register a channel descriptor."""
        if channel.name in self._channels:
            logger.warning(
                "Replacing existing channel '%s' in registry", channel.name
            )
        self._channels[channel.name] = channel
        logger.info("Registered channel '%s' (type=%s)", channel.name, channel.channel_type)

    def unregister_channel(self, name: str) -> ChannelDescriptor | None:
        """Remove a channel. Returns the removed descriptor or None."""
        return self._channels.pop(name, None)

    def register_channel_from_info(self, name: str, info: Any) -> ChannelDescriptor:
        """Build and register a ChannelDescriptor from a ChannelInfo dataclass.

        Parameters
        ----------
        name:
            The channel's registration name.
        info:
            A ``ChannelInfo`` dataclass instance.
        """
        descriptor = ChannelDescriptor(
            name=name,
            channel_type=info.channel_type,
            supports_rich_content=info.supports_rich_content,
            supports_buttons=info.supports_buttons,
            supports_images=info.supports_images,
            supports_files=info.supports_files,
            max_message_length=info.max_message_length,
        )
        self.register_channel(descriptor)
        return descriptor

    # -- Querying -----------------------------------------------------------

    def get_feature(self, name: str) -> FeatureDescriptor | None:
        """Return a feature descriptor by name, or None."""
        return self._features.get(name)

    def get_channel(self, name: str) -> ChannelDescriptor | None:
        """Return a channel descriptor by name, or None."""
        return self._channels.get(name)

    def list_features(self) -> list[FeatureDescriptor]:
        """Return all registered features (sorted by name)."""
        return sorted(self._features.values(), key=lambda f: f.name)

    def list_channels(self) -> list[ChannelDescriptor]:
        """Return all registered channels (sorted by name)."""
        return sorted(self._channels.values(), key=lambda c: c.name)

    def list_feature_names(self) -> list[str]:
        """Return sorted list of registered feature names."""
        return sorted(self._features.keys())

    def list_channel_names(self) -> list[str]:
        """Return sorted list of registered channel names."""
        return sorted(self._channels.keys())

    def has_feature(self, name: str) -> bool:
        return name in self._features

    def has_channel(self, name: str) -> bool:
        return name in self._channels

    @property
    def feature_count(self) -> int:
        return len(self._features)

    @property
    def channel_count(self) -> int:
        return len(self._channels)

    # -- Validation ---------------------------------------------------------

    def validate_selected_features(self, selected: list[str]) -> ValidationResult:
        """Validate that all selected feature names reference registered features."""
        result = ValidationResult()
        for name in selected:
            if not self.has_feature(name):
                result.add_error(
                    f"Unknown feature '{name}'. "
                    f"Available features: {', '.join(self.list_feature_names()) or '(none)'}"
                )
        return result

    def validate_selected_channels(self, selected: list[str]) -> ValidationResult:
        """Validate that all selected channel names reference registered channels."""
        result = ValidationResult()
        for name in selected:
            if not self.has_channel(name):
                result.add_error(
                    f"Unknown channel '{name}'. "
                    f"Available channels: {', '.join(self.list_channel_names()) or '(none)'}"
                )
        return result

    def validate_feature_settings(
        self,
        feature_name: str,
        settings: dict[str, Any],
    ) -> ValidationResult:
        """Validate settings for a specific feature against its config schema.

        Checks:
        - Feature exists
        - Setting keys are recognized
        - Setting values match declared types and choices
        """
        result = ValidationResult()
        feature = self.get_feature(feature_name)
        if feature is None:
            result.add_error(f"Cannot validate settings for unknown feature '{feature_name}'")
            return result

        options_by_key = {opt.key: opt for opt in feature.config_options}

        # Check for unknown setting keys
        for key in settings:
            if key not in options_by_key:
                result.add_warning(
                    f"Unknown setting '{key}' for feature '{feature_name}'. "
                    f"Known settings: {', '.join(options_by_key.keys()) or '(none)'}"
                )

        # Validate values against schema
        for key, opt in options_by_key.items():
            if key not in settings:
                continue  # not provided — will use default
            value = settings[key]
            if not self._validate_option_value(opt, value):
                result.add_error(
                    f"Invalid value for '{feature_name}.{key}': {value!r} "
                    f"(expected type={opt.type}"
                    + (f", choices={opt.choices}" if opt.choices else "")
                    + ")"
                )

        return result

    def validate_preferences(
        self,
        selected_features: list[str] | None = None,
        channels: list[str] | None = None,
        feature_settings: dict[str, dict[str, Any]] | None = None,
    ) -> ValidationResult:
        """Validate a full set of user preference selections.

        Parameters
        ----------
        selected_features:
            Features the user wants to enable.
        channels:
            Delivery channels the user wants to use.
        feature_settings:
            Per-feature configuration dicts (feature_name → settings).

        Returns
        -------
        A ``ValidationResult`` with all errors and warnings.
        """
        result = ValidationResult()

        if selected_features is not None:
            result.merge(self.validate_selected_features(selected_features))

        if channels is not None:
            result.merge(self.validate_selected_channels(channels))

        if feature_settings is not None:
            for feature_name, settings in feature_settings.items():
                result.merge(self.validate_feature_settings(feature_name, settings))

        return result

    # -- Summary ------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of the registry."""
        return {
            "features": [f.model_dump() for f in self.list_features()],
            "channels": [c.model_dump() for c in self.list_channels()],
            "feature_count": self.feature_count,
            "channel_count": self.channel_count,
        }

    # -- Internal helpers ---------------------------------------------------

    @staticmethod
    def _validate_option_value(opt: FeatureConfigOption, value: Any) -> bool:
        """Check whether *value* is acceptable for the given config option."""
        if value is None:
            return not opt.required

        if opt.type == "select":
            return opt.choices is not None and value in opt.choices
        if opt.type == "multi_select":
            return (
                opt.choices is not None
                and isinstance(value, list)
                and all(v in opt.choices for v in value)
            )

        type_map: dict[str, type | tuple[type, ...]] = {
            "string": str,
            "integer": int,
            "float": (int, float),
            "boolean": bool,
        }
        expected = type_map.get(opt.type)
        if expected is None:
            return True  # unknown type — pass through
        return isinstance(value, expected)


# ---------------------------------------------------------------------------
# Module-level singleton (populated at app startup)
# ---------------------------------------------------------------------------

_registry: FeatureChannelRegistry | None = None


def get_feature_channel_registry() -> FeatureChannelRegistry:
    """Return the module-level singleton, creating it if needed."""
    global _registry
    if _registry is None:
        _registry = FeatureChannelRegistry()
    return _registry


def set_feature_channel_registry(registry: FeatureChannelRegistry) -> None:
    """Replace the module-level singleton (useful for testing)."""
    global _registry
    _registry = registry


def reset_feature_channel_registry() -> None:
    """Reset the singleton to None (useful for testing)."""
    global _registry
    _registry = None
