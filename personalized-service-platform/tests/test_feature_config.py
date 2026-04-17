"""Tests for the feature configuration data model.

Covers:
- FrequencyConfig validation (units, ranges, coherence)
- ScheduleConfig validation (time windows, days, timezone)
- DifficultyConfig validation (levels, adaptive mode, range)
- FeatureConfiguration (composition, serialization, merging)
- ExtendedConfigOption (type checking, constraints)
- FeatureConfigSchema (full schema validation, defaults, grouping)
- Vocab learning schema (predefined schema)
- FeatureSettingsDTO integration (typed settings in DTOs)
"""

import pytest
from pydantic import ValidationError

from app.models.feature_config import (
    ConfigOptionConstraints,
    DayOfWeek,
    DifficultyConfig,
    DifficultyLevel,
    ExtendedConfigOption,
    FeatureConfigSchema,
    FeatureConfiguration,
    FrequencyConfig,
    FrequencyUnit,
    ScheduleConfig,
    TimeWindow,
    create_vocab_learning_config_schema,
    validate_feature_config,
)
from app.api.dto import FeatureSettingsDTO


# ---------------------------------------------------------------------------
# FrequencyConfig tests
# ---------------------------------------------------------------------------


class TestFrequencyConfig:
    def test_default(self):
        fc = FrequencyConfig(value=3)
        assert fc.value == 3
        assert fc.unit == FrequencyUnit.DAILY
        assert fc.max_per_day is None

    def test_valid_hourly(self):
        fc = FrequencyConfig(value=4, unit=FrequencyUnit.HOURS)
        assert fc.value == 4
        assert fc.unit == FrequencyUnit.HOURS

    def test_hourly_exceeds_24(self):
        with pytest.raises(ValidationError, match="cannot exceed 24"):
            FrequencyConfig(value=25, unit=FrequencyUnit.HOURS)

    def test_minutes_exceeds_1440(self):
        # value=100 is within the field constraint but exceeds 1440-minute coherence
        # However, 100 minutes is actually valid. Use a value that passes field
        # validation but fails coherence: not possible since max value is 100
        # and 100 < 1440. So we just verify the field constraint kicks in.
        with pytest.raises(ValidationError):
            FrequencyConfig(value=1500, unit=FrequencyUnit.MINUTES)

    def test_weekly_exceeds_7(self):
        with pytest.raises(ValidationError, match="cannot exceed 7"):
            FrequencyConfig(value=8, unit=FrequencyUnit.WEEKLY)

    def test_monthly_exceeds_31(self):
        with pytest.raises(ValidationError, match="cannot exceed 31"):
            FrequencyConfig(value=32, unit=FrequencyUnit.MONTHLY)

    def test_value_below_minimum(self):
        with pytest.raises(ValidationError):
            FrequencyConfig(value=0)

    def test_value_above_maximum(self):
        with pytest.raises(ValidationError):
            FrequencyConfig(value=101)

    def test_max_per_day(self):
        fc = FrequencyConfig(value=2, unit=FrequencyUnit.HOURS, max_per_day=10)
        assert fc.max_per_day == 10

    def test_serialization_roundtrip(self):
        fc = FrequencyConfig(value=5, unit=FrequencyUnit.DAILY, max_per_day=10)
        data = fc.model_dump()
        restored = FrequencyConfig.model_validate(data)
        assert restored == fc


# ---------------------------------------------------------------------------
# TimeWindow tests
# ---------------------------------------------------------------------------


class TestTimeWindow:
    def test_default(self):
        tw = TimeWindow()
        assert tw.start == "09:00"
        assert tw.end == "21:00"

    def test_valid_window(self):
        tw = TimeWindow(start="08:30", end="17:45")
        assert tw.start == "08:30"

    def test_invalid_time_format(self):
        with pytest.raises(ValidationError, match="Invalid time format"):
            TimeWindow(start="25:00", end="21:00")

    def test_invalid_time_format_minutes(self):
        with pytest.raises(ValidationError, match="Invalid time format"):
            TimeWindow(start="09:60", end="21:00")

    def test_start_after_end(self):
        with pytest.raises(ValidationError, match="must be before end time"):
            TimeWindow(start="18:00", end="09:00")

    def test_start_equals_end(self):
        with pytest.raises(ValidationError, match="must be before end time"):
            TimeWindow(start="12:00", end="12:00")


# ---------------------------------------------------------------------------
# ScheduleConfig tests
# ---------------------------------------------------------------------------


class TestScheduleConfig:
    def test_default(self):
        sc = ScheduleConfig()
        assert len(sc.active_days) == 7  # All days
        assert len(sc.time_windows) == 1
        assert sc.timezone == "UTC"

    def test_specific_days(self):
        sc = ScheduleConfig(
            active_days=[DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY]
        )
        assert len(sc.active_days) == 3

    def test_empty_days_rejected(self):
        with pytest.raises(ValidationError, match="At least one active day"):
            ScheduleConfig(active_days=[])

    def test_preferred_times_valid(self):
        sc = ScheduleConfig(preferred_times=["08:00", "12:30", "18:00"])
        assert len(sc.preferred_times) == 3

    def test_preferred_times_invalid(self):
        with pytest.raises(ValidationError, match="Invalid preferred time"):
            ScheduleConfig(preferred_times=["8am"])

    def test_invalid_timezone(self):
        with pytest.raises(ValidationError, match="Invalid timezone format"):
            ScheduleConfig(timezone="invalid-tz")

    def test_valid_timezone(self):
        sc = ScheduleConfig(timezone="America/New_York")
        assert sc.timezone == "America/New_York"

    def test_serialization_roundtrip(self):
        sc = ScheduleConfig(
            active_days=[DayOfWeek.MONDAY, DayOfWeek.FRIDAY],
            time_windows=[TimeWindow(start="10:00", end="16:00")],
            preferred_times=["12:00"],
            timezone="Asia/Seoul",
        )
        data = sc.model_dump()
        restored = ScheduleConfig.model_validate(data)
        assert restored.timezone == "Asia/Seoul"
        assert len(restored.active_days) == 2


# ---------------------------------------------------------------------------
# DifficultyConfig tests
# ---------------------------------------------------------------------------


class TestDifficultyConfig:
    def test_default(self):
        dc = DifficultyConfig()
        assert dc.level == DifficultyLevel.MEDIUM
        assert dc.adaptive is False
        assert dc.progression_threshold == 0.8

    def test_valid_fixed_level(self):
        dc = DifficultyConfig(level=DifficultyLevel.HARD)
        assert dc.level == DifficultyLevel.HARD

    def test_adaptive_valid_range(self):
        dc = DifficultyConfig(
            level=DifficultyLevel.MEDIUM,
            adaptive=True,
            min_level=DifficultyLevel.EASY,
            max_level=DifficultyLevel.HARD,
        )
        assert dc.adaptive is True

    def test_min_exceeds_max(self):
        with pytest.raises(ValidationError, match="cannot be higher"):
            DifficultyConfig(
                min_level=DifficultyLevel.HARD,
                max_level=DifficultyLevel.EASY,
            )

    def test_adaptive_level_out_of_range(self):
        with pytest.raises(ValidationError, match="must be between"):
            DifficultyConfig(
                level=DifficultyLevel.EXPERT,
                adaptive=True,
                min_level=DifficultyLevel.EASY,
                max_level=DifficultyLevel.HARD,
            )

    def test_non_adaptive_level_out_of_range_ok(self):
        # When not adaptive, level outside min/max is allowed
        dc = DifficultyConfig(
            level=DifficultyLevel.EXPERT,
            adaptive=False,
            min_level=DifficultyLevel.EASY,
            max_level=DifficultyLevel.HARD,
        )
        assert dc.level == DifficultyLevel.EXPERT

    def test_progression_threshold_bounds(self):
        with pytest.raises(ValidationError):
            DifficultyConfig(progression_threshold=1.5)
        with pytest.raises(ValidationError):
            DifficultyConfig(progression_threshold=-0.1)


# ---------------------------------------------------------------------------
# FeatureConfiguration tests
# ---------------------------------------------------------------------------


class TestFeatureConfiguration:
    def test_default(self):
        fc = FeatureConfiguration()
        assert fc.enabled is True
        assert fc.frequency is None
        assert fc.schedule is None
        assert fc.difficulty is None
        assert fc.custom_settings == {}

    def test_full_config(self):
        fc = FeatureConfiguration(
            enabled=True,
            frequency=FrequencyConfig(value=3, unit=FrequencyUnit.DAILY),
            schedule=ScheduleConfig(
                active_days=[DayOfWeek.MONDAY],
                timezone="UTC",
            ),
            difficulty=DifficultyConfig(level=DifficultyLevel.HARD),
            custom_settings={"words_per_day": 10, "include_examples": True},
        )
        assert fc.frequency.value == 3
        assert fc.difficulty.level == DifficultyLevel.HARD
        assert fc.custom_settings["words_per_day"] == 10

    def test_to_flat_dict(self):
        fc = FeatureConfiguration(
            enabled=True,
            frequency=FrequencyConfig(value=5, unit=FrequencyUnit.DAILY),
            custom_settings={"key": "value"},
        )
        flat = fc.to_flat_dict()
        assert flat["enabled"] is True
        assert flat["frequency"]["value"] == 5
        assert flat["custom_settings"]["key"] == "value"

    def test_from_flat_dict(self):
        data = {
            "enabled": True,
            "frequency": {"value": 3, "unit": "daily"},
            "difficulty": {"level": "hard"},
        }
        fc = FeatureConfiguration.from_flat_dict(data)
        assert fc.frequency.value == 3
        assert fc.difficulty.level == DifficultyLevel.HARD

    def test_merge_with(self):
        fc = FeatureConfiguration(
            frequency=FrequencyConfig(value=3, unit=FrequencyUnit.DAILY),
            custom_settings={"a": 1, "b": 2},
        )
        merged = fc.merge_with({"custom_settings": {"b": 99, "c": 3}})
        assert merged.custom_settings["a"] == 1
        assert merged.custom_settings["b"] == 99
        assert merged.custom_settings["c"] == 3


# ---------------------------------------------------------------------------
# ConfigOptionConstraints tests
# ---------------------------------------------------------------------------


class TestConfigOptionConstraints:
    def test_min_max_valid(self):
        c = ConfigOptionConstraints(min_value=1, max_value=100)
        assert c.validate_value(50) == []

    def test_min_exceeds_max(self):
        with pytest.raises(ValidationError, match="cannot exceed"):
            ConfigOptionConstraints(min_value=100, max_value=1)

    def test_value_below_min(self):
        c = ConfigOptionConstraints(min_value=5)
        errors = c.validate_value(3)
        assert any("below minimum" in e for e in errors)

    def test_value_above_max(self):
        c = ConfigOptionConstraints(max_value=10)
        errors = c.validate_value(15)
        assert any("exceeds maximum" in e for e in errors)

    def test_string_length(self):
        c = ConfigOptionConstraints(min_length=2, max_length=10)
        assert c.validate_value("hello") == []
        assert len(c.validate_value("x")) > 0
        assert len(c.validate_value("x" * 20)) > 0

    def test_pattern(self):
        c = ConfigOptionConstraints(pattern=r"^\d{3}-\d{4}$")
        assert c.validate_value("123-4567") == []
        assert len(c.validate_value("abc")) > 0

    def test_list_items(self):
        c = ConfigOptionConstraints(min_items=1, max_items=3)
        assert c.validate_value(["a", "b"]) == []
        assert len(c.validate_value([])) > 0
        assert len(c.validate_value(["a", "b", "c", "d"])) > 0

    def test_none_passthrough(self):
        c = ConfigOptionConstraints(min_value=5)
        assert c.validate_value(None) == []


# ---------------------------------------------------------------------------
# ExtendedConfigOption tests
# ---------------------------------------------------------------------------


class TestExtendedConfigOption:
    def test_validate_integer_with_constraints(self):
        opt = ExtendedConfigOption(
            key="words_per_day",
            label="Words Per Day",
            type="integer",
            default=5,
            constraints=ConfigOptionConstraints(min_value=1, max_value=50),
        )
        assert opt.validate_value(10) == []
        assert len(opt.validate_value(0)) > 0
        assert len(opt.validate_value(100)) > 0

    def test_validate_select(self):
        opt = ExtendedConfigOption(
            key="level",
            label="Level",
            type="select",
            choices=["easy", "medium", "hard"],
        )
        assert opt.validate_value("easy") == []
        assert len(opt.validate_value("impossible")) > 0

    def test_validate_multi_select_with_constraints(self):
        opt = ExtendedConfigOption(
            key="categories",
            label="Categories",
            type="multi_select",
            choices=["words", "phrases", "idioms"],
            constraints=ConfigOptionConstraints(min_items=1, max_items=2),
        )
        assert opt.validate_value(["words"]) == []
        assert len(opt.validate_value(["words", "phrases", "idioms"])) > 0

    def test_validate_required_missing(self):
        opt = ExtendedConfigOption(
            key="required_field",
            label="Required",
            type="string",
            required=True,
        )
        assert len(opt.validate_value(None)) > 0

    def test_validate_type_mismatch(self):
        opt = ExtendedConfigOption(
            key="count",
            label="Count",
            type="integer",
        )
        assert len(opt.validate_value("not_a_number")) > 0

    def test_validate_schedule_type(self):
        opt = ExtendedConfigOption(
            key="delivery_schedule",
            label="Schedule",
            type="schedule",
        )
        valid_schedule = {
            "active_days": ["monday", "friday"],
            "timezone": "UTC",
        }
        assert opt.validate_value(valid_schedule) == []

    def test_validate_frequency_type(self):
        opt = ExtendedConfigOption(
            key="delivery_frequency",
            label="Frequency",
            type="frequency",
        )
        valid_freq = {"value": 3, "unit": "daily"}
        assert opt.validate_value(valid_freq) == []

    def test_validate_difficulty_type(self):
        opt = ExtendedConfigOption(
            key="difficulty_setting",
            label="Difficulty",
            type="difficulty",
        )
        valid_diff = {"level": "hard", "adaptive": False}
        assert opt.validate_value(valid_diff) == []

    def test_validate_invalid_schedule(self):
        opt = ExtendedConfigOption(
            key="sched",
            label="Schedule",
            type="schedule",
        )
        errors = opt.validate_value({"active_days": []})  # empty days not allowed
        assert len(errors) > 0

    def test_group_field(self):
        opt = ExtendedConfigOption(
            key="test", label="Test", type="string", group="content"
        )
        assert opt.group == "content"


# ---------------------------------------------------------------------------
# FeatureConfigSchema tests
# ---------------------------------------------------------------------------


class TestFeatureConfigSchema:
    def _make_schema(self) -> FeatureConfigSchema:
        return FeatureConfigSchema(
            feature_name="test_feature",
            supports_frequency=True,
            supports_schedule=True,
            supports_difficulty=True,
            options=[
                ExtendedConfigOption(
                    key="count",
                    label="Count",
                    type="integer",
                    default=5,
                    constraints=ConfigOptionConstraints(min_value=1, max_value=100),
                    group="content",
                ),
                ExtendedConfigOption(
                    key="mode",
                    label="Mode",
                    type="select",
                    default="normal",
                    choices=["normal", "advanced"],
                    group="content",
                ),
                ExtendedConfigOption(
                    key="enabled_detail",
                    label="Detail",
                    type="boolean",
                    default=False,
                    constraints=ConfigOptionConstraints(
                        depends_on="mode", depends_on_value="advanced"
                    ),
                    group="advanced",
                ),
            ],
        )

    def test_defaults(self):
        schema = self._make_schema()
        defaults = schema.defaults()
        assert defaults["count"] == 5
        assert defaults["mode"] == "normal"

    def test_option_keys(self):
        schema = self._make_schema()
        assert set(schema.option_keys()) == {"count", "mode", "enabled_detail"}

    def test_required_keys(self):
        schema = self._make_schema()
        assert schema.required_keys() == []

    def test_grouped_options(self):
        schema = self._make_schema()
        groups = schema.grouped_options()
        assert "content" in groups
        assert "advanced" in groups
        assert len(groups["content"]) == 2
        assert len(groups["advanced"]) == 1

    def test_validate_valid_settings(self):
        schema = self._make_schema()
        errors = schema.validate_settings({"count": 10, "mode": "normal"})
        assert errors == []

    def test_validate_invalid_count(self):
        schema = self._make_schema()
        errors = schema.validate_settings({"count": 200})
        assert any("exceeds maximum" in e for e in errors)

    def test_validate_unknown_key(self):
        schema = self._make_schema()
        errors = schema.validate_settings({"unknown_key": "value"})
        assert any("Unknown setting" in e for e in errors)

    def test_validate_dependency(self):
        schema = self._make_schema()
        # enabled_detail requires mode=advanced
        errors = schema.validate_settings({
            "mode": "normal",
            "enabled_detail": True,
        })
        assert any("requires" in e for e in errors)

    def test_validate_dependency_satisfied(self):
        schema = self._make_schema()
        errors = schema.validate_settings({
            "mode": "advanced",
            "enabled_detail": True,
        })
        assert errors == []

    def test_validate_frequency_in_settings(self):
        schema = self._make_schema()
        errors = schema.validate_settings({
            "frequency": {"value": 3, "unit": "daily"},
        })
        assert errors == []

    def test_validate_invalid_frequency_in_settings(self):
        schema = self._make_schema()
        errors = schema.validate_settings({
            "frequency": {"value": 25, "unit": "hours"},
        })
        assert any("frequency" in e.lower() for e in errors)

    def test_get_option(self):
        schema = self._make_schema()
        opt = schema.get_option("count")
        assert opt is not None
        assert opt.key == "count"
        assert schema.get_option("nonexistent") is None


# ---------------------------------------------------------------------------
# Vocab learning schema tests
# ---------------------------------------------------------------------------


class TestVocabLearningSchema:
    def test_schema_creation(self):
        schema = create_vocab_learning_config_schema()
        assert schema.feature_name == "vocab_learning"
        assert schema.supports_frequency is True
        assert schema.supports_schedule is True
        assert schema.supports_difficulty is True

    def test_schema_options(self):
        schema = create_vocab_learning_config_schema()
        keys = schema.option_keys()
        assert "difficulty_level" in keys
        assert "words_per_day" in keys
        assert "include_examples" in keys
        assert "quiz_style" in keys
        assert "content_categories" in keys
        assert "target_language" in keys
        assert "review_interval_hours" in keys

    def test_schema_defaults(self):
        schema = create_vocab_learning_config_schema()
        defaults = schema.defaults()
        assert defaults["difficulty_level"] == "medium"
        assert defaults["words_per_day"] == 5
        assert defaults["include_examples"] is True

    def test_validate_valid_vocab_settings(self):
        schema = create_vocab_learning_config_schema()
        errors = schema.validate_settings({
            "difficulty_level": "hard",
            "words_per_day": 10,
            "include_examples": True,
            "quiz_style": "fill_in_blank",
            "content_categories": ["words", "idioms"],
            "target_language": "ko",
        })
        assert errors == []

    def test_validate_words_per_day_too_high(self):
        schema = create_vocab_learning_config_schema()
        errors = schema.validate_settings({"words_per_day": 100})
        assert len(errors) > 0

    def test_validate_invalid_difficulty(self):
        schema = create_vocab_learning_config_schema()
        errors = schema.validate_settings({"difficulty_level": "impossible"})
        assert len(errors) > 0

    def test_validate_empty_categories(self):
        schema = create_vocab_learning_config_schema()
        errors = schema.validate_settings({"content_categories": []})
        assert any("minimum" in e for e in errors)


# ---------------------------------------------------------------------------
# validate_feature_config top-level function tests
# ---------------------------------------------------------------------------


class TestValidateFeatureConfig:
    def test_valid_full_config(self):
        schema = create_vocab_learning_config_schema()
        config = FeatureConfiguration(
            enabled=True,
            frequency=FrequencyConfig(value=3, unit=FrequencyUnit.DAILY),
            schedule=ScheduleConfig(timezone="UTC"),
            difficulty=DifficultyConfig(level=DifficultyLevel.HARD),
            custom_settings={"words_per_day": 10, "difficulty_level": "hard"},
        )
        errors = validate_feature_config(schema, config)
        assert errors == []

    def test_unsupported_frequency(self):
        schema = FeatureConfigSchema(
            feature_name="no_freq",
            supports_frequency=False,
        )
        config = FeatureConfiguration(
            frequency=FrequencyConfig(value=3),
        )
        errors = validate_feature_config(schema, config)
        assert any("does not support frequency" in e for e in errors)

    def test_unsupported_schedule(self):
        schema = FeatureConfigSchema(
            feature_name="no_sched",
            supports_schedule=False,
        )
        config = FeatureConfiguration(
            schedule=ScheduleConfig(),
        )
        errors = validate_feature_config(schema, config)
        assert any("does not support schedule" in e for e in errors)

    def test_unsupported_difficulty(self):
        schema = FeatureConfigSchema(
            feature_name="no_diff",
            supports_difficulty=False,
        )
        config = FeatureConfiguration(
            difficulty=DifficultyConfig(),
        )
        errors = validate_feature_config(schema, config)
        assert any("does not support difficulty" in e for e in errors)


# ---------------------------------------------------------------------------
# FeatureSettingsDTO integration tests
# ---------------------------------------------------------------------------


class TestFeatureSettingsDTOIntegration:
    def test_dto_with_typed_settings(self):
        dto = FeatureSettingsDTO(
            enabled=True,
            settings={"words_per_day": 10},
            frequency=FrequencyConfig(value=3, unit=FrequencyUnit.DAILY),
            difficulty=DifficultyConfig(level=DifficultyLevel.HARD),
        )
        assert dto.frequency.value == 3
        assert dto.difficulty.level == DifficultyLevel.HARD

    def test_dto_backward_compatible(self):
        """Existing DTOs without typed fields still work."""
        dto = FeatureSettingsDTO(
            enabled=True,
            settings={"difficulty_level": "hard", "words_per_day": 10},
        )
        assert dto.frequency is None
        assert dto.schedule is None
        assert dto.difficulty is None

    def test_dto_to_feature_configuration(self):
        dto = FeatureSettingsDTO(
            enabled=True,
            settings={"words_per_day": 10},
            frequency=FrequencyConfig(value=5, unit=FrequencyUnit.DAILY),
        )
        config = dto.to_feature_configuration()
        assert config.enabled is True
        assert config.frequency.value == 5
        assert config.custom_settings["words_per_day"] == 10

    def test_dto_from_feature_configuration(self):
        config = FeatureConfiguration(
            enabled=True,
            frequency=FrequencyConfig(value=3),
            custom_settings={"key": "val"},
        )
        dto = FeatureSettingsDTO.from_feature_configuration(config)
        assert dto.enabled is True
        assert dto.frequency.value == 3
        assert dto.settings["key"] == "val"

    def test_dto_json_roundtrip(self):
        dto = FeatureSettingsDTO(
            enabled=True,
            settings={"level": "hard"},
            frequency=FrequencyConfig(value=2, unit=FrequencyUnit.HOURS),
            schedule=ScheduleConfig(
                active_days=[DayOfWeek.MONDAY],
                timezone="UTC",
            ),
            difficulty=DifficultyConfig(
                level=DifficultyLevel.HARD,
                adaptive=True,
                min_level=DifficultyLevel.MEDIUM,
                max_level=DifficultyLevel.EXPERT,
            ),
        )
        json_str = dto.model_dump_json()
        restored = FeatureSettingsDTO.model_validate_json(json_str)
        assert restored.frequency.value == 2
        assert restored.schedule.active_days == [DayOfWeek.MONDAY]
        assert restored.difficulty.adaptive is True
