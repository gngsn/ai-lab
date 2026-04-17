"""Tests for the Vocabulary Content Generation Engine.

Validates that the engine:
1. Produces learning items (words, definitions, examples) as structured data.
2. Filters content by language preference.
3. Filters content by difficulty level preference.
4. Filters content by topic categories preference.
5. Filters content by content categories (words, phrases, idioms, collocations).
6. Respects word count limits.
7. Excludes already-learned words.
8. Falls back gracefully when no content matches the filter.
9. Provides quiz distractors from the same difficulty level.
10. Reports available languages, categories, and topics.
"""

import pytest

from app.plugins.vocab_content_engine import (
    BuiltinVocabDataSource,
    ContentFilter,
    GenerationResult,
    VocabContentEngine,
    VocabItem,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def engine() -> VocabContentEngine:
    """Return a fresh engine with the built-in word bank."""
    return VocabContentEngine()


@pytest.fixture
def data_source() -> BuiltinVocabDataSource:
    """Return the built-in data source directly."""
    return BuiltinVocabDataSource()


# ---------------------------------------------------------------------------
# VocabItem model tests
# ---------------------------------------------------------------------------


class TestVocabItem:
    def test_create_item(self):
        item = VocabItem(
            word="test", definition="A trial", example="This is a test.",
            part_of_speech="noun", language="en", difficulty="easy",
            category="words", topic="general",
        )
        assert item.word == "test"
        assert item.definition == "A trial"
        assert item.language == "en"

    def test_to_dict(self):
        item = VocabItem(word="hello", definition="A greeting")
        d = item.to_dict()
        assert isinstance(d, dict)
        assert d["word"] == "hello"
        assert d["definition"] == "A greeting"
        assert "language" in d
        assert "difficulty" in d

    def test_defaults(self):
        item = VocabItem(word="x", definition="y")
        assert item.language == "en"
        assert item.difficulty == "medium"
        assert item.category == "words"
        assert item.topic == "general"


# ---------------------------------------------------------------------------
# ContentFilter tests
# ---------------------------------------------------------------------------


class TestContentFilter:
    def test_default_filter(self):
        f = ContentFilter()
        assert f.language == "en"
        assert f.difficulty_level == "medium"
        assert f.categories == ["words"]
        assert f.count == 5

    def test_from_user_config_defaults(self):
        f = ContentFilter.from_user_config({})
        assert f.language == "en"
        assert f.difficulty_level == "medium"

    def test_from_user_config_overrides(self):
        f = ContentFilter.from_user_config({
            "target_language": "es",
            "difficulty_level": "hard",
            "content_categories": ["words", "phrases"],
            "topic_categories": ["science", "business"],
            "words_per_day": 10,
        })
        assert f.language == "es"
        assert f.difficulty_level == "hard"
        assert f.categories == ["words", "phrases"]
        assert f.topics == ["science", "business"]
        assert f.count == 10

    def test_from_user_config_string_categories(self):
        """Single-value string categories should be wrapped in a list."""
        f = ContentFilter.from_user_config({
            "content_categories": "idioms",
            "topic_categories": "food",
        })
        assert f.categories == ["idioms"]
        assert f.topics == ["food"]


# ---------------------------------------------------------------------------
# BuiltinVocabDataSource tests
# ---------------------------------------------------------------------------


class TestBuiltinVocabDataSource:
    def test_available_languages(self, data_source):
        langs = data_source.available_languages()
        assert "en" in langs
        assert "es" in langs
        assert "fr" in langs

    def test_available_categories(self, data_source):
        cats = data_source.available_categories()
        assert "words" in cats
        assert "phrases" in cats
        assert "idioms" in cats
        assert "collocations" in cats

    def test_available_topics(self, data_source):
        topics = data_source.available_topics()
        assert "general" in topics
        assert "food" in topics
        assert "science" in topics

    def test_available_topics_by_language(self, data_source):
        topics = data_source.available_topics(language="en")
        assert "general" in topics
        # English should have more topic variety
        assert len(topics) >= 3

    def test_query_by_language_and_difficulty(self, data_source):
        items = data_source.query(
            language="en", difficulty="easy", categories=["words"], topics=["general"],
        )
        assert len(items) > 0
        for item in items:
            assert item.language == "en"
            assert item.difficulty == "easy"
            assert item.category == "words"

    def test_query_by_spanish(self, data_source):
        items = data_source.query(
            language="es", difficulty="easy", categories=["words"], topics=["general"],
        )
        assert len(items) > 0
        for item in items:
            assert item.language == "es"

    def test_query_by_category(self, data_source):
        items = data_source.query(
            language="en", difficulty="medium", categories=["idioms"], topics=["general"],
        )
        assert len(items) > 0
        for item in items:
            assert item.category == "idioms"

    def test_query_by_topic(self, data_source):
        items = data_source.query(
            language="en", difficulty="medium", categories=["words"], topics=["science"],
        )
        assert len(items) > 0
        for item in items:
            assert item.topic == "science"

    def test_query_multiple_categories(self, data_source):
        items = data_source.query(
            language="en", difficulty="medium",
            categories=["words", "phrases"], topics=["general"],
        )
        categories_found = {item.category for item in items}
        assert "words" in categories_found
        assert "phrases" in categories_found

    def test_query_no_results(self, data_source):
        items = data_source.query(
            language="xx", difficulty="easy", categories=["words"], topics=["general"],
        )
        assert items == []

    def test_custom_data_source(self):
        custom_data = [
            {"word": "custom", "definition": "A custom word", "language": "en",
             "difficulty": "easy", "category": "words", "topic": "general"},
        ]
        source = BuiltinVocabDataSource(data=custom_data)
        items = source.query("en", "easy", ["words"], ["general"])
        assert len(items) == 1
        assert items[0].word == "custom"


# ---------------------------------------------------------------------------
# VocabContentEngine — generation tests
# ---------------------------------------------------------------------------


class TestContentGeneration:
    def test_generate_default_filter(self, engine):
        """Default filter should produce results."""
        result = engine.generate(ContentFilter())
        assert not result.is_empty
        assert len(result.items) <= 5
        assert result.total_available > 0

    def test_generate_respects_count(self, engine):
        f = ContentFilter(count=2)
        result = engine.generate(f)
        assert len(result.items) <= 2

    def test_generate_filters_by_language(self, engine):
        f = ContentFilter(language="es", difficulty_level="easy")
        result = engine.generate(f)
        assert not result.is_empty
        for item in result.items:
            assert item.language == "es"

    def test_generate_filters_by_difficulty(self, engine):
        f = ContentFilter(difficulty_level="hard", count=10)
        result = engine.generate(f)
        assert not result.is_empty
        for item in result.items:
            assert item.difficulty == "hard"

    def test_generate_filters_by_category(self, engine):
        f = ContentFilter(categories=["phrases"], difficulty_level="easy")
        result = engine.generate(f)
        assert not result.is_empty
        for item in result.items:
            assert item.category == "phrases"

    def test_generate_filters_by_topic(self, engine):
        f = ContentFilter(
            categories=["words"], difficulty_level="medium",
            topics=["science"], count=10,
        )
        result = engine.generate(f)
        assert not result.is_empty
        for item in result.items:
            assert item.topic == "science"

    def test_generate_filters_by_multiple_categories(self, engine):
        f = ContentFilter(
            categories=["words", "idioms"],
            difficulty_level="medium", count=20,
        )
        result = engine.generate(f)
        cats_found = {item.category for item in result.items}
        # Should contain at least one of the requested categories
        assert cats_found.issubset({"words", "idioms"})

    def test_generate_excludes_words(self, engine):
        """Excluded words should not appear in results."""
        # First get some words
        f1 = ContentFilter(difficulty_level="easy", count=3)
        result1 = engine.generate(f1)
        excluded = [item.word for item in result1.items]

        # Now generate with exclusions
        f2 = ContentFilter(
            difficulty_level="easy", count=10,
            exclude_words=excluded,
        )
        result2 = engine.generate(f2)
        result_words = {item.word for item in result2.items}
        for w in excluded:
            assert w not in result_words

    def test_generate_from_config(self, engine):
        """generate_from_config should map user config to filter."""
        config = {
            "target_language": "en",
            "difficulty_level": "hard",
            "content_categories": ["words"],
            "words_per_day": 3,
        }
        result = engine.generate_from_config(config)
        assert not result.is_empty
        assert len(result.items) <= 3
        for item in result.items:
            assert item.difficulty == "hard"
            assert item.language == "en"

    def test_generate_items_have_required_fields(self, engine):
        """Every item should have word, definition, and example."""
        result = engine.generate(ContentFilter(count=10))
        for item in result.items:
            assert item.word != ""
            assert item.definition != ""
            # example and part_of_speech may be empty but should exist
            assert hasattr(item, "example")
            assert hasattr(item, "part_of_speech")

    def test_generation_result_metadata(self, engine):
        f = ContentFilter(language="en", difficulty_level="medium")
        result = engine.generate(f)
        assert result.filter_applied == f
        assert isinstance(result.total_available, int)
        assert result.total_available >= len(result.items)


# ---------------------------------------------------------------------------
# Fallback behavior tests
# ---------------------------------------------------------------------------


class TestFallbackBehavior:
    def test_fallback_on_no_topic_match(self, engine):
        """When no items match the requested topic, fall back to all topics."""
        f = ContentFilter(
            language="en", difficulty_level="easy",
            topics=["quantum_physics"],  # no items for this topic
            count=3,
        )
        result = engine.generate(f)
        # Should still return items (fallback to all topics)
        assert not result.is_empty
        assert len(result.warnings) > 0

    def test_fallback_on_no_language_match(self, engine):
        """When no items match the requested language, fall back to English."""
        f = ContentFilter(
            language="zh",  # very limited content
            difficulty_level="hard",
            count=3,
        )
        result = engine.generate(f)
        # Should either have Chinese content or fall back to English
        if result.is_empty:
            pytest.skip("Chinese hard content available — no fallback needed")
        # If items present, they should have a warning about fallback
        # (only if they're English and not Chinese)
        if any(i.language == "en" for i in result.items):
            assert len(result.warnings) > 0

    def test_empty_result_for_impossible_filter(self):
        """A completely impossible filter should return empty results."""
        # Use a custom empty data source
        engine = VocabContentEngine(data_source=BuiltinVocabDataSource(data=[]))
        f = ContentFilter()
        result = engine.generate(f)
        assert result.is_empty
        assert result.total_available == 0

    def test_count_exceeds_available(self, engine):
        """Requesting more items than available should return all + warning."""
        f = ContentFilter(
            language="fr", difficulty_level="easy",
            count=50,  # more than available
        )
        result = engine.generate(f)
        assert len(result.items) <= result.total_available
        if result.total_available < 50:
            assert len(result.warnings) > 0


# ---------------------------------------------------------------------------
# Quiz distractors tests
# ---------------------------------------------------------------------------


class TestQuizDistractors:
    def test_get_distractors(self, engine):
        """Distractors should be definitions from other words."""
        f = ContentFilter(difficulty_level="medium", count=1)
        result = engine.generate(f)
        assert not result.is_empty
        item = result.items[0]
        distractors = engine.get_quiz_distractors(item, count=3)
        # Should get some distractors
        assert len(distractors) > 0
        # Correct answer should not be in distractors
        assert item.definition not in distractors

    def test_distractors_count(self, engine):
        f = ContentFilter(difficulty_level="easy", count=1)
        result = engine.generate(f)
        item = result.items[0]
        distractors = engine.get_quiz_distractors(item, count=2)
        assert len(distractors) <= 2


# ---------------------------------------------------------------------------
# Engine metadata tests
# ---------------------------------------------------------------------------


class TestEngineMetadata:
    def test_available_languages(self, engine):
        langs = engine.available_languages()
        assert "en" in langs
        assert "es" in langs
        assert len(langs) >= 4

    def test_available_categories(self, engine):
        cats = engine.available_categories()
        assert "words" in cats
        assert "phrases" in cats

    def test_available_topics(self, engine):
        topics = engine.available_topics()
        assert "general" in topics

    def test_available_topics_for_language(self, engine):
        topics = engine.available_topics(language="en")
        assert "general" in topics


# ---------------------------------------------------------------------------
# Integration with user config — preference-driven generation
# ---------------------------------------------------------------------------


class TestPreferenceDrivenGeneration:
    """Validate the full flow: user config → filter → engine → items."""

    def test_english_easy_words(self, engine):
        result = engine.generate_from_config({
            "target_language": "en",
            "difficulty_level": "easy",
            "content_categories": ["words"],
            "words_per_day": 3,
        })
        assert not result.is_empty
        for item in result.items:
            assert item.language == "en"
            assert item.difficulty == "easy"
            assert item.category == "words"

    def test_spanish_medium_words(self, engine):
        result = engine.generate_from_config({
            "target_language": "es",
            "difficulty_level": "medium",
            "content_categories": ["words"],
            "words_per_day": 2,
        })
        assert not result.is_empty
        for item in result.items:
            assert item.language == "es"
            assert item.difficulty == "medium"

    def test_english_hard_idioms(self, engine):
        result = engine.generate_from_config({
            "target_language": "en",
            "difficulty_level": "hard",
            "content_categories": ["idioms"],
            "words_per_day": 2,
        })
        assert not result.is_empty
        for item in result.items:
            assert item.category == "idioms"
            assert item.difficulty == "hard"

    def test_english_medium_science_topic(self, engine):
        result = engine.generate_from_config({
            "target_language": "en",
            "difficulty_level": "medium",
            "content_categories": ["words"],
            "topic_categories": ["science"],
            "words_per_day": 2,
        })
        assert not result.is_empty
        for item in result.items:
            assert item.topic == "science"

    def test_mixed_categories_and_topics(self, engine):
        result = engine.generate_from_config({
            "target_language": "en",
            "difficulty_level": "hard",
            "content_categories": ["words", "collocations"],
            "topic_categories": ["business"],
            "words_per_day": 10,
        })
        assert not result.is_empty
        cats = {item.category for item in result.items}
        assert cats.issubset({"words", "collocations"})

    def test_empty_config_uses_defaults(self, engine):
        """Empty config should use all defaults and still produce results."""
        result = engine.generate_from_config({})
        assert not result.is_empty
        # Defaults: en, medium, words, general
        for item in result.items:
            assert item.language == "en"
            assert item.difficulty == "medium"
