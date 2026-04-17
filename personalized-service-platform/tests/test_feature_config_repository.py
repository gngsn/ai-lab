"""Tests for the feature configuration repository/service layer.

Covers:
- CRUD operations (get, get_or_default, get_all, set, update, delete, delete_all)
- Schema validation on save
- Partial updates with merge semantics
- Single custom setting updates
- Default population from schemas
- Validated save (set_validated)
- Schema registration and management
- Global schema registry
- Serialization/deserialization
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock

from app.models.feature_config import (
    DifficultyConfig,
    DifficultyLevel,
    FeatureConfigSchema,
    FeatureConfiguration,
    FrequencyConfig,
    FrequencyUnit,
    ScheduleConfig,
    create_vocab_learning_config_schema,
)
from app.services.feature_config_repository import (
    FeatureConfigRecord,
    FeatureConfigRepository,
    FeatureConfigRepositoryProtocol,
    register_global_schema,
    get_schema_registry,
    reset_schema_registry,
    _FEATURE_CONFIG_PREFIX,
)
from app.services.preferences_repository_protocol import PreferenceRecord


# ---------------------------------------------------------------------------
# In-memory PreferencesRepository stub for testing
# ---------------------------------------------------------------------------


class InMemoryPreferencesRepository:
    """Simple in-memory preferences repository for testing."""

    def __init__(self) -> None:
        self._store: dict[tuple[str, str], PreferenceRecord] = {}
        self._counter = 0

    async def get(self, user_id: str, preference_key: str) -> PreferenceRecord | None:
        return self._store.get((user_id, preference_key))

    async def get_all(
        self, user_id: str, *, prefix: str | None = None
    ) -> list[PreferenceRecord]:
        results = []
        for (uid, key), record in self._store.items():
            if uid != user_id:
                continue
            if prefix and not key.startswith(prefix):
                continue
            results.append(record)
        return sorted(results, key=lambda r: r.preference_key)

    async def set(
        self, user_id: str, preference_key: str, preference_value: Any
    ) -> PreferenceRecord:
        self._counter += 1
        record = PreferenceRecord(
            id=str(self._counter),
            user_id=user_id,
            preference_key=preference_key,
            preference_value=preference_value,
        )
        self._store[(user_id, preference_key)] = record
        return record

    async def set_bulk(
        self, user_id: str, preferences: dict[str, Any]
    ) -> list[PreferenceRecord]:
        results = []
        for key, value in preferences.items():
            results.append(await self.set(user_id, key, value))
        return results

    async def delete(self, user_id: str, preference_key: str) -> bool:
        key = (user_id, preference_key)
        if key in self._store:
            del self._store[key]
            return True
        return False


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def prefs_repo():
    """Create a fresh in-memory preferences repository."""
    return InMemoryPreferencesRepository()


@pytest.fixture
def vocab_schema():
    """Create the vocab learning config schema."""
    return create_vocab_learning_config_schema()


@pytest.fixture
def repo(prefs_repo):
    """Create a FeatureConfigRepository without schemas."""
    return FeatureConfigRepository(prefs_repo)


@pytest.fixture
def repo_with_schema(prefs_repo, vocab_schema):
    """Create a FeatureConfigRepository with the vocab learning schema."""
    r = FeatureConfigRepository(prefs_repo, schemas={"vocab_learning": vocab_schema})
    return r


# ---------------------------------------------------------------------------
# Basic CRUD tests
# ---------------------------------------------------------------------------


class TestGet:
    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_none(self, repo):
        result = await repo.get("user1", "vocab_learning")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_after_set(self, repo):
        config = FeatureConfiguration(
            enabled=True,
            custom_settings={"words_per_day": 10},
        )
        await repo.set("user1", "vocab_learning", config)
        result = await repo.get("user1", "vocab_learning")
        assert result is not None
        assert result.enabled is True
        assert result.custom_settings["words_per_day"] == 10

    @pytest.mark.asyncio
    async def test_get_different_users_isolated(self, repo):
        config1 = FeatureConfiguration(custom_settings={"level": "easy"})
        config2 = FeatureConfiguration(custom_settings={"level": "hard"})
        await repo.set("user1", "vocab_learning", config1)
        await repo.set("user2", "vocab_learning", config2)

        r1 = await repo.get("user1", "vocab_learning")
        r2 = await repo.get("user2", "vocab_learning")
        assert r1.custom_settings["level"] == "easy"
        assert r2.custom_settings["level"] == "hard"

    @pytest.mark.asyncio
    async def test_get_different_features_isolated(self, repo):
        config_vocab = FeatureConfiguration(custom_settings={"type": "vocab"})
        config_quiz = FeatureConfiguration(custom_settings={"type": "quiz"})
        await repo.set("user1", "vocab_learning", config_vocab)
        await repo.set("user1", "quiz_master", config_quiz)

        r1 = await repo.get("user1", "vocab_learning")
        r2 = await repo.get("user1", "quiz_master")
        assert r1.custom_settings["type"] == "vocab"
        assert r2.custom_settings["type"] == "quiz"


class TestGetOrDefault:
    @pytest.mark.asyncio
    async def test_returns_existing_config(self, repo):
        config = FeatureConfiguration(custom_settings={"words_per_day": 15})
        await repo.set("user1", "vocab_learning", config)

        result = await repo.get_or_default("user1", "vocab_learning")
        assert result.custom_settings["words_per_day"] == 15

    @pytest.mark.asyncio
    async def test_returns_schema_defaults_when_no_config(self, repo_with_schema, vocab_schema):
        result = await repo_with_schema.get_or_default("user1", "vocab_learning")
        defaults = vocab_schema.defaults()
        assert result.custom_settings == defaults
        assert result.enabled is True

    @pytest.mark.asyncio
    async def test_returns_bare_config_when_no_schema(self, repo):
        result = await repo.get_or_default("user1", "unknown_feature")
        assert result.enabled is True
        assert result.custom_settings == {}

    @pytest.mark.asyncio
    async def test_explicit_schema_overrides_registered(self, repo_with_schema):
        custom_schema = FeatureConfigSchema(
            feature_name="vocab_learning",
            options=[],
        )
        result = await repo_with_schema.get_or_default(
            "user1", "vocab_learning", schema=custom_schema
        )
        # Custom schema has no options, so defaults should be empty
        assert result.custom_settings == {}


class TestGetAll:
    @pytest.mark.asyncio
    async def test_empty_user(self, repo):
        result = await repo.get_all("user1")
        assert result == {}

    @pytest.mark.asyncio
    async def test_multiple_features(self, repo):
        await repo.set("user1", "feature_a", FeatureConfiguration(
            custom_settings={"a": 1}
        ))
        await repo.set("user1", "feature_b", FeatureConfiguration(
            custom_settings={"b": 2}
        ))

        result = await repo.get_all("user1")
        assert len(result) == 2
        assert "feature_a" in result
        assert "feature_b" in result
        assert result["feature_a"].custom_settings["a"] == 1
        assert result["feature_b"].custom_settings["b"] == 2

    @pytest.mark.asyncio
    async def test_does_not_include_other_users(self, repo):
        await repo.set("user1", "feature_a", FeatureConfiguration())
        await repo.set("user2", "feature_b", FeatureConfiguration())

        result = await repo.get_all("user1")
        assert len(result) == 1
        assert "feature_a" in result


class TestSet:
    @pytest.mark.asyncio
    async def test_set_returns_record(self, repo):
        config = FeatureConfiguration(
            enabled=True,
            custom_settings={"words_per_day": 10},
        )
        record = await repo.set("user1", "vocab_learning", config)
        assert isinstance(record, FeatureConfigRecord)
        assert record.user_id == "user1"
        assert record.feature_name == "vocab_learning"
        assert record.config.enabled is True
        assert record.config.custom_settings["words_per_day"] == 10

    @pytest.mark.asyncio
    async def test_set_overwrites(self, repo):
        config1 = FeatureConfiguration(custom_settings={"v": 1})
        config2 = FeatureConfiguration(custom_settings={"v": 2})
        await repo.set("user1", "feat", config1)
        await repo.set("user1", "feat", config2)

        result = await repo.get("user1", "feat")
        assert result.custom_settings["v"] == 2

    @pytest.mark.asyncio
    async def test_set_with_full_config(self, repo):
        config = FeatureConfiguration(
            enabled=True,
            frequency=FrequencyConfig(value=3, unit=FrequencyUnit.DAILY),
            schedule=ScheduleConfig(timezone="Asia/Seoul"),
            difficulty=DifficultyConfig(level=DifficultyLevel.HARD),
            custom_settings={"words_per_day": 10},
        )
        await repo.set("user1", "vocab_learning", config)
        result = await repo.get("user1", "vocab_learning")

        assert result.frequency is not None
        assert result.frequency.value == 3
        assert result.schedule is not None
        assert result.schedule.timezone == "Asia/Seoul"
        assert result.difficulty is not None
        assert result.difficulty.level == DifficultyLevel.HARD

    @pytest.mark.asyncio
    async def test_set_with_validation_errors(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 999},  # exceeds max (50)
        )
        record = await repo_with_schema.set("user1", "vocab_learning", config)
        # Validation errors are returned but config is still saved
        assert len(record.validation_errors) > 0
        # Config was saved despite errors
        result = await repo_with_schema.get("user1", "vocab_learning")
        assert result is not None

    @pytest.mark.asyncio
    async def test_set_with_no_schema_no_errors(self, repo):
        config = FeatureConfiguration(custom_settings={"anything": "goes"})
        record = await repo.set("user1", "no_schema_feature", config)
        assert record.validation_errors == []
        assert record.validation_warnings == []


class TestSetValidated:
    @pytest.mark.asyncio
    async def test_set_validated_with_valid_config(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 10, "difficulty_level": "hard"},
        )
        record = await repo_with_schema.set_validated("user1", "vocab_learning", config)
        assert record.validation_errors == []

    @pytest.mark.asyncio
    async def test_set_validated_rejects_invalid_config(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 999},
        )
        with pytest.raises(ValueError, match="validation failed"):
            await repo_with_schema.set_validated("user1", "vocab_learning", config)

    @pytest.mark.asyncio
    async def test_set_validated_no_schema_passes(self, repo):
        """Without a schema, validation always passes."""
        config = FeatureConfiguration(custom_settings={"anything": "goes"})
        record = await repo.set_validated("user1", "no_schema", config)
        assert record.validation_errors == []


class TestUpdate:
    @pytest.mark.asyncio
    async def test_update_merges_into_existing(self, repo):
        config = FeatureConfiguration(
            custom_settings={"a": 1, "b": 2},
        )
        await repo.set("user1", "feat", config)

        record = await repo.update("user1", "feat", {"custom_settings": {"b": 99, "c": 3}})
        assert record.config.custom_settings["a"] == 1
        assert record.config.custom_settings["b"] == 99
        assert record.config.custom_settings["c"] == 3

    @pytest.mark.asyncio
    async def test_update_creates_from_default(self, repo):
        record = await repo.update("user1", "feat", {"custom_settings": {"x": 1}})
        assert record.config.enabled is True  # default
        assert record.config.custom_settings["x"] == 1

    @pytest.mark.asyncio
    async def test_update_top_level_fields(self, repo):
        config = FeatureConfiguration(enabled=True)
        await repo.set("user1", "feat", config)

        record = await repo.update("user1", "feat", {"enabled": False})
        assert record.config.enabled is False

    @pytest.mark.asyncio
    async def test_update_with_schema_defaults(self, repo_with_schema):
        """Update on non-existent config uses schema defaults."""
        record = await repo_with_schema.update(
            "user1", "vocab_learning",
            {"custom_settings": {"words_per_day": 20}},
        )
        # Should have schema defaults + override
        assert record.config.custom_settings["words_per_day"] == 20
        # Other defaults from schema should be present
        assert "difficulty_level" in record.config.custom_settings


class TestUpdateCustomSetting:
    @pytest.mark.asyncio
    async def test_update_single_setting(self, repo):
        config = FeatureConfiguration(
            custom_settings={"a": 1, "b": 2},
        )
        await repo.set("user1", "feat", config)

        record = await repo.update_custom_setting("user1", "feat", "a", 100)
        assert record.config.custom_settings["a"] == 100
        assert record.config.custom_settings["b"] == 2

    @pytest.mark.asyncio
    async def test_update_adds_new_setting(self, repo):
        config = FeatureConfiguration(custom_settings={"a": 1})
        await repo.set("user1", "feat", config)

        record = await repo.update_custom_setting("user1", "feat", "new_key", "new_val")
        assert record.config.custom_settings["new_key"] == "new_val"
        assert record.config.custom_settings["a"] == 1


class TestDelete:
    @pytest.mark.asyncio
    async def test_delete_existing(self, repo):
        await repo.set("user1", "feat", FeatureConfiguration())
        assert await repo.delete("user1", "feat") is True
        assert await repo.get("user1", "feat") is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, repo):
        assert await repo.delete("user1", "nonexistent") is False

    @pytest.mark.asyncio
    async def test_delete_does_not_affect_other_features(self, repo):
        await repo.set("user1", "feat_a", FeatureConfiguration())
        await repo.set("user1", "feat_b", FeatureConfiguration())
        await repo.delete("user1", "feat_a")

        assert await repo.get("user1", "feat_a") is None
        assert await repo.get("user1", "feat_b") is not None


class TestDeleteAll:
    @pytest.mark.asyncio
    async def test_delete_all(self, repo):
        await repo.set("user1", "feat_a", FeatureConfiguration())
        await repo.set("user1", "feat_b", FeatureConfiguration())
        count = await repo.delete_all("user1")
        assert count == 2
        assert await repo.get_all("user1") == {}

    @pytest.mark.asyncio
    async def test_delete_all_empty(self, repo):
        count = await repo.delete_all("user1")
        assert count == 0

    @pytest.mark.asyncio
    async def test_delete_all_does_not_affect_other_users(self, repo):
        await repo.set("user1", "feat", FeatureConfiguration())
        await repo.set("user2", "feat", FeatureConfiguration())
        await repo.delete_all("user1")

        assert await repo.get("user1", "feat") is None
        assert await repo.get("user2", "feat") is not None


# ---------------------------------------------------------------------------
# Schema management tests
# ---------------------------------------------------------------------------


class TestSchemaManagement:
    def test_register_schema(self, repo, vocab_schema):
        repo.register_schema(vocab_schema)
        assert repo.get_schema("vocab_learning") is not None
        assert repo.get_schema("vocab_learning").feature_name == "vocab_learning"

    def test_unregister_schema(self, repo, vocab_schema):
        repo.register_schema(vocab_schema)
        removed = repo.unregister_schema("vocab_learning")
        assert removed is not None
        assert repo.get_schema("vocab_learning") is None

    def test_unregister_nonexistent(self, repo):
        assert repo.unregister_schema("nope") is None

    def test_list_schemas(self, repo, vocab_schema):
        repo.register_schema(vocab_schema)
        schemas = repo.list_schemas()
        assert "vocab_learning" in schemas

    def test_constructor_with_schemas(self, prefs_repo, vocab_schema):
        repo = FeatureConfigRepository(prefs_repo, schemas={"vocab_learning": vocab_schema})
        assert repo.get_schema("vocab_learning") is not None


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


class TestValidation:
    def test_validate_valid_config(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 10, "difficulty_level": "hard"},
        )
        errors, warnings = repo_with_schema.validate("vocab_learning", config)
        assert errors == []

    def test_validate_invalid_config(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 999},
        )
        errors, warnings = repo_with_schema.validate("vocab_learning", config)
        assert len(errors) > 0

    def test_validate_unknown_settings_are_warnings(self, repo_with_schema):
        config = FeatureConfiguration(
            custom_settings={"unknown_key": "value"},
        )
        errors, warnings = repo_with_schema.validate("vocab_learning", config)
        assert len(warnings) > 0
        assert any("Unknown setting" in w for w in warnings)

    def test_validate_no_schema_returns_empty(self, repo):
        config = FeatureConfiguration(custom_settings={"anything": "goes"})
        errors, warnings = repo.validate("no_schema", config)
        assert errors == []
        assert warnings == []

    def test_validate_unsupported_frequency(self, repo_with_schema):
        # Create a schema that doesn't support frequency
        no_freq_schema = FeatureConfigSchema(
            feature_name="no_freq",
            supports_frequency=False,
        )
        repo_with_schema.register_schema(no_freq_schema)
        config = FeatureConfiguration(
            frequency=FrequencyConfig(value=3),
        )
        errors, warnings = repo_with_schema.validate("no_freq", config)
        assert any("does not support frequency" in e for e in errors)


# ---------------------------------------------------------------------------
# Global schema registry tests
# ---------------------------------------------------------------------------


class TestGlobalSchemaRegistry:
    def setup_method(self):
        reset_schema_registry()

    def teardown_method(self):
        reset_schema_registry()

    def test_register_and_get(self, vocab_schema):
        register_global_schema(vocab_schema)
        registry = get_schema_registry()
        assert "vocab_learning" in registry
        assert registry["vocab_learning"].feature_name == "vocab_learning"

    def test_reset_clears_registry(self, vocab_schema):
        register_global_schema(vocab_schema)
        reset_schema_registry()
        assert get_schema_registry() == {}

    def test_registry_returns_copy(self, vocab_schema):
        register_global_schema(vocab_schema)
        r1 = get_schema_registry()
        r2 = get_schema_registry()
        # Modifying the returned dict doesn't affect the original
        r1.clear()
        assert len(r2) == 1


# ---------------------------------------------------------------------------
# Protocol conformance test
# ---------------------------------------------------------------------------


class TestProtocolConformance:
    def test_repo_satisfies_protocol(self, repo):
        """FeatureConfigRepository satisfies FeatureConfigRepositoryProtocol."""
        assert isinstance(repo, FeatureConfigRepositoryProtocol)


# ---------------------------------------------------------------------------
# Serialization edge cases
# ---------------------------------------------------------------------------


class TestSerializationEdgeCases:
    @pytest.mark.asyncio
    async def test_corrupt_data_returns_none(self, prefs_repo, repo):
        """If stored data can't be deserialized, get returns None."""
        # Manually store non-config data
        await prefs_repo.set("user1", f"{_FEATURE_CONFIG_PREFIX}bad", "not a dict")
        result = await repo.get("user1", "bad")
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_config_roundtrip(self, repo):
        config = FeatureConfiguration()
        await repo.set("user1", "feat", config)
        result = await repo.get("user1", "feat")
        assert result is not None
        assert result.enabled is True
        assert result.custom_settings == {}

    @pytest.mark.asyncio
    async def test_nested_custom_settings_roundtrip(self, repo):
        config = FeatureConfiguration(
            custom_settings={
                "nested": {"deep": {"value": 42}},
                "list_val": [1, 2, 3],
            },
        )
        await repo.set("user1", "feat", config)
        result = await repo.get("user1", "feat")
        assert result.custom_settings["nested"]["deep"]["value"] == 42
        assert result.custom_settings["list_val"] == [1, 2, 3]
