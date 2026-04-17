"""Tests for preference-aware vocabulary content selection.

Validates that the PersonalizedContentSelector:
1. Queries user preferences and applies them to filter content.
2. Ranks items by preference alignment (difficulty, topic, category).
3. Respects count limits and word exclusions.
4. Falls back to defaults when no preferences are stored.
5. Works with explicit config (no repo round-trip).
6. Adjusts selection for different intents (quiz, flashcard, daily_word).
7. Handles edge cases (empty repo, missing config, empty results).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.models.feature_config import (
    DifficultyConfig,
    DifficultyLevel,
    FeatureConfigSchema,
    FeatureConfiguration,
    FrequencyConfig,
    FrequencyUnit,
)
from app.plugins.vocab_content_engine import (
    BuiltinVocabDataSource,
    ContentFilter,
    VocabContentEngine,
    VocabItem,
)
from app.plugins.vocab_content_selector import (
    DEFAULT_WEIGHTS,
    ItemScorer,
    PersonalizedContentSelector,
    RankingWeights,
    ScoredItem,
    SelectionResult,
    resolve_user_config,
)
from app.services.feature_config_repository import FeatureConfigRepositoryProtocol
from app.services.preferences_repository_protocol import (
    PreferenceRecord,
    PreferencesRepository,
    PreferenceValue,
)


# ---------------------------------------------------------------------------
# In-memory stubs for testing
# ---------------------------------------------------------------------------


class InMemoryPreferencesRepo:
    """Minimal in-memory preferences repo for testing."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    async def get(self, user_id: str, preference_key: str) -> PreferenceRecord | None:
        user_prefs = self._store.get(user_id, {})
        value = user_prefs.get(preference_key)
        if value is None:
            return None
        return PreferenceRecord(
            id="test", user_id=user_id,
            preference_key=preference_key, preference_value=value,
        )

    async def get_all(
        self, user_id: str, *, prefix: str | None = None
    ) -> list[PreferenceRecord]:
        user_prefs = self._store.get(user_id, {})
        records = []
        for key, value in user_prefs.items():
            if prefix and not key.startswith(prefix):
                continue
            records.append(PreferenceRecord(
                id="test", user_id=user_id,
                preference_key=key, preference_value=value,
            ))
        return records

    async def set(
        self, user_id: str, preference_key: str, preference_value: PreferenceValue
    ) -> PreferenceRecord:
        self._store.setdefault(user_id, {})[preference_key] = preference_value
        return PreferenceRecord(
            id="test", user_id=user_id,
            preference_key=preference_key, preference_value=preference_value,
        )

    async def set_bulk(
        self, user_id: str, preferences: dict[str, PreferenceValue]
    ) -> list[PreferenceRecord]:
        records = []
        for key, value in preferences.items():
            records.append(await self.set(user_id, key, value))
        return records

    async def delete(self, user_id: str, preference_key: str) -> bool:
        user_prefs = self._store.get(user_id, {})
        if preference_key in user_prefs:
            del user_prefs[preference_key]
            return True
        return False


class StubFeatureConfigRepo:
    """In-memory FeatureConfigRepository stub for testing."""

    def __init__(self) -> None:
        self._configs: dict[str, dict[str, FeatureConfiguration]] = {}

    async def get(
        self, user_id: str, feature_name: str
    ) -> FeatureConfiguration | None:
        return self._configs.get(user_id, {}).get(feature_name)

    async def get_or_default(
        self, user_id: str, feature_name: str,
        schema: FeatureConfigSchema | None = None,
    ) -> FeatureConfiguration:
        existing = await self.get(user_id, feature_name)
        if existing is not None:
            return existing
        return FeatureConfiguration()

    async def get_all(self, user_id: str) -> dict[str, FeatureConfiguration]:
        return dict(self._configs.get(user_id, {}))

    async def set(
        self, user_id: str, feature_name: str, config: FeatureConfiguration
    ):
        self._configs.setdefault(user_id, {})[feature_name] = config

    async def update(
        self, user_id: str, feature_name: str, overrides: dict[str, Any]
    ):
        existing = await self.get_or_default(user_id, feature_name)
        updated = existing.merge_with(overrides)
        await self.set(user_id, feature_name, updated)

    async def delete(self, user_id: str, feature_name: str) -> bool:
        user_configs = self._configs.get(user_id, {})
        if feature_name in user_configs:
            del user_configs[feature_name]
            return True
        return False

    async def delete_all(self, user_id: str) -> int:
        count = len(self._configs.get(user_id, {}))
        self._configs.pop(user_id, None)
        return count

    # Helper for tests
    def store_config(
        self, user_id: str, feature_name: str, config: FeatureConfiguration
    ) -> None:
        self._configs.setdefault(user_id, {})[feature_name] = config


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def engine() -> VocabContentEngine:
    return VocabContentEngine()


@pytest.fixture
def config_repo() -> StubFeatureConfigRepo:
    return StubFeatureConfigRepo()


@pytest.fixture
def scorer() -> ItemScorer:
    return ItemScorer()


@pytest.fixture
def selector(engine, config_repo) -> PersonalizedContentSelector:
    return PersonalizedContentSelector(
        engine=engine,
        config_repo=config_repo,
    )


# ---------------------------------------------------------------------------
# resolve_user_config tests
# ---------------------------------------------------------------------------


class TestResolveUserConfig:
    def test_none_config_returns_defaults(self):
        """When no feature config exists, plugin defaults are returned."""
        defaults = {"difficulty_level": "easy", "words_per_day": 3}
        result = resolve_user_config(None, defaults)
        assert result == defaults

    def test_custom_settings_override_defaults(self):
        """User's custom_settings override plugin defaults."""
        defaults = {"difficulty_level": "easy", "words_per_day": 3}
        config = FeatureConfiguration(
            custom_settings={"difficulty_level": "hard", "words_per_day": 10}
        )
        result = resolve_user_config(config, defaults)
        assert result["difficulty_level"] == "hard"
        assert result["words_per_day"] == 10

    def test_difficulty_config_applied(self):
        """Structured DifficultyConfig maps to flat difficulty_level."""
        config = FeatureConfiguration(
            difficulty=DifficultyConfig(
                level=DifficultyLevel.HARD,
                adaptive=True,
                min_level=DifficultyLevel.MEDIUM,
                max_level=DifficultyLevel.EXPERT,
                progression_threshold=0.9,
            )
        )
        result = resolve_user_config(config)
        assert result["difficulty_level"] == "hard"
        assert result["adaptive_difficulty"] is True
        assert result["min_difficulty"] == "medium"
        assert result["max_difficulty"] == "expert"
        assert result["progression_threshold"] == 0.9

    def test_frequency_caps_words_per_day(self):
        """FrequencyConfig.max_per_day caps the words_per_day setting."""
        config = FeatureConfiguration(
            custom_settings={"words_per_day": 20},
            frequency=FrequencyConfig(
                value=1, unit=FrequencyUnit.DAILY, max_per_day=10
            ),
        )
        defaults = {"words_per_day": 5}
        result = resolve_user_config(config, defaults)
        assert result["words_per_day"] == 10  # capped by max_per_day

    def test_empty_feature_config_returns_defaults(self):
        """An empty FeatureConfiguration still falls back to defaults."""
        defaults = {"target_language": "en", "words_per_day": 5}
        config = FeatureConfiguration()
        result = resolve_user_config(config, defaults)
        assert result["target_language"] == "en"
        assert result["words_per_day"] == 5

    def test_custom_settings_additive(self):
        """Custom settings add new keys not in defaults."""
        defaults = {"difficulty_level": "medium"}
        config = FeatureConfiguration(
            custom_settings={"target_language": "es", "topic_categories": ["food"]}
        )
        result = resolve_user_config(config, defaults)
        assert result["difficulty_level"] == "medium"
        assert result["target_language"] == "es"
        assert result["topic_categories"] == ["food"]


# ---------------------------------------------------------------------------
# ItemScorer tests
# ---------------------------------------------------------------------------


class TestItemScorer:
    def test_exact_difficulty_match_scores_highest(self, scorer):
        """Item matching the target difficulty should score highest."""
        item = VocabItem(
            word="test", definition="A trial",
            difficulty="medium", topic="general", category="words",
            example="This is a test.", part_of_speech="noun",
        )
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["general"],
            "content_categories": ["words"],
            "include_examples": True,
            "include_part_of_speech": True,
        }
        scored = scorer.score(item, config)
        assert scored.score > 0
        assert "difficulty_match" in scored.score_breakdown

    def test_difficulty_mismatch_scores_lower(self, scorer):
        """Item with wrong difficulty should score lower than exact match."""
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["general"],
            "content_categories": ["words"],
        }
        match_item = VocabItem(
            word="match", definition="Exact match",
            difficulty="medium", topic="general", category="words",
        )
        miss_item = VocabItem(
            word="miss", definition="Wrong difficulty",
            difficulty="hard", topic="general", category="words",
        )
        match_scored = scorer.score(match_item, config)
        miss_scored = scorer.score(miss_item, config)
        assert match_scored.score > miss_scored.score

    def test_adjacent_difficulty_gets_partial_score(self, scorer):
        """Adjacent difficulty levels get a partial score, not zero."""
        config = {"difficulty_level": "medium", "topic_categories": ["general"],
                  "content_categories": ["words"]}
        adjacent_item = VocabItem(
            word="adj", definition="Adjacent",
            difficulty="easy", topic="general", category="words",
        )
        far_item = VocabItem(
            word="far", definition="Far away difficulty",
            difficulty="easy", topic="general", category="words",
        )
        # easy is adjacent to medium
        scored = scorer.score(adjacent_item, config)
        assert "difficulty_adjacent" in scored.score_breakdown
        assert scored.score_breakdown["difficulty_adjacent"] > 0

    def test_topic_match_bonus(self, scorer):
        """Items matching preferred topics get a topic bonus."""
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["science"],
            "content_categories": ["words"],
        }
        science_item = VocabItem(
            word="sci", definition="Science word",
            difficulty="medium", topic="science", category="words",
        )
        food_item = VocabItem(
            word="food", definition="Food word",
            difficulty="medium", topic="food", category="words",
        )
        sci_scored = scorer.score(science_item, config)
        food_scored = scorer.score(food_item, config)
        assert sci_scored.score > food_scored.score

    def test_category_match_bonus(self, scorer):
        """Items matching preferred categories get a category bonus."""
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["general"],
            "content_categories": ["idioms"],
        }
        idiom_item = VocabItem(
            word="bite", definition="An idiom",
            difficulty="medium", topic="general", category="idioms",
        )
        word_item = VocabItem(
            word="word", definition="A word",
            difficulty="medium", topic="general", category="words",
        )
        idiom_scored = scorer.score(idiom_item, config)
        word_scored = scorer.score(word_item, config)
        assert idiom_scored.score > word_scored.score

    def test_example_bonus_when_enabled(self, scorer):
        """Items with examples get a bonus when include_examples is True."""
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["general"],
            "content_categories": ["words"],
            "include_examples": True,
        }
        with_example = VocabItem(
            word="ex", definition="Has example",
            difficulty="medium", topic="general", category="words",
            example="Here is an example.",
        )
        without_example = VocabItem(
            word="no_ex", definition="No example",
            difficulty="medium", topic="general", category="words",
            example="",
        )
        ex_scored = scorer.score(with_example, config)
        no_ex_scored = scorer.score(without_example, config)
        assert ex_scored.score > no_ex_scored.score

    def test_score_batch_returns_sorted(self, scorer):
        """score_batch should return items sorted by score descending."""
        items = [
            VocabItem(word="low", definition="Low score",
                      difficulty="hard", topic="food", category="idioms"),
            VocabItem(word="high", definition="High score",
                      difficulty="medium", topic="general", category="words",
                      example="Example.", part_of_speech="noun"),
        ]
        config = {
            "difficulty_level": "medium",
            "topic_categories": ["general"],
            "content_categories": ["words"],
            "include_examples": True,
            "include_part_of_speech": True,
        }
        scored = scorer.score_batch(items, config)
        assert len(scored) == 2
        assert scored[0].score >= scored[1].score
        assert scored[0].item.word == "high"

    def test_custom_weights(self):
        """Custom weights should change scoring priorities."""
        weights = RankingWeights(
            difficulty_match=0.1,
            topic_match=5.0,  # heavily prioritize topic
            category_match=0.1,
        )
        scorer = ItemScorer(weights=weights)
        config = {
            "difficulty_level": "hard",
            "topic_categories": ["science"],
            "content_categories": ["words"],
        }
        # Wrong difficulty but right topic
        topic_item = VocabItem(
            word="topic", definition="Right topic",
            difficulty="easy", topic="science", category="words",
        )
        # Right difficulty but wrong topic
        diff_item = VocabItem(
            word="diff", definition="Right difficulty",
            difficulty="hard", topic="food", category="words",
        )
        topic_scored = scorer.score(topic_item, config)
        diff_scored = scorer.score(diff_item, config)
        # Topic should win because of the high topic weight
        assert topic_scored.score > diff_scored.score


# ---------------------------------------------------------------------------
# PersonalizedContentSelector — integration tests
# ---------------------------------------------------------------------------


class TestPersonalizedContentSelector:
    @pytest.mark.asyncio
    async def test_select_with_no_stored_preferences(self, selector):
        """When no preferences are stored, defaults are used."""
        result = await selector.select_for_user("user-new")
        assert not result.is_empty
        assert result.user_id == "user-new"
        assert result.resolved_config["difficulty_level"] == "medium"
        assert result.resolved_config["target_language"] == "en"

    @pytest.mark.asyncio
    async def test_select_with_stored_preferences(self, selector, config_repo):
        """Stored preferences should drive content selection."""
        config_repo.store_config("user-1", "vocab_learning", FeatureConfiguration(
            custom_settings={
                "difficulty_level": "hard",
                "target_language": "en",
                "content_categories": ["words"],
                "words_per_day": 3,
            }
        ))
        result = await selector.select_for_user("user-1")
        assert not result.is_empty
        assert result.resolved_config["difficulty_level"] == "hard"
        assert len(result.items) <= 3

    @pytest.mark.asyncio
    async def test_select_respects_count_override(self, selector):
        """Explicit count parameter should override words_per_day."""
        result = await selector.select_for_user("user-2", count=2)
        assert len(result.items) <= 2

    @pytest.mark.asyncio
    async def test_select_excludes_words(self, selector):
        """Excluded words should not appear in results."""
        # First get some words
        result1 = await selector.select_for_user("user-3", count=3)
        excluded = [si.item.word for si in result1.items]

        # Now exclude them
        result2 = await selector.select_for_user(
            "user-3", count=10, exclude_words=excluded
        )
        result_words = {si.item.word for si in result2.items}
        for w in excluded:
            assert w not in result_words

    @pytest.mark.asyncio
    async def test_select_with_difficulty_config(self, selector, config_repo):
        """Structured DifficultyConfig should be resolved correctly."""
        config_repo.store_config("user-4", "vocab_learning", FeatureConfiguration(
            difficulty=DifficultyConfig(
                level=DifficultyLevel.EASY,
                adaptive=False,
            ),
            custom_settings={
                "target_language": "en",
                "content_categories": ["words"],
                "words_per_day": 3,
            },
        ))
        result = await selector.select_for_user("user-4")
        assert result.resolved_config["difficulty_level"] == "easy"

    @pytest.mark.asyncio
    async def test_select_with_frequency_cap(self, selector, config_repo):
        """FrequencyConfig.max_per_day should cap words_per_day."""
        config_repo.store_config("user-5", "vocab_learning", FeatureConfiguration(
            custom_settings={"words_per_day": 20},
            frequency=FrequencyConfig(
                value=1, unit=FrequencyUnit.DAILY, max_per_day=5
            ),
        ))
        result = await selector.select_for_user("user-5")
        assert result.resolved_config["words_per_day"] == 5
        assert len(result.items) <= 5

    @pytest.mark.asyncio
    async def test_items_are_scored_and_ranked(self, selector):
        """Returned items should have scores and be in descending order."""
        result = await selector.select_for_user("user-6", count=5)
        assert not result.is_empty
        scores = [si.score for si in result.items]
        # Should be in descending order
        assert scores == sorted(scores, reverse=True)
        # Each item should have a score breakdown
        for si in result.items:
            assert isinstance(si.score_breakdown, dict)
            assert si.score > 0

    @pytest.mark.asyncio
    async def test_select_with_topic_preference(self, selector, config_repo):
        """Topic preferences should influence item selection."""
        config_repo.store_config("user-7", "vocab_learning", FeatureConfiguration(
            custom_settings={
                "difficulty_level": "medium",
                "target_language": "en",
                "content_categories": ["words"],
                "topic_categories": ["science"],
                "words_per_day": 5,
            }
        ))
        result = await selector.select_for_user("user-7")
        assert not result.is_empty
        # Top-scored items should preferentially be science topics
        # (but may include others if pool is small)
        top_item = result.items[0]
        assert top_item.score_breakdown.get("topic_match", 0) > 0

    @pytest.mark.asyncio
    async def test_select_with_category_preference(self, selector, config_repo):
        """Category preferences should influence ranking."""
        config_repo.store_config("user-8", "vocab_learning", FeatureConfiguration(
            custom_settings={
                "difficulty_level": "medium",
                "target_language": "en",
                "content_categories": ["idioms"],
                "words_per_day": 3,
            }
        ))
        result = await selector.select_for_user("user-8")
        assert not result.is_empty
        # Items should be idioms (matching the category preference)
        for si in result.items:
            assert si.item.category == "idioms"

    @pytest.mark.asyncio
    async def test_select_for_user_with_config(self, selector):
        """select_for_user_with_config should work without repo lookup."""
        result = await selector.select_for_user_with_config(
            "user-9",
            {
                "difficulty_level": "easy",
                "target_language": "en",
                "content_categories": ["words"],
                "words_per_day": 3,
            },
        )
        assert not result.is_empty
        assert len(result.items) <= 3
        assert result.resolved_config["difficulty_level"] == "easy"

    @pytest.mark.asyncio
    async def test_select_no_repo_uses_defaults(self, engine):
        """Selector without a repo should use defaults only."""
        selector = PersonalizedContentSelector(engine=engine, config_repo=None)
        result = await selector.select_for_user("user-no-repo")
        assert not result.is_empty
        assert result.resolved_config["difficulty_level"] == "medium"

    @pytest.mark.asyncio
    async def test_select_empty_engine(self, config_repo):
        """Empty data source should return empty result with warning."""
        empty_engine = VocabContentEngine(
            data_source=BuiltinVocabDataSource(data=[])
        )
        selector = PersonalizedContentSelector(
            engine=empty_engine, config_repo=config_repo
        )
        result = await selector.select_for_user("user-empty")
        assert result.is_empty
        assert len(result.warnings) > 0

    @pytest.mark.asyncio
    async def test_intent_quiz_adjusts_count(self, selector):
        """Quiz intent should ensure at least 4 items."""
        result = await selector.select_for_user(
            "user-quiz", count=2, intent="quiz"
        )
        # Quiz forces min count of 4, so resolved config should reflect that
        assert result.resolved_config.get("words_per_day", 0) >= 4

    @pytest.mark.asyncio
    async def test_intent_flashcard_enables_examples(self, selector, config_repo):
        """Flashcard intent should enable include_examples."""
        config_repo.store_config("user-fc", "vocab_learning", FeatureConfiguration(
            custom_settings={"include_examples": False, "words_per_day": 3}
        ))
        result = await selector.select_for_user("user-fc", intent="flashcard")
        assert result.resolved_config["include_examples"] is True


# ---------------------------------------------------------------------------
# SelectionResult model tests
# ---------------------------------------------------------------------------


class TestSelectionResult:
    def test_is_empty(self):
        result = SelectionResult(user_id="u1")
        assert result.is_empty

    def test_not_empty(self):
        item = ScoredItem(
            item=VocabItem(word="test", definition="A test"),
            score=1.0,
        )
        result = SelectionResult(user_id="u1", items=[item])
        assert not result.is_empty

    def test_top_items(self):
        items = [
            ScoredItem(
                item=VocabItem(word="a", definition="First"), score=2.0
            ),
            ScoredItem(
                item=VocabItem(word="b", definition="Second"), score=1.0
            ),
        ]
        result = SelectionResult(user_id="u1", items=items)
        top = result.top_items
        assert len(top) == 2
        assert top[0].word == "a"
        assert top[1].word == "b"

    def test_to_dict(self):
        item = ScoredItem(
            item=VocabItem(word="test", definition="A test"),
            score=1.5,
            score_breakdown={"difficulty_match": 1.0, "topic_match": 0.5},
        )
        result = SelectionResult(
            user_id="u1", items=[item],
            resolved_config={"difficulty_level": "medium"},
            total_candidates=10,
        )
        d = result.to_dict()
        assert d["user_id"] == "u1"
        assert len(d["items"]) == 1
        assert d["items"][0]["score"] == 1.5
        assert d["total_candidates"] == 10


# ---------------------------------------------------------------------------
# ScoredItem model tests
# ---------------------------------------------------------------------------


class TestScoredItem:
    def test_to_dict(self):
        item = ScoredItem(
            item=VocabItem(word="hello", definition="Greeting"),
            score=2.3456,
            score_breakdown={"a": 1.1111, "b": 1.2345},
        )
        d = item.to_dict()
        assert d["score"] == 2.3456
        assert d["score_breakdown"]["a"] == 1.1111
        assert d["item"]["word"] == "hello"

    def test_default_breakdown(self):
        item = ScoredItem(
            item=VocabItem(word="x", definition="y"),
        )
        assert item.score_breakdown == {}
        assert item.score == 0.0
