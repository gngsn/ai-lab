"""Feature configuration data models with per-feature settings.

This module defines the typed data model for user-configurable feature settings
including frequency, schedule, and difficulty. Each setting type has proper
validation rules and constraints.

Design principles:
- Per-feature settings are NOT simple on/off toggles — they carry structured
  configuration with typed fields and validation constraints.
- Common setting patterns (schedule, frequency, difficulty) are reusable across
  plugins via typed Pydantic models.
- Validation rules are declarative and composable — plugins declare constraints,
  the platform enforces them.
- Settings are serializable to/from JSON for storage in the flat key-value store.
"""

from __future__ import annotations

import re
from datetime import time
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums for typed setting values
# ---------------------------------------------------------------------------


class DifficultyLevel(str, Enum):
    """Standard difficulty levels usable across plugins."""

    BEGINNER = "beginner"
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EXPERT = "expert"


class FrequencyUnit(str, Enum):
    """Time units for frequency-based settings."""

    MINUTES = "minutes"
    HOURS = "hours"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class DayOfWeek(str, Enum):
    """Days of the week for schedule configuration."""

    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


# ---------------------------------------------------------------------------
# Reusable setting models — common patterns for plugin configuration
# ---------------------------------------------------------------------------


class FrequencyConfig(BaseModel):
    """How often content should be delivered.

    Examples:
        - 3 times daily: FrequencyConfig(value=3, unit="daily")
        - Every 4 hours: FrequencyConfig(value=4, unit="hours")
        - 2 times weekly: FrequencyConfig(value=2, unit="weekly")
    """

    value: Annotated[int, Field(ge=1, le=100, description="Frequency count")]
    unit: FrequencyUnit = Field(
        default=FrequencyUnit.DAILY,
        description="Time unit for frequency",
    )
    max_per_day: Annotated[int | None, Field(
        ge=1, le=50, default=None,
        description="Optional cap on deliveries per day",
    )] = None

    @model_validator(mode="after")
    def validate_frequency_coherence(self) -> FrequencyConfig:
        """Ensure frequency makes sense (e.g., hourly value <= 24)."""
        if self.unit == FrequencyUnit.HOURS and self.value > 24:
            raise ValueError("Hourly frequency cannot exceed 24")
        if self.unit == FrequencyUnit.MINUTES and self.value > 1440:
            raise ValueError("Minute-based frequency cannot exceed 1440 (24h)")
        if self.unit == FrequencyUnit.WEEKLY and self.value > 7:
            raise ValueError("Weekly frequency cannot exceed 7 (once per day)")
        if self.unit == FrequencyUnit.MONTHLY and self.value > 31:
            raise ValueError("Monthly frequency cannot exceed 31")
        return self


class TimeWindow(BaseModel):
    """A time window during which content can be delivered."""

    start: str = Field(
        default="09:00",
        description="Start time in HH:MM format",
    )
    end: str = Field(
        default="21:00",
        description="End time in HH:MM format",
    )

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        """Validate HH:MM format."""
        if not re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", v):
            raise ValueError(
                f"Invalid time format '{v}'. Expected HH:MM (24-hour format)"
            )
        return v

    @model_validator(mode="after")
    def validate_window(self) -> TimeWindow:
        """Ensure start is before end."""
        start_parts = self.start.split(":")
        end_parts = self.end.split(":")
        start_minutes = int(start_parts[0]) * 60 + int(start_parts[1])
        end_minutes = int(end_parts[0]) * 60 + int(end_parts[1])
        if start_minutes >= end_minutes:
            raise ValueError(
                f"Start time ({self.start}) must be before end time ({self.end})"
            )
        return self


class ScheduleConfig(BaseModel):
    """When content should be delivered.

    Supports:
    - Specific days of the week
    - Time windows (delivery hours)
    - Specific preferred times
    - Timezone awareness
    """

    active_days: list[DayOfWeek] = Field(
        default_factory=lambda: list(DayOfWeek),
        description="Days of the week when delivery is active",
    )
    time_windows: list[TimeWindow] = Field(
        default_factory=lambda: [TimeWindow()],
        description="Time windows during which content can be delivered",
    )
    preferred_times: list[str] = Field(
        default_factory=list,
        description="Specific preferred delivery times in HH:MM format",
    )
    timezone: str = Field(
        default="UTC",
        description="User's timezone (IANA format, e.g. 'America/New_York')",
    )

    @field_validator("preferred_times")
    @classmethod
    def validate_preferred_times(cls, v: list[str]) -> list[str]:
        """Validate all preferred times are in HH:MM format."""
        for t in v:
            if not re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", t):
                raise ValueError(
                    f"Invalid preferred time '{t}'. Expected HH:MM (24-hour format)"
                )
        return v

    @field_validator("active_days")
    @classmethod
    def validate_active_days_not_empty(cls, v: list[DayOfWeek]) -> list[DayOfWeek]:
        """At least one active day is required."""
        if not v:
            raise ValueError("At least one active day must be specified")
        return v

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        """Basic timezone validation (IANA-style format)."""
        if not v:
            raise ValueError("Timezone must not be empty")
        # Allow common formats: UTC, America/New_York, Asia/Seoul, etc.
        if not re.match(r"^[A-Z][a-zA-Z0-9_]+(/[A-Za-z0-9_]+)*$", v):
            raise ValueError(
                f"Invalid timezone format '{v}'. "
                "Expected IANA timezone (e.g. 'UTC', 'America/New_York')"
            )
        return v


class DifficultyConfig(BaseModel):
    """Difficulty settings for learning-oriented features.

    Supports both fixed levels and adaptive difficulty.
    """

    level: DifficultyLevel = Field(
        default=DifficultyLevel.MEDIUM,
        description="Current difficulty level",
    )
    adaptive: bool = Field(
        default=False,
        description="Whether difficulty adjusts automatically based on performance",
    )
    min_level: DifficultyLevel = Field(
        default=DifficultyLevel.BEGINNER,
        description="Minimum difficulty level (for adaptive mode)",
    )
    max_level: DifficultyLevel = Field(
        default=DifficultyLevel.EXPERT,
        description="Maximum difficulty level (for adaptive mode)",
    )
    progression_threshold: Annotated[float, Field(
        ge=0.0, le=1.0, default=0.8,
        description="Accuracy threshold to increase difficulty (0.0-1.0)",
    )] = 0.8

    @model_validator(mode="after")
    def validate_level_range(self) -> DifficultyConfig:
        """Ensure min <= level <= max when adaptive mode is on."""
        levels_order = list(DifficultyLevel)
        min_idx = levels_order.index(self.min_level)
        max_idx = levels_order.index(self.max_level)
        level_idx = levels_order.index(self.level)
        if min_idx > max_idx:
            raise ValueError(
                f"min_level ({self.min_level.value}) cannot be higher "
                f"than max_level ({self.max_level.value})"
            )
        if self.adaptive and (level_idx < min_idx or level_idx > max_idx):
            raise ValueError(
                f"Current level ({self.level.value}) must be between "
                f"min_level ({self.min_level.value}) and max_level ({self.max_level.value}) "
                f"when adaptive mode is enabled"
            )
        return self


# ---------------------------------------------------------------------------
# Feature configuration schema — full per-feature settings
# ---------------------------------------------------------------------------


class FeatureConfiguration(BaseModel):
    """Complete per-feature configuration with typed settings.

    This replaces the untyped ``FeatureSettingsDTO.settings: dict[str, Any]``
    with a structured model that includes validation. It can be used:

    1. As a **full schema** for features that use all standard settings.
    2. As a **base class** for feature-specific configurations.
    3. As a **validation reference** — the platform validates user settings
       against this schema before persisting.

    All fields are optional so features can use only what they need.
    """

    enabled: bool = Field(
        default=True,
        description="Whether this feature is active for the user",
    )
    frequency: FrequencyConfig | None = Field(
        default=None,
        description="How often content is delivered",
    )
    schedule: ScheduleConfig | None = Field(
        default=None,
        description="When content is delivered",
    )
    difficulty: DifficultyConfig | None = Field(
        default=None,
        description="Difficulty settings for learning features",
    )
    custom_settings: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Plugin-specific settings that don't fit the standard fields. "
            "Validated by the plugin's own config schema."
        ),
    )

    def to_flat_dict(self) -> dict[str, Any]:
        """Serialize to a flat dictionary suitable for storage.

        Nested models are serialized as dicts so they can be stored
        in the JSON preference_value column.
        """
        data = self.model_dump(exclude_none=True)
        return data

    @classmethod
    def from_flat_dict(cls, data: dict[str, Any]) -> FeatureConfiguration:
        """Reconstruct from a flat dictionary (e.g., from storage)."""
        return cls.model_validate(data)

    def merge_with(self, overrides: dict[str, Any]) -> FeatureConfiguration:
        """Create a new config by merging overrides into current values."""
        current = self.model_dump(exclude_none=True)
        _deep_merge(current, overrides)
        return FeatureConfiguration.model_validate(current)


# ---------------------------------------------------------------------------
# Extended config option type — adds constraint support
# ---------------------------------------------------------------------------


class ConfigOptionConstraints(BaseModel):
    """Validation constraints for a config option.

    Extends the basic ConfigOption with range, pattern, and
    dependency constraints.
    """

    min_value: int | float | None = Field(
        default=None, description="Minimum numeric value (inclusive)"
    )
    max_value: int | float | None = Field(
        default=None, description="Maximum numeric value (inclusive)"
    )
    min_length: int | None = Field(
        default=None, description="Minimum string length"
    )
    max_length: int | None = Field(
        default=None, description="Maximum string length"
    )
    pattern: str | None = Field(
        default=None,
        description="Regex pattern the value must match (for string types)",
    )
    min_items: int | None = Field(
        default=None, description="Minimum items for multi_select"
    )
    max_items: int | None = Field(
        default=None, description="Maximum items for multi_select"
    )
    depends_on: str | None = Field(
        default=None,
        description=(
            "Key of another option this depends on. "
            "This option is only relevant when the dependency is set."
        ),
    )
    depends_on_value: Any = Field(
        default=None,
        description="Value the dependency must have for this option to apply",
    )

    @model_validator(mode="after")
    def validate_range(self) -> ConfigOptionConstraints:
        """Ensure min <= max when both are provided."""
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise ValueError(
                f"min_value ({self.min_value}) cannot exceed max_value ({self.max_value})"
            )
        if (
            self.min_length is not None
            and self.max_length is not None
            and self.min_length > self.max_length
        ):
            raise ValueError(
                f"min_length ({self.min_length}) cannot exceed max_length ({self.max_length})"
            )
        if (
            self.min_items is not None
            and self.max_items is not None
            and self.min_items > self.max_items
        ):
            raise ValueError(
                f"min_items ({self.min_items}) cannot exceed max_items ({self.max_items})"
            )
        return self

    def validate_value(self, value: Any) -> list[str]:
        """Validate a value against these constraints. Returns error messages."""
        errors: list[str] = []
        if value is None:
            return errors

        if isinstance(value, (int, float)):
            if self.min_value is not None and value < self.min_value:
                errors.append(f"Value {value} is below minimum {self.min_value}")
            if self.max_value is not None and value > self.max_value:
                errors.append(f"Value {value} exceeds maximum {self.max_value}")

        if isinstance(value, str):
            if self.min_length is not None and len(value) < self.min_length:
                errors.append(
                    f"String length {len(value)} is below minimum {self.min_length}"
                )
            if self.max_length is not None and len(value) > self.max_length:
                errors.append(
                    f"String length {len(value)} exceeds maximum {self.max_length}"
                )
            if self.pattern is not None and not re.match(self.pattern, value):
                errors.append(
                    f"Value '{value}' does not match required pattern '{self.pattern}'"
                )

        if isinstance(value, list):
            if self.min_items is not None and len(value) < self.min_items:
                errors.append(
                    f"Selection has {len(value)} items, minimum is {self.min_items}"
                )
            if self.max_items is not None and len(value) > self.max_items:
                errors.append(
                    f"Selection has {len(value)} items, maximum is {self.max_items}"
                )

        return errors


class ExtendedConfigOption(BaseModel):
    """Enhanced config option with validation constraints.

    Extends the base ConfigOption (from plugin.py) with:
    - Numeric range constraints (min/max)
    - String pattern/length constraints
    - Multi-select item count constraints
    - Conditional dependencies between options
    - Grouping for UI organization
    """

    key: str = Field(..., description="Unique key for this option within the plugin")
    label: str = Field(..., description="Human-readable label")
    description: str = Field(default="", description="Help text for the user")
    type: str = Field(
        ...,
        description="Data type: string, integer, float, boolean, select, "
        "multi_select, schedule, frequency, difficulty",
    )
    default: Any = Field(default=None, description="Default value")
    required: bool = Field(default=False, description="Whether user must set this")
    choices: list[str] | None = Field(default=None, description="For select types")
    constraints: ConfigOptionConstraints | None = Field(
        default=None,
        description="Validation constraints",
    )
    group: str | None = Field(
        default=None,
        description="UI grouping key (e.g., 'delivery', 'content', 'difficulty')",
    )

    def validate_value(self, value: Any) -> list[str]:
        """Validate a value against this option's type and constraints.

        Returns a list of error messages (empty = valid).
        """
        errors: list[str] = []

        if value is None:
            if self.required:
                errors.append(f"'{self.key}' is required")
            return errors

        # Type checking
        type_errors = self._check_type(value)
        if type_errors:
            errors.extend(type_errors)
            return errors  # Skip constraint checks if type is wrong

        # Choice validation
        if self.type == "select":
            if self.choices is not None and value not in self.choices:
                errors.append(
                    f"'{self.key}': value '{value}' not in choices {self.choices}"
                )
        elif self.type == "multi_select":
            if self.choices is not None and isinstance(value, list):
                invalid = [v for v in value if v not in self.choices]
                if invalid:
                    errors.append(
                        f"'{self.key}': invalid choices {invalid}. "
                        f"Valid: {self.choices}"
                    )

        # Constraint validation
        if self.constraints:
            constraint_errors = self.constraints.validate_value(value)
            errors.extend(
                f"'{self.key}': {err}" for err in constraint_errors
            )

        # Structured type validation
        if self.type == "schedule" and isinstance(value, dict):
            try:
                ScheduleConfig.model_validate(value)
            except Exception as e:
                errors.append(f"'{self.key}': invalid schedule config — {e}")
        elif self.type == "frequency" and isinstance(value, dict):
            try:
                FrequencyConfig.model_validate(value)
            except Exception as e:
                errors.append(f"'{self.key}': invalid frequency config — {e}")
        elif self.type == "difficulty" and isinstance(value, dict):
            try:
                DifficultyConfig.model_validate(value)
            except Exception as e:
                errors.append(f"'{self.key}': invalid difficulty config — {e}")

        return errors

    def _check_type(self, value: Any) -> list[str]:
        """Check that value matches the declared type."""
        type_map: dict[str, type | tuple[type, ...]] = {
            "string": str,
            "integer": int,
            "float": (int, float),
            "boolean": bool,
            "select": str,
            "multi_select": list,
            "schedule": dict,
            "frequency": dict,
            "difficulty": (dict, str),  # str for simple level, dict for full config
        }
        expected = type_map.get(self.type)
        if expected is None:
            return []  # Unknown type — pass through
        if not isinstance(value, expected):
            return [
                f"'{self.key}': expected type {self.type}, "
                f"got {type(value).__name__}"
            ]
        return []


# ---------------------------------------------------------------------------
# Feature configuration schema definition — declares all options for a feature
# ---------------------------------------------------------------------------


class FeatureConfigSchema(BaseModel):
    """Complete schema definition for a feature's configurable settings.

    This is the metadata that describes what settings a feature supports,
    their types, defaults, and validation rules. It is used by:

    1. The **registry** to validate user preferences
    2. The **API** to present available options to clients
    3. The **UI** to render settings forms dynamically

    Each feature registers one of these schemas. The schema does NOT hold
    user values — it defines the shape of valid values.
    """

    feature_name: str = Field(
        ..., description="Feature this schema belongs to"
    )
    version: str = Field(
        default="1.0.0", description="Schema version (for migration)"
    )
    options: list[ExtendedConfigOption] = Field(
        default_factory=list,
        description="All configurable options for this feature",
    )
    supports_frequency: bool = Field(
        default=False,
        description="Whether this feature supports frequency settings",
    )
    supports_schedule: bool = Field(
        default=False,
        description="Whether this feature supports schedule settings",
    )
    supports_difficulty: bool = Field(
        default=False,
        description="Whether this feature supports difficulty settings",
    )

    def get_option(self, key: str) -> ExtendedConfigOption | None:
        """Look up an option by key."""
        for opt in self.options:
            if opt.key == key:
                return opt
        return None

    def defaults(self) -> dict[str, Any]:
        """Return all default values as a dict."""
        result: dict[str, Any] = {}
        for opt in self.options:
            if opt.default is not None:
                result[opt.key] = opt.default
        return result

    def option_keys(self) -> list[str]:
        """Return all option keys."""
        return [opt.key for opt in self.options]

    def required_keys(self) -> list[str]:
        """Return keys of required options."""
        return [opt.key for opt in self.options if opt.required]

    def grouped_options(self) -> dict[str | None, list[ExtendedConfigOption]]:
        """Return options grouped by their group field."""
        groups: dict[str | None, list[ExtendedConfigOption]] = {}
        for opt in self.options:
            groups.setdefault(opt.group, []).append(opt)
        return groups

    def validate_settings(self, settings: dict[str, Any]) -> list[str]:
        """Validate a user's settings against this schema.

        Parameters
        ----------
        settings:
            Dict of setting key → value from user preferences.

        Returns
        -------
        List of error messages (empty = valid).
        """
        errors: list[str] = []
        options_by_key = {opt.key: opt for opt in self.options}

        # Check for unknown keys
        for key in settings:
            if key not in options_by_key and key not in (
                "enabled", "frequency", "schedule", "difficulty",
            ):
                errors.append(
                    f"Unknown setting '{key}' for feature '{self.feature_name}'"
                )

        # Validate each declared option
        for key, opt in options_by_key.items():
            value = settings.get(key)
            if value is None and not opt.required:
                continue
            opt_errors = opt.validate_value(value)
            errors.extend(opt_errors)

        # Validate structured settings if supported
        if self.supports_frequency and "frequency" in settings:
            try:
                FrequencyConfig.model_validate(settings["frequency"])
            except Exception as e:
                errors.append(f"Invalid frequency config: {e}")

        if self.supports_schedule and "schedule" in settings:
            try:
                ScheduleConfig.model_validate(settings["schedule"])
            except Exception as e:
                errors.append(f"Invalid schedule config: {e}")

        if self.supports_difficulty and "difficulty" in settings:
            try:
                DifficultyConfig.model_validate(settings["difficulty"])
            except Exception as e:
                errors.append(f"Invalid difficulty config: {e}")

        # Check conditional dependencies
        for opt in self.options:
            if opt.constraints and opt.constraints.depends_on:
                dep_value = settings.get(opt.constraints.depends_on)
                if opt.key in settings and dep_value != opt.constraints.depends_on_value:
                    errors.append(
                        f"'{opt.key}' requires '{opt.constraints.depends_on}' "
                        f"to be set to {opt.constraints.depends_on_value!r}"
                    )

        return errors


# ---------------------------------------------------------------------------
# Predefined schemas for common feature types
# ---------------------------------------------------------------------------


def create_vocab_learning_config_schema() -> FeatureConfigSchema:
    """Create the configuration schema for the vocabulary learning feature.

    This demonstrates how a plugin defines its full settings schema
    with typed fields, constraints, and grouping.
    """
    return FeatureConfigSchema(
        feature_name="vocab_learning",
        version="1.0.0",
        supports_frequency=True,
        supports_schedule=True,
        supports_difficulty=True,
        options=[
            ExtendedConfigOption(
                key="difficulty_level",
                label="Difficulty Level",
                description="The difficulty of vocabulary words",
                type="select",
                default="medium",
                choices=["easy", "medium", "hard"],
                group="difficulty",
            ),
            ExtendedConfigOption(
                key="words_per_day",
                label="Words Per Day",
                description="Number of new words to learn each day",
                type="integer",
                default=5,
                constraints=ConfigOptionConstraints(
                    min_value=1, max_value=50,
                ),
                group="content",
            ),
            ExtendedConfigOption(
                key="include_examples",
                label="Include Examples",
                description="Whether to include example sentences",
                type="boolean",
                default=True,
                group="content",
            ),
            ExtendedConfigOption(
                key="quiz_style",
                label="Quiz Style",
                description="Preferred quiz format",
                type="select",
                default="multiple_choice",
                choices=["multiple_choice", "fill_in_blank", "definition_match"],
                group="content",
            ),
            ExtendedConfigOption(
                key="content_categories",
                label="Content Categories",
                description="Types of vocabulary content to include",
                type="multi_select",
                default=["words"],
                choices=["words", "phrases", "idioms", "collocations"],
                constraints=ConfigOptionConstraints(
                    min_items=1, max_items=4,
                ),
                group="content",
            ),
            ExtendedConfigOption(
                key="target_language",
                label="Target Language",
                description="Language to learn vocabulary in",
                type="select",
                default="en",
                choices=["en", "es", "fr", "de", "ja", "ko", "zh"],
                group="content",
            ),
            ExtendedConfigOption(
                key="review_interval_hours",
                label="Review Interval (hours)",
                description="Hours between review sessions",
                type="integer",
                default=24,
                constraints=ConfigOptionConstraints(
                    min_value=1, max_value=168,  # 1 hour to 1 week
                ),
                group="delivery",
            ),
            ExtendedConfigOption(
                key="spaced_repetition",
                label="Spaced Repetition",
                description="Enable spaced repetition algorithm",
                type="boolean",
                default=False,
                group="content",
            ),
        ],
    )


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def _deep_merge(base: dict, overrides: dict) -> None:
    """Recursively merge overrides into base dict (mutates base)."""
    for key, value in overrides.items():
        if (
            key in base
            and isinstance(base[key], dict)
            and isinstance(value, dict)
        ):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def validate_feature_config(
    schema: FeatureConfigSchema,
    config: FeatureConfiguration,
) -> list[str]:
    """Validate a full FeatureConfiguration against a FeatureConfigSchema.

    This is the top-level validation entry point that checks:
    1. Custom settings against the schema's declared options
    2. Frequency config (if feature supports it)
    3. Schedule config (if feature supports it)
    4. Difficulty config (if feature supports it)
    """
    errors: list[str] = []

    # Validate custom settings
    if config.custom_settings:
        errors.extend(schema.validate_settings(config.custom_settings))

    # Check that structured settings are used only when supported
    if config.frequency and not schema.supports_frequency:
        errors.append(
            f"Feature '{schema.feature_name}' does not support frequency settings"
        )
    if config.schedule and not schema.supports_schedule:
        errors.append(
            f"Feature '{schema.feature_name}' does not support schedule settings"
        )
    if config.difficulty and not schema.supports_difficulty:
        errors.append(
            f"Feature '{schema.feature_name}' does not support difficulty settings"
        )

    return errors
