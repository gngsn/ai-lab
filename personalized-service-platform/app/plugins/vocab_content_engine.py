"""Vocabulary Content Generation Engine.

Produces personalized vocabulary learning items (words, definitions, examples)
filtered by user preference fields: language, difficulty level, and topic
categories.

Design principles:
- **Separation of concerns**: Content generation is decoupled from the plugin
  interface so the engine can be tested, replaced, or extended independently.
- **Preference granularity**: Filtering is driven by structured user preferences
  — not simple toggles — allowing fine-grained content personalization.
- **Extensibility**: The engine uses a protocol-based data source abstraction
  so the built-in word bank can be swapped for a database or external API.

The engine is consumed by the ``VocabLearningPlugin`` but has no dependency
on the plugin interface itself, preserving plugin isolation.
"""

from __future__ import annotations

import logging
import random
from typing import Any, Protocol

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models for learning items
# ---------------------------------------------------------------------------


class VocabItem(BaseModel):
    """A single vocabulary learning item."""

    word: str = Field(..., description="The vocabulary word or phrase")
    definition: str = Field(..., description="The definition or meaning")
    example: str = Field(default="", description="Example sentence using the word")
    part_of_speech: str = Field(default="", description="Grammatical category")
    language: str = Field(default="en", description="ISO 639-1 language code")
    difficulty: str = Field(default="medium", description="Difficulty level")
    category: str = Field(default="words", description="Content category")
    topic: str = Field(default="general", description="Topic area")

    def to_dict(self) -> dict[str, Any]:
        """Convert to a plain dict for PluginResult content."""
        return self.model_dump()


class ContentFilter(BaseModel):
    """User preference-based filter for content generation."""

    language: str = Field(default="en", description="Target language code")
    difficulty_level: str = Field(default="medium", description="Difficulty level")
    categories: list[str] = Field(
        default_factory=lambda: ["words"],
        description="Content categories to include",
    )
    topics: list[str] = Field(
        default_factory=lambda: ["general"],
        description="Topic areas to include (empty = all)",
    )
    count: int = Field(default=5, ge=1, le=50, description="Number of items to return")
    exclude_words: list[str] = Field(
        default_factory=list,
        description="Words to exclude (e.g., already learned)",
    )

    @classmethod
    def from_user_config(cls, config: dict[str, Any]) -> ContentFilter:
        """Build a filter from merged user configuration.

        Maps plugin config keys to filter fields so the engine
        doesn't need to know about plugin config option names.
        """
        categories = config.get("content_categories", ["words"])
        if isinstance(categories, str):
            categories = [categories]

        topics = config.get("topic_categories", ["general"])
        if isinstance(topics, str):
            topics = [topics]

        return cls(
            language=config.get("target_language", "en"),
            difficulty_level=config.get("difficulty_level", "medium"),
            categories=categories,
            topics=topics,
            count=config.get("words_per_day", 5),
            exclude_words=config.get("exclude_words", []),
        )


class GenerationResult(BaseModel):
    """Result of content generation — a batch of learning items with metadata."""

    items: list[VocabItem] = Field(default_factory=list)
    total_available: int = Field(
        default=0,
        description="Total items matching the filter before count limit",
    )
    filter_applied: ContentFilter
    warnings: list[str] = Field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return len(self.items) == 0


# ---------------------------------------------------------------------------
# Data source protocol — abstraction for vocabulary data backends
# ---------------------------------------------------------------------------


class VocabDataSource(Protocol):
    """Protocol for vocabulary data backends.

    Implementations can back the engine with an in-memory word bank,
    a database, or an external API.
    """

    def query(
        self,
        language: str,
        difficulty: str,
        categories: list[str],
        topics: list[str],
    ) -> list[VocabItem]:
        """Return all items matching the given filters."""
        ...

    def available_languages(self) -> list[str]:
        """Return list of supported language codes."""
        ...

    def available_categories(self) -> list[str]:
        """Return list of supported content categories."""
        ...

    def available_topics(self, language: str | None = None) -> list[str]:
        """Return list of supported topics, optionally for a specific language."""
        ...


# ---------------------------------------------------------------------------
# Built-in word bank data source
# ---------------------------------------------------------------------------

# Data keyed by (language, difficulty, category, topic)
_BUILTIN_WORD_BANK: list[dict[str, Any]] = [
    # === English — easy — words — general ===
    {"word": "apple", "definition": "A round fruit with red or green skin", "example": "She ate an apple for lunch.", "part_of_speech": "noun", "language": "en", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "happy", "definition": "Feeling pleasure or contentment", "example": "The children were happy to see snow.", "part_of_speech": "adjective", "language": "en", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "run", "definition": "To move quickly on foot", "example": "He runs every morning before work.", "part_of_speech": "verb", "language": "en", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "bright", "definition": "Giving out or reflecting much light", "example": "The bright sun warmed the beach.", "part_of_speech": "adjective", "language": "en", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "garden", "definition": "A piece of ground used for growing flowers or vegetables", "example": "She planted tomatoes in the garden.", "part_of_speech": "noun", "language": "en", "difficulty": "easy", "category": "words", "topic": "general"},

    # === English — easy — words — food ===
    {"word": "bread", "definition": "A food made from flour, water, and yeast", "example": "Fresh bread smells wonderful.", "part_of_speech": "noun", "language": "en", "difficulty": "easy", "category": "words", "topic": "food"},
    {"word": "cook", "definition": "To prepare food by heating it", "example": "She learned to cook from her grandmother.", "part_of_speech": "verb", "language": "en", "difficulty": "easy", "category": "words", "topic": "food"},
    {"word": "sweet", "definition": "Having the taste of sugar or honey", "example": "The cake was too sweet for my taste.", "part_of_speech": "adjective", "language": "en", "difficulty": "easy", "category": "words", "topic": "food"},

    # === English — easy — words — nature ===
    {"word": "river", "definition": "A large natural stream of water", "example": "The river flows through the valley.", "part_of_speech": "noun", "language": "en", "difficulty": "easy", "category": "words", "topic": "nature"},
    {"word": "bloom", "definition": "To produce flowers", "example": "Cherry trees bloom in spring.", "part_of_speech": "verb", "language": "en", "difficulty": "easy", "category": "words", "topic": "nature"},

    # === English — easy — phrases — general ===
    {"word": "break the ice", "definition": "To initiate social conversation", "example": "He told a joke to break the ice.", "part_of_speech": "phrase", "language": "en", "difficulty": "easy", "category": "phrases", "topic": "general"},
    {"word": "piece of cake", "definition": "Something very easy to do", "example": "The test was a piece of cake.", "part_of_speech": "phrase", "language": "en", "difficulty": "easy", "category": "phrases", "topic": "general"},

    # === English — medium — words — general ===
    {"word": "resilient", "definition": "Able to recover quickly from difficulties", "example": "The resilient community rebuilt after the flood.", "part_of_speech": "adjective", "language": "en", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "elaborate", "definition": "Involving many carefully arranged parts; detailed", "example": "She gave an elaborate explanation of the theory.", "part_of_speech": "adjective", "language": "en", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "contemplate", "definition": "To think deeply or carefully about something", "example": "He sat by the lake to contemplate his future.", "part_of_speech": "verb", "language": "en", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "pragmatic", "definition": "Dealing with things sensibly and realistically", "example": "We need a pragmatic approach to this problem.", "part_of_speech": "adjective", "language": "en", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "catalyst", "definition": "A substance or person that causes change", "example": "Her speech was the catalyst for reform.", "part_of_speech": "noun", "language": "en", "difficulty": "medium", "category": "words", "topic": "general"},

    # === English — medium — words — science ===
    {"word": "hypothesis", "definition": "A proposed explanation for a phenomenon", "example": "The scientist tested her hypothesis in the lab.", "part_of_speech": "noun", "language": "en", "difficulty": "medium", "category": "words", "topic": "science"},
    {"word": "empirical", "definition": "Based on observation or experience rather than theory", "example": "The study provided empirical evidence for the claim.", "part_of_speech": "adjective", "language": "en", "difficulty": "medium", "category": "words", "topic": "science"},

    # === English — medium — words — business ===
    {"word": "leverage", "definition": "To use something to maximum advantage", "example": "We can leverage our expertise to win the contract.", "part_of_speech": "verb", "language": "en", "difficulty": "medium", "category": "words", "topic": "business"},
    {"word": "stakeholder", "definition": "A person with an interest in something", "example": "All stakeholders must approve the budget.", "part_of_speech": "noun", "language": "en", "difficulty": "medium", "category": "words", "topic": "business"},

    # === English — medium — phrases — general ===
    {"word": "devil's advocate", "definition": "A person who argues an opposing view for the sake of debate", "example": "Let me play devil's advocate for a moment.", "part_of_speech": "phrase", "language": "en", "difficulty": "medium", "category": "phrases", "topic": "general"},
    {"word": "the elephant in the room", "definition": "An obvious problem that people avoid discussing", "example": "Budget cuts are the elephant in the room.", "part_of_speech": "phrase", "language": "en", "difficulty": "medium", "category": "phrases", "topic": "general"},

    # === English — medium — idioms — general ===
    {"word": "bite the bullet", "definition": "To endure a painful experience bravely", "example": "We had to bite the bullet and accept the changes.", "part_of_speech": "idiom", "language": "en", "difficulty": "medium", "category": "idioms", "topic": "general"},
    {"word": "burn the midnight oil", "definition": "To work late into the night", "example": "Students burn the midnight oil before exams.", "part_of_speech": "idiom", "language": "en", "difficulty": "medium", "category": "idioms", "topic": "general"},

    # === English — hard — words — general ===
    {"word": "ephemeral", "definition": "Lasting for a very short time", "example": "The ephemeral beauty of cherry blossoms draws millions of visitors.", "part_of_speech": "adjective", "language": "en", "difficulty": "hard", "category": "words", "topic": "general"},
    {"word": "sycophant", "definition": "A person who praises powerful people to gain advantage", "example": "The king was surrounded by sycophants.", "part_of_speech": "noun", "language": "en", "difficulty": "hard", "category": "words", "topic": "general"},
    {"word": "ubiquitous", "definition": "Present, appearing, or found everywhere", "example": "Smartphones have become ubiquitous in modern life.", "part_of_speech": "adjective", "language": "en", "difficulty": "hard", "category": "words", "topic": "general"},
    {"word": "obfuscate", "definition": "To make something unclear or unintelligible", "example": "The report seemed designed to obfuscate rather than inform.", "part_of_speech": "verb", "language": "en", "difficulty": "hard", "category": "words", "topic": "general"},
    {"word": "perspicacious", "definition": "Having a ready insight into and understanding of things", "example": "A perspicacious judge of character, she saw through the lies.", "part_of_speech": "adjective", "language": "en", "difficulty": "hard", "category": "words", "topic": "general"},

    # === English — hard — words — science ===
    {"word": "paradigm", "definition": "A typical example or model of something", "example": "The discovery shifted the scientific paradigm.", "part_of_speech": "noun", "language": "en", "difficulty": "hard", "category": "words", "topic": "science"},
    {"word": "recalcitrant", "definition": "Stubbornly resistant to authority or control", "example": "The recalcitrant bacteria resisted all antibiotics.", "part_of_speech": "adjective", "language": "en", "difficulty": "hard", "category": "words", "topic": "science"},

    # === English — hard — idioms — general ===
    {"word": "Pyrrhic victory", "definition": "A victory that comes at too great a cost", "example": "Winning the lawsuit was a Pyrrhic victory.", "part_of_speech": "idiom", "language": "en", "difficulty": "hard", "category": "idioms", "topic": "general"},
    {"word": "between Scylla and Charybdis", "definition": "Caught between two equally dangerous alternatives", "example": "The company was between Scylla and Charybdis.", "part_of_speech": "idiom", "language": "en", "difficulty": "hard", "category": "idioms", "topic": "general"},

    # === English — hard — collocations — business ===
    {"word": "due diligence", "definition": "Thorough research before making a business decision", "example": "Investors must perform due diligence before committing.", "part_of_speech": "collocation", "language": "en", "difficulty": "hard", "category": "collocations", "topic": "business"},
    {"word": "competitive advantage", "definition": "A condition that puts a company ahead of rivals", "example": "Innovation is their key competitive advantage.", "part_of_speech": "collocation", "language": "en", "difficulty": "hard", "category": "collocations", "topic": "business"},

    # === Spanish — easy — words — general ===
    {"word": "casa", "definition": "House; a building for dwelling", "example": "Mi casa es tu casa.", "part_of_speech": "noun", "language": "es", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "feliz", "definition": "Happy; feeling joy", "example": "Estoy muy feliz hoy.", "part_of_speech": "adjective", "language": "es", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "correr", "definition": "To run", "example": "Me gusta correr por la mañana.", "part_of_speech": "verb", "language": "es", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "agua", "definition": "Water", "example": "Necesito un vaso de agua.", "part_of_speech": "noun", "language": "es", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "grande", "definition": "Big; large in size", "example": "Es una ciudad muy grande.", "part_of_speech": "adjective", "language": "es", "difficulty": "easy", "category": "words", "topic": "general"},

    # === Spanish — medium — words — general ===
    {"word": "desarrollar", "definition": "To develop; to bring to a more advanced state", "example": "Queremos desarrollar nuevas tecnologías.", "part_of_speech": "verb", "language": "es", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "conocimiento", "definition": "Knowledge; awareness gained through experience", "example": "El conocimiento es poder.", "part_of_speech": "noun", "language": "es", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "desafío", "definition": "Challenge; something that tests ability", "example": "Este proyecto es un gran desafío.", "part_of_speech": "noun", "language": "es", "difficulty": "medium", "category": "words", "topic": "general"},

    # === Spanish — hard — words — general ===
    {"word": "efímero", "definition": "Ephemeral; lasting a very short time", "example": "La fama puede ser efímera.", "part_of_speech": "adjective", "language": "es", "difficulty": "hard", "category": "words", "topic": "general"},
    {"word": "perspicaz", "definition": "Perspicacious; having keen insight", "example": "Es una persona muy perspicaz.", "part_of_speech": "adjective", "language": "es", "difficulty": "hard", "category": "words", "topic": "general"},

    # === French — easy — words — general ===
    {"word": "maison", "definition": "House; home", "example": "Je suis à la maison.", "part_of_speech": "noun", "language": "fr", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "beau", "definition": "Beautiful; handsome", "example": "C'est un beau jour.", "part_of_speech": "adjective", "language": "fr", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "manger", "definition": "To eat", "example": "Je veux manger du pain.", "part_of_speech": "verb", "language": "fr", "difficulty": "easy", "category": "words", "topic": "general"},

    # === French — medium — words — general ===
    {"word": "bouleverser", "definition": "To overwhelm; to turn upside down", "example": "Cette nouvelle m'a bouleversé.", "part_of_speech": "verb", "language": "fr", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "épanouissement", "definition": "Flourishing; personal growth and fulfillment", "example": "L'épanouissement personnel est important.", "part_of_speech": "noun", "language": "fr", "difficulty": "medium", "category": "words", "topic": "general"},

    # === Korean — easy — words — general ===
    {"word": "사랑", "definition": "Love", "example": "사랑은 아름답습니다.", "part_of_speech": "noun", "language": "ko", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "행복", "definition": "Happiness", "example": "행복은 멀리 있지 않습니다.", "part_of_speech": "noun", "language": "ko", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "먹다", "definition": "To eat", "example": "밥을 먹다.", "part_of_speech": "verb", "language": "ko", "difficulty": "easy", "category": "words", "topic": "general"},

    # === Korean — medium — words — general ===
    {"word": "도전", "definition": "Challenge", "example": "새로운 도전을 시작합니다.", "part_of_speech": "noun", "language": "ko", "difficulty": "medium", "category": "words", "topic": "general"},
    {"word": "성취감", "definition": "Sense of accomplishment", "example": "큰 성취감을 느꼈다.", "part_of_speech": "noun", "language": "ko", "difficulty": "medium", "category": "words", "topic": "general"},

    # === Japanese — easy — words — general ===
    {"word": "食べる", "definition": "To eat", "example": "朝ごはんを食べる。", "part_of_speech": "verb", "language": "ja", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "美しい", "definition": "Beautiful", "example": "この花は美しい。", "part_of_speech": "adjective", "language": "ja", "difficulty": "easy", "category": "words", "topic": "general"},
    {"word": "友達", "definition": "Friend", "example": "友達と遊ぶ。", "part_of_speech": "noun", "language": "ja", "difficulty": "easy", "category": "words", "topic": "general"},
]


class BuiltinVocabDataSource:
    """In-memory vocabulary data source backed by a static word bank.

    Organizes data by language, difficulty, category, and topic for
    efficient filtering.  In production this would be replaced by a
    database-backed implementation.
    """

    def __init__(self, data: list[dict[str, Any]] | None = None) -> None:
        raw = data if data is not None else _BUILTIN_WORD_BANK
        self._items: list[VocabItem] = [VocabItem(**d) for d in raw]
        self._index: dict[str, list[VocabItem]] = {}
        self._build_index()

    def _build_index(self) -> None:
        """Build lookup indices for fast filtering."""
        for item in self._items:
            key = f"{item.language}:{item.difficulty}"
            self._index.setdefault(key, []).append(item)

    def query(
        self,
        language: str,
        difficulty: str,
        categories: list[str],
        topics: list[str],
    ) -> list[VocabItem]:
        """Return items matching all filter criteria."""
        key = f"{language}:{difficulty}"
        candidates = self._index.get(key, [])

        result = []
        cat_set = set(categories) if categories else None
        topic_set = set(topics) if topics else None

        for item in candidates:
            if cat_set and item.category not in cat_set:
                continue
            # Empty topics list means "all topics"
            if topic_set and "general" not in topic_set and item.topic not in topic_set:
                continue
            result.append(item)

        return result

    def available_languages(self) -> list[str]:
        return sorted({item.language for item in self._items})

    def available_categories(self) -> list[str]:
        return sorted({item.category for item in self._items})

    def available_topics(self, language: str | None = None) -> list[str]:
        items = self._items
        if language:
            items = [i for i in items if i.language == language]
        return sorted({item.topic for item in items})


# ---------------------------------------------------------------------------
# Content Generation Engine
# ---------------------------------------------------------------------------


class VocabContentEngine:
    """Generates personalized vocabulary learning content.

    Accepts a ``ContentFilter`` derived from user preferences and produces
    a ``GenerationResult`` containing filtered, randomized learning items.

    The engine is stateless per call — all personalization comes from the
    filter.  This makes it safe to share across concurrent requests.
    """

    def __init__(self, data_source: VocabDataSource | None = None) -> None:
        self._source: VocabDataSource = data_source or BuiltinVocabDataSource()

    @property
    def data_source(self) -> VocabDataSource:
        return self._source

    def generate(self, content_filter: ContentFilter) -> GenerationResult:
        """Generate learning items matching the content filter.

        Steps:
        1. Query the data source with language, difficulty, categories, topics.
        2. Exclude already-learned words.
        3. Randomly sample up to ``count`` items.
        4. Return a ``GenerationResult`` with items and metadata.
        """
        warnings: list[str] = []

        # Query the data source
        candidates = self._source.query(
            language=content_filter.language,
            difficulty=content_filter.difficulty_level,
            categories=content_filter.categories,
            topics=content_filter.topics,
        )

        # Exclude already-learned words
        if content_filter.exclude_words:
            exclude_set = {w.lower() for w in content_filter.exclude_words}
            candidates = [c for c in candidates if c.word.lower() not in exclude_set]

        total_available = len(candidates)

        # Check if we have enough content
        if total_available == 0:
            # Fallback: try without topic filter
            candidates = self._source.query(
                language=content_filter.language,
                difficulty=content_filter.difficulty_level,
                categories=content_filter.categories,
                topics=[],  # no topic filter
            )
            if content_filter.exclude_words:
                exclude_set = {w.lower() for w in content_filter.exclude_words}
                candidates = [c for c in candidates if c.word.lower() not in exclude_set]
            total_available = len(candidates)
            if candidates:
                warnings.append(
                    f"No items found for topics {content_filter.topics}; "
                    f"showing all topics for {content_filter.language}/{content_filter.difficulty_level}"
                )

        if total_available == 0:
            # Second fallback: try default language (en) if requested language has no content
            if content_filter.language != "en":
                warnings.append(
                    f"No content available for language '{content_filter.language}' "
                    f"at difficulty '{content_filter.difficulty_level}'; "
                    f"falling back to English"
                )
                candidates = self._source.query(
                    language="en",
                    difficulty=content_filter.difficulty_level,
                    categories=content_filter.categories,
                    topics=[],
                )
                total_available = len(candidates)

        # Sample items
        count = min(content_filter.count, total_available)
        if count < content_filter.count and total_available > 0:
            warnings.append(
                f"Requested {content_filter.count} items but only "
                f"{total_available} available; returning {count}"
            )

        selected = random.sample(candidates, k=count) if count > 0 else []

        return GenerationResult(
            items=selected,
            total_available=total_available,
            filter_applied=content_filter,
            warnings=warnings,
        )

    def generate_from_config(self, user_config: dict[str, Any]) -> GenerationResult:
        """Convenience method: build a filter from user config and generate.

        This is the primary entry point used by the VocabLearningPlugin.
        """
        content_filter = ContentFilter.from_user_config(user_config)
        return self.generate(content_filter)

    def get_quiz_distractors(self, item: VocabItem, count: int = 3) -> list[str]:
        """Generate distractor definitions for a quiz question.

        Returns definitions of other words at the same difficulty level
        to use as wrong answers in multiple-choice quizzes.
        """
        candidates = self._source.query(
            language=item.language,
            difficulty=item.difficulty,
            categories=[item.category],
            topics=[],
        )
        # Filter out the correct answer
        distractors = [
            c.definition for c in candidates
            if c.word != item.word
        ]
        random.shuffle(distractors)
        return distractors[:count]

    def available_languages(self) -> list[str]:
        """Return all supported language codes."""
        return self._source.available_languages()

    def available_categories(self) -> list[str]:
        """Return all supported content categories."""
        return self._source.available_categories()

    def available_topics(self, language: str | None = None) -> list[str]:
        """Return all supported topics, optionally for a language."""
        return self._source.available_topics(language)
