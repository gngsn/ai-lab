"""Vocabulary Learning Plugin — reference implementation of the BasePlugin interface.

This plugin delivers personalized vocabulary content to users based on their
configured preferences (difficulty level, words per day, target language, etc.).
It supports both inbound interactions (user asks for a word, quiz, etc.) and
outbound scheduled delivery (daily word of the day).

Design principles:
- **Plugin isolation**: No imports from platform internals beyond the plugin
  contract (``BasePlugin``, ``PluginManifest``, ``PluginContext``, ``PluginResult``).
- **Channel agnosticism**: Produces structured ``PluginResult`` content that any
  delivery channel can format independently.
- **Preference granularity**: Exposes rich, typed configuration options — not
  simple on/off toggles — so users can fine-tune the learning experience.

Capabilities declared in the manifest:
- ``vocab``        — general vocabulary lookups / interactions
- ``daily_word``   — scheduled word-of-the-day delivery
- ``quiz``         — vocabulary quiz / review sessions
- ``flashcard``    — flashcard-style review
"""

from __future__ import annotations

import logging
import random
from typing import Any

from app.plugins.vocab_content_engine import (
    ContentFilter,
    VocabContentEngine,
    VocabItem,
)
from app.services.plugin import (
    BasePlugin,
    ConfigOption,
    ConfigOptionType,
    PluginContext,
    PluginManifest,
    PluginResult,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent parsing — simple keyword-based routing within the plugin
# ---------------------------------------------------------------------------

_INTENT_KEYWORDS: dict[str, list[str]] = {
    "quiz": ["quiz", "test", "review", "practice", "check"],
    "daily_word": ["daily", "word of the day", "wotd", "today"],
    "flashcard": ["flashcard", "flash card", "flip", "card"],
    "define": ["define", "meaning", "definition", "what is", "what does"],
    "help": ["help", "commands", "what can you do", "usage"],
}


def _detect_intent(message: str) -> str:
    """Detect user intent from a free-text message.

    Returns the intent key or ``"daily_word"`` as a fallback.
    """
    msg_lower = message.lower().strip()
    if not msg_lower:
        return "daily_word"

    for intent, keywords in _INTENT_KEYWORDS.items():
        for kw in keywords:
            if kw in msg_lower:
                return intent

    return "daily_word"  # default


# ---------------------------------------------------------------------------
# Manifest — the capability declaration
# ---------------------------------------------------------------------------

VOCAB_LEARNING_MANIFEST = PluginManifest(
    name="vocab_learning",
    version="0.1.0",
    display_name="Vocabulary Learning",
    description=(
        "Personalized vocabulary learning with daily words, quizzes, "
        "and flashcards. Adapts content difficulty and volume to user preferences."
    ),
    capabilities=["vocab", "daily_word", "quiz", "flashcard"],
    config_options=[
        ConfigOption(
            key="difficulty_level",
            label="Difficulty Level",
            description="Controls the complexity of vocabulary words delivered",
            type=ConfigOptionType.SELECT,
            default="medium",
            choices=["easy", "medium", "hard"],
        ),
        ConfigOption(
            key="words_per_day",
            label="Words Per Day",
            description="Number of new vocabulary words to learn each day (1-20)",
            type=ConfigOptionType.INTEGER,
            default=5,
        ),
        ConfigOption(
            key="include_examples",
            label="Include Example Sentences",
            description="Whether to show usage examples alongside definitions",
            type=ConfigOptionType.BOOLEAN,
            default=True,
        ),
        ConfigOption(
            key="include_part_of_speech",
            label="Include Part of Speech",
            description="Whether to display the grammatical category of each word",
            type=ConfigOptionType.BOOLEAN,
            default=True,
        ),
        ConfigOption(
            key="quiz_style",
            label="Quiz Style",
            description="Format for vocabulary quizzes",
            type=ConfigOptionType.SELECT,
            default="multiple_choice",
            choices=["multiple_choice", "fill_in_blank", "definition_match"],
        ),
        ConfigOption(
            key="content_categories",
            label="Content Categories",
            description="Which types of vocabulary content to include",
            type=ConfigOptionType.MULTI_SELECT,
            default=["words", "phrases"],
            choices=["words", "phrases", "idioms", "collocations"],
        ),
        ConfigOption(
            key="target_language",
            label="Target Language",
            description="The language of vocabulary words to learn",
            type=ConfigOptionType.SELECT,
            default="en",
            choices=["en", "es", "fr", "de", "ja", "ko", "zh"],
        ),
        ConfigOption(
            key="topic_categories",
            label="Topic Categories",
            description="Topic areas for vocabulary content (e.g. general, food, science, business, nature)",
            type=ConfigOptionType.MULTI_SELECT,
            default=["general"],
            choices=["general", "food", "science", "business", "nature"],
        ),
        ConfigOption(
            key="review_interval_hours",
            label="Review Interval (hours)",
            description="How often to prompt for spaced-repetition review (in hours)",
            type=ConfigOptionType.INTEGER,
            default=24,
        ),
    ],
    dependencies=[],
    platform_version=">=0.1.0",
)


# ---------------------------------------------------------------------------
# Plugin implementation
# ---------------------------------------------------------------------------


class VocabLearningPlugin(BasePlugin):
    """Vocabulary learning service plugin.

    This is the **reference implementation** of the :class:`BasePlugin`
    interface.  It demonstrates:

    - A rich ``PluginManifest`` with multiple capability tags and granular
      config options of every supported type (select, multi-select, integer,
      boolean).
    - Intent detection from free-text messages to route to the appropriate
      handler (daily word, quiz, flashcard, definition lookup).
    - Channel-agnostic ``PluginResult`` output containing both structured
      ``content`` (for rich channels) and plain ``text`` (for simple channels).
    - Full lifecycle support (``initialize`` / ``execute`` / ``shutdown``).
    """

    manifest = VOCAB_LEARNING_MANIFEST

    def __init__(self, engine: VocabContentEngine | None = None) -> None:
        self._initialized: bool = False
        self._engine: VocabContentEngine = engine or VocabContentEngine()
        self._interaction_count: int = 0

    # -- Lifecycle -----------------------------------------------------------

    async def initialize(self) -> None:
        """Initialize the plugin and its content engine.

        In production the engine might connect to a database or external API.
        """
        self._initialized = True
        logger.info(
            "VocabLearningPlugin initialized — languages=%s, categories=%s",
            self._engine.available_languages(),
            self._engine.available_categories(),
        )

    async def execute(self, context: PluginContext) -> PluginResult:
        """Route the user's message to the appropriate handler."""
        if not self._initialized:
            return PluginResult(error="Plugin not initialized")

        self._interaction_count += 1
        config = self.merge_config(context.user_config)
        intent = _detect_intent(context.message)

        handlers = {
            "daily_word": self._handle_daily_word,
            "quiz": self._handle_quiz,
            "flashcard": self._handle_flashcard,
            "define": self._handle_define,
            "help": self._handle_help,
        }

        handler = handlers.get(intent, self._handle_daily_word)
        return handler(context, config)

    async def shutdown(self) -> None:
        """Release resources."""
        self._initialized = False
        logger.info("VocabLearningPlugin shut down (handled %d interactions)", self._interaction_count)

    # -- Engine access -------------------------------------------------------

    @property
    def engine(self) -> VocabContentEngine:
        """Access the underlying content generation engine."""
        return self._engine

    # -- Intent handlers (all synchronous, return PluginResult) --------------

    def _generate_items(self, config: dict[str, Any], count: int | None = None) -> list[VocabItem]:
        """Generate vocabulary items using the content engine with user prefs."""
        override = dict(config)
        if count is not None:
            override["words_per_day"] = count
        result = self._engine.generate_from_config(override)
        return result.items

    def _format_word(self, item: VocabItem | dict[str, Any], config: dict[str, Any]) -> str:
        """Format a single word entry into plain text respecting user prefs."""
        # Support both VocabItem and legacy dict format
        if isinstance(item, VocabItem):
            word = item.word
            pos = item.part_of_speech
            definition = item.definition
            example = item.example
        else:
            word = item["word"]
            pos = item.get("part_of_speech", "")
            definition = item["definition"]
            example = item.get("example", "")

        parts: list[str] = [f"**{word}**"]
        if config.get("include_part_of_speech", True) and pos:
            parts.append(f"({pos})")
        parts.append(f"— {definition}")
        if config.get("include_examples", True) and example:
            parts.append(f'\n  Example: "{example}"')
        return " ".join(parts)

    def _handle_daily_word(self, context: PluginContext, config: dict[str, Any]) -> PluginResult:
        """Deliver the daily word(s) using the content engine."""
        gen_result = self._engine.generate_from_config(config)
        items = gen_result.items
        text_lines = [self._format_word(item, config) for item in items]
        difficulty = config.get("difficulty_level", "medium")
        language = config.get("target_language", "en")

        return PluginResult(
            text=f"Daily vocabulary ({difficulty}, {language}):\n\n" + "\n\n".join(text_lines),
            content={
                "intent": "daily_word",
                "difficulty": difficulty,
                "language": language,
                "words": [item.to_dict() for item in items],
                "word_count": len(items),
                "total_available": gen_result.total_available,
                "include_examples": config.get("include_examples", True),
                "include_part_of_speech": config.get("include_part_of_speech", True),
                "warnings": gen_result.warnings,
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "daily_word",
                "user_id": context.user_id,
            },
        )

    def _handle_quiz(self, context: PluginContext, config: dict[str, Any]) -> PluginResult:
        """Generate a vocabulary quiz question using the content engine."""
        items = self._generate_items(config, count=1)
        if not items:
            return PluginResult(
                text="No words available for quiz.",
                content={"intent": "quiz", "error": "no_words"},
            )

        item = items[0]
        quiz_style = config.get("quiz_style", "multiple_choice")

        if quiz_style == "multiple_choice":
            return self._build_multiple_choice_quiz(item, config, context)
        elif quiz_style == "fill_in_blank":
            return self._build_fill_in_blank_quiz(item, config, context)
        else:  # definition_match
            return self._build_definition_match_quiz(item, config, context)

    def _build_multiple_choice_quiz(
        self, item: VocabItem, config: dict[str, Any], context: PluginContext
    ) -> PluginResult:
        """Build a multiple-choice quiz question."""
        correct = item.definition
        distractors = self._engine.get_quiz_distractors(item, count=3)
        if len(distractors) < 3:
            distractors.extend(["Option A", "Option B", "Option C"])
            distractors = distractors[:3]
        options = [correct] + distractors
        random.shuffle(options)
        correct_index = options.index(correct)

        text = f"Quiz: What does **{item.word}** mean?\n\n"
        for i, opt in enumerate(options):
            text += f"  {chr(65 + i)}) {opt}\n"
        text += f"\nAnswer: {chr(65 + correct_index)}"

        return PluginResult(
            text=text,
            content={
                "intent": "quiz",
                "quiz_style": "multiple_choice",
                "word": item.word,
                "correct_definition": correct,
                "options": options,
                "correct_index": correct_index,
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "quiz",
                "user_id": context.user_id,
            },
        )

    def _build_fill_in_blank_quiz(
        self, item: VocabItem, config: dict[str, Any], context: PluginContext
    ) -> PluginResult:
        """Build a fill-in-the-blank quiz question."""
        example = item.example or f"The {item.word} was used in a sentence."
        blanked = example.replace(item.word, "______")

        return PluginResult(
            text=f"Fill in the blank:\n\n{blanked}\n\nHint: {item.definition}\n\nAnswer: {item.word}",
            content={
                "intent": "quiz",
                "quiz_style": "fill_in_blank",
                "word": item.word,
                "sentence_with_blank": blanked,
                "original_sentence": example,
                "hint": item.definition,
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "quiz",
                "user_id": context.user_id,
            },
        )

    def _build_definition_match_quiz(
        self, item: VocabItem, config: dict[str, Any], context: PluginContext
    ) -> PluginResult:
        """Build a definition-match quiz question."""
        return PluginResult(
            text=f"Definition Match:\n\n\"{item.definition}\"\n\nWhat word matches this definition?\n\nAnswer: {item.word}",
            content={
                "intent": "quiz",
                "quiz_style": "definition_match",
                "word": item.word,
                "definition": item.definition,
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "quiz",
                "user_id": context.user_id,
            },
        )

    def _handle_flashcard(self, context: PluginContext, config: dict[str, Any]) -> PluginResult:
        """Generate a flashcard using the content engine."""
        items = self._generate_items(config, count=1)
        if not items:
            return PluginResult(
                text="No words available for flashcards.",
                content={"intent": "flashcard", "error": "no_words"},
            )

        item = items[0]
        front = item.word
        back_parts = [item.definition]
        if config.get("include_examples", True) and item.example:
            back_parts.append(f'Example: "{item.example}"')
        if config.get("include_part_of_speech", True) and item.part_of_speech:
            back_parts.insert(0, f"({item.part_of_speech})")
        back = "\n".join(back_parts)

        return PluginResult(
            text=f"Flashcard:\n\nFront: {front}\nBack: {back}",
            content={
                "intent": "flashcard",
                "front": front,
                "back": back,
                "word": item.to_dict(),
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "flashcard",
                "user_id": context.user_id,
            },
        )

    def _handle_define(self, context: PluginContext, config: dict[str, Any]) -> PluginResult:
        """Look up a specific word using the content engine's data source."""
        msg_lower = context.message.lower()

        # Search across all languages, difficulties, and categories
        found_item: VocabItem | None = None
        for lang in self._engine.available_languages():
            for diff in ["easy", "medium", "hard"]:
                items = self._engine.data_source.query(
                    language=lang,
                    difficulty=diff,
                    categories=[],
                    topics=[],
                )
                for item in items:
                    if item.word.lower() in msg_lower:
                        found_item = item
                        break
                if found_item:
                    break
            if found_item:
                break

        if found_item:
            text = self._format_word(found_item, config)
            return PluginResult(
                text=text,
                content={
                    "intent": "define",
                    "found": True,
                    "word": found_item.to_dict(),
                },
                metadata={
                    "plugin": "vocab_learning",
                    "intent": "define",
                    "user_id": context.user_id,
                },
            )

        return PluginResult(
            text="I couldn't find that word in my vocabulary bank. Try asking for a daily word instead!",
            content={
                "intent": "define",
                "found": False,
                "query": context.message,
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "define",
                "user_id": context.user_id,
            },
        )

    def _handle_help(self, _context: PluginContext, _config: dict[str, Any]) -> PluginResult:
        """Return usage information."""
        help_text = (
            "Vocabulary Learning Plugin\n\n"
            "I can help you learn new words! Here's what I can do:\n\n"
            "- **Daily Words** — Say 'daily word' or 'word of the day'\n"
            "- **Quiz** — Say 'quiz' or 'test me' for a vocabulary quiz\n"
            "- **Flashcards** — Say 'flashcard' for study cards\n"
            "- **Define** — Say 'define [word]' to look up a word\n\n"
            "You can customize your experience in settings:\n"
            "  - Difficulty level (easy / medium / hard)\n"
            "  - Words per day (1-20)\n"
            "  - Quiz style (multiple choice / fill-in-blank / definition match)\n"
            "  - Content categories (words, phrases, idioms, collocations)"
        )
        return PluginResult(
            text=help_text,
            content={
                "intent": "help",
                "capabilities": self.manifest.capabilities,
                "config_options": [opt.key for opt in self.manifest.config_options],
            },
            metadata={
                "plugin": "vocab_learning",
                "intent": "help",
            },
        )

    # -- Introspection helpers (useful for tests) ----------------------------

    @property
    def is_initialized(self) -> bool:
        """Whether the plugin has been initialized."""
        return self._initialized

    @property
    def interaction_count(self) -> int:
        """Total number of execute() calls handled."""
        return self._interaction_count
