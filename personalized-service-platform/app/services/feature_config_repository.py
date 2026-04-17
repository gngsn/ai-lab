"""Feature configuration repository — typed CRUD for per-feature settings.

This module provides a storage layer that operates at the FeatureConfiguration
level rather than raw key-value pairs.  It wraps the underlying
PreferencesRepository and handles serialization/deserialization, schema
validation, default merging, and partial updates.

Design principles:
- **Preference granularity**: Each feature has structured, validated settings
  (not simple on/off toggles).
- **Plugin isolation**: The repository validates against FeatureConfigSchema
  but doesn't depend on plugin internals.
- **Storage-agnostic**: Delegates all persistence to the PreferencesRepository
  protocol (works with both SQLAlchemy and Supabase backends).

Usage::

    repo = FeatureConfigRepository(preferences_repo)
    config = await repo.get(user_id, "vocab_learning")
    await repo.set(user_id, "vocab_learning", config)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.models.feature_config import (
    FeatureConfigSchema,
    FeatureConfiguration,
    validate_feature_config,
)
from app.services.preferences_repository_protocol import (
    PreferencesRepository,
    PreferenceValue,
)

logger = logging.getLogger(__name__)

# Storage key prefix — feature configs are stored as
# "feature_config.<feature_name>" in the preference store.
_FEATURE_CONFIG_PREFIX = "feature_config."


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------


@dataclass
class FeatureConfigRecord:
    """Result of a feature config CRUD operation."""

    user_id: str
    feature_name: str
    config: FeatureConfiguration
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)


@dataclass
class FeatureConfigListResult:
    """Result of listing all feature configs for a user."""

    user_id: str
    configs: dict[str, FeatureConfiguration] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Protocol — abstract interface for feature config persistence
# ---------------------------------------------------------------------------


@runtime_checkable
class FeatureConfigRepositoryProtocol(Protocol):
    """Contract for feature configuration persistence."""

    async def get(
        self,
        user_id: str,
        feature_name: str,
    ) -> FeatureConfiguration | None:
        """Get the configuration for a specific feature, or None if not set."""
        ...

    async def get_or_default(
        self,
        user_id: str,
        feature_name: str,
        schema: FeatureConfigSchema | None = None,
    ) -> FeatureConfiguration:
        """Get the configuration or return defaults from the schema."""
        ...

    async def get_all(
        self,
        user_id: str,
    ) -> dict[str, FeatureConfiguration]:
        """Get all feature configurations for a user."""
        ...

    async def set(
        self,
        user_id: str,
        feature_name: str,
        config: FeatureConfiguration,
    ) -> FeatureConfigRecord:
        """Persist a full feature configuration (overwrite)."""
        ...

    async def update(
        self,
        user_id: str,
        feature_name: str,
        overrides: dict[str, Any],
    ) -> FeatureConfigRecord:
        """Partially update a feature configuration (merge semantics)."""
        ...

    async def delete(
        self,
        user_id: str,
        feature_name: str,
    ) -> bool:
        """Delete a feature configuration. Returns True if removed."""
        ...

    async def delete_all(
        self,
        user_id: str,
    ) -> int:
        """Delete all feature configurations for a user. Returns count."""
        ...


# ---------------------------------------------------------------------------
# Implementation — delegates to PreferencesRepository
# ---------------------------------------------------------------------------


class FeatureConfigRepository:
    """Feature configuration repository backed by the preference store.

    Stores each feature's FeatureConfiguration as a serialised dict
    under the key ``feature_config.<feature_name>`` in the preference store.

    Parameters
    ----------
    preferences_repo:
        The underlying key-value preferences repository.
    schemas:
        Optional mapping of feature_name -> FeatureConfigSchema for
        validation. If provided, ``set`` and ``update`` will validate
        configs against the schema before persisting.
    """

    def __init__(
        self,
        preferences_repo: PreferencesRepository,
        schemas: dict[str, FeatureConfigSchema] | None = None,
    ) -> None:
        self._repo = preferences_repo
        self._schemas: dict[str, FeatureConfigSchema] = schemas or {}

    # -- Schema management ---------------------------------------------------

    def register_schema(self, schema: FeatureConfigSchema) -> None:
        """Register a feature config schema for validation."""
        self._schemas[schema.feature_name] = schema
        logger.info("Registered config schema for feature '%s'", schema.feature_name)

    def unregister_schema(self, feature_name: str) -> FeatureConfigSchema | None:
        """Remove a schema. Returns the removed schema or None."""
        return self._schemas.pop(feature_name, None)

    def get_schema(self, feature_name: str) -> FeatureConfigSchema | None:
        """Get the registered schema for a feature, if any."""
        return self._schemas.get(feature_name)

    def list_schemas(self) -> dict[str, FeatureConfigSchema]:
        """Return all registered schemas."""
        return dict(self._schemas)

    # -- Read ---------------------------------------------------------------

    async def get(
        self,
        user_id: str,
        feature_name: str,
    ) -> FeatureConfiguration | None:
        """Get the configuration for a specific feature.

        Returns None if no configuration has been saved for this feature.
        """
        key = f"{_FEATURE_CONFIG_PREFIX}{feature_name}"
        record = await self._repo.get(user_id, key)
        if record is None:
            return None
        return self._deserialize(record.preference_value)

    async def get_or_default(
        self,
        user_id: str,
        feature_name: str,
        schema: FeatureConfigSchema | None = None,
    ) -> FeatureConfiguration:
        """Get the configuration, falling back to schema defaults.

        If the user has saved a config, it is returned. Otherwise:
        - If a schema is provided (or registered), defaults from the schema
          are used to build a default FeatureConfiguration.
        - If no schema is available, a bare FeatureConfiguration() is returned.
        """
        existing = await self.get(user_id, feature_name)
        if existing is not None:
            return existing

        schema = schema or self._schemas.get(feature_name)
        if schema is not None:
            defaults = schema.defaults()
            return FeatureConfiguration(custom_settings=defaults)

        return FeatureConfiguration()

    async def get_all(
        self,
        user_id: str,
    ) -> dict[str, FeatureConfiguration]:
        """Get all feature configurations for a user.

        Returns a mapping of feature_name -> FeatureConfiguration.
        """
        records = await self._repo.get_all(user_id, prefix=_FEATURE_CONFIG_PREFIX)
        result: dict[str, FeatureConfiguration] = {}
        for record in records:
            feature_name = record.preference_key[len(_FEATURE_CONFIG_PREFIX):]
            config = self._deserialize(record.preference_value)
            if config is not None:
                result[feature_name] = config
        return result

    # -- Write (create/overwrite) -------------------------------------------

    async def set(
        self,
        user_id: str,
        feature_name: str,
        config: FeatureConfiguration,
    ) -> FeatureConfigRecord:
        """Persist a full feature configuration.

        If a schema is registered for this feature, the config is validated
        before saving. Validation errors are included in the record but
        do NOT prevent saving (caller decides whether to reject).
        """
        validation_errors, validation_warnings = self._validate(feature_name, config)

        key = f"{_FEATURE_CONFIG_PREFIX}{feature_name}"
        serialized = config.to_flat_dict()
        await self._repo.set(user_id, key, serialized)

        logger.info(
            "Saved feature config for user=%s feature=%s (errors=%d)",
            user_id, feature_name, len(validation_errors),
        )
        return FeatureConfigRecord(
            user_id=user_id,
            feature_name=feature_name,
            config=config,
            validation_errors=validation_errors,
            validation_warnings=validation_warnings,
        )

    async def set_validated(
        self,
        user_id: str,
        feature_name: str,
        config: FeatureConfiguration,
    ) -> FeatureConfigRecord:
        """Persist a feature configuration only if it passes validation.

        Raises ValueError if the schema validation fails.
        """
        validation_errors, validation_warnings = self._validate(feature_name, config)
        if validation_errors:
            raise ValueError(
                f"Feature config validation failed for '{feature_name}': "
                + "; ".join(validation_errors)
            )
        return await self.set(user_id, feature_name, config)

    # -- Update (partial / merge) -------------------------------------------

    async def update(
        self,
        user_id: str,
        feature_name: str,
        overrides: dict[str, Any],
    ) -> FeatureConfigRecord:
        """Partially update a feature configuration.

        Merges *overrides* into the existing config (or a default config
        if none exists). Deep-merge semantics: nested dicts are merged
        recursively, not replaced.
        """
        existing = await self.get_or_default(user_id, feature_name)
        updated = existing.merge_with(overrides)

        return await self.set(user_id, feature_name, updated)

    async def update_custom_setting(
        self,
        user_id: str,
        feature_name: str,
        setting_key: str,
        setting_value: Any,
    ) -> FeatureConfigRecord:
        """Update a single custom setting within a feature config.

        Convenience method for updating individual settings without
        touching the rest of the configuration.
        """
        return await self.update(
            user_id,
            feature_name,
            {"custom_settings": {setting_key: setting_value}},
        )

    # -- Delete -------------------------------------------------------------

    async def delete(
        self,
        user_id: str,
        feature_name: str,
    ) -> bool:
        """Delete a feature configuration.

        Returns True if a configuration was removed, False if nothing existed.
        """
        key = f"{_FEATURE_CONFIG_PREFIX}{feature_name}"
        deleted = await self._repo.delete(user_id, key)
        if deleted:
            logger.info("Deleted feature config for user=%s feature=%s", user_id, feature_name)
        return deleted

    async def delete_all(
        self,
        user_id: str,
    ) -> int:
        """Delete all feature configurations for a user.

        Returns the number of deleted configurations.
        """
        all_configs = await self._repo.get_all(user_id, prefix=_FEATURE_CONFIG_PREFIX)
        count = 0
        for record in all_configs:
            feature_name = record.preference_key[len(_FEATURE_CONFIG_PREFIX):]
            if await self.delete(user_id, feature_name):
                count += 1
        return count

    # -- Validation ---------------------------------------------------------

    def validate(
        self,
        feature_name: str,
        config: FeatureConfiguration,
    ) -> tuple[list[str], list[str]]:
        """Validate a config against the registered schema.

        Returns (errors, warnings). Both are empty if valid or no schema.
        """
        return self._validate(feature_name, config)

    # -- Internal helpers ---------------------------------------------------

    def _validate(
        self,
        feature_name: str,
        config: FeatureConfiguration,
    ) -> tuple[list[str], list[str]]:
        """Validate config against schema. Returns (errors, warnings)."""
        schema = self._schemas.get(feature_name)
        if schema is None:
            return [], []

        errors = validate_feature_config(schema, config)
        # Also validate custom_settings against schema options
        if config.custom_settings:
            setting_errors = schema.validate_settings(config.custom_settings)
            errors.extend(setting_errors)

        # Separate warnings (unknown keys) from hard errors
        warnings: list[str] = []
        hard_errors: list[str] = []
        for err in errors:
            if "Unknown setting" in err:
                warnings.append(err)
            else:
                hard_errors.append(err)

        return hard_errors, warnings

    @staticmethod
    def _deserialize(value: Any) -> FeatureConfiguration | None:
        """Deserialize a preference value into a FeatureConfiguration."""
        if value is None:
            return None
        if isinstance(value, dict):
            try:
                return FeatureConfiguration.from_flat_dict(value)
            except Exception:
                logger.warning("Failed to deserialize feature config: %s", value)
                return None
        return None


# ---------------------------------------------------------------------------
# Module-level schema registry — populated at app startup
# ---------------------------------------------------------------------------

_schema_registry: dict[str, FeatureConfigSchema] = {}


def register_global_schema(schema: FeatureConfigSchema) -> None:
    """Register a FeatureConfigSchema in the global registry.

    Schemas registered here are automatically applied to
    FeatureConfigRepository instances created via the FastAPI dependency.
    """
    _schema_registry[schema.feature_name] = schema
    logger.info("Globally registered config schema for '%s'", schema.feature_name)


def get_schema_registry() -> dict[str, FeatureConfigSchema]:
    """Return the global schema registry (read-only copy)."""
    return dict(_schema_registry)


def reset_schema_registry() -> None:
    """Clear the global schema registry (useful for testing)."""
    _schema_registry.clear()
