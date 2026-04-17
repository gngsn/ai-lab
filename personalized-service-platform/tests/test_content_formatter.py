"""Tests for app.delivery.content_formatter — vocabulary content formatting.

Covers:
- All presentation formats (flashcard, quiz, definition, summary, compact)
- All verbosity levels (minimal, standard, detailed)
- Channel adaptation (buttons → text, truncation, etc.)
- DeliveryPreferences construction from dicts
- Edge cases (empty content, errors, unknown intents)
"""

from __future__ import annotations

import pytest

from app.delivery.base import ChannelInfo, ContentType, RichContent
from app.delivery.content_formatter import (
    DeliveryPreferences,
    FormattedContent,
    PresentationFormat,
    VerbosityLevel,
    VocabContentFormatter,
)


# ---------------------------------------------------------------------------
# Fixtures — sample plugin output data
# ---------------------------------------------------------------------------

@pytest.fixture
def daily_word_content() -> dict:
    """PluginResult.content for a daily_word intent with 2 words."""
    return {
        "intent": "daily_word",
        "difficulty": "medium",
        "language": "en",
        "words": [
            {
                "word": "ephemeral",
                "definition": "lasting for a very short time",
                "example": "The ephemeral beauty of cherry blossoms.",
                "part_of_speech": "adjective",
                "difficulty": "medium",
                "category": "words",
                "topic": "general",
                "language": "en",
            },
            {
                "word": "ubiquitous",
                "definition": "present, appearing, or found everywhere",
                "example": "Smartphones have become ubiquitous.",
                "part_of_speech": "adjective",
                "difficulty": "medium",
                "category": "words",
                "topic": "general",
                "language": "en",
            },
        ],
        "word_count": 2,
        "total_available": 10,
        "include_examples": True,
        "include_part_of_speech": True,
        "warnings": [],
    }


@pytest.fixture
def quiz_mc_content() -> dict:
    """PluginResult.content for a multiple-choice quiz."""
    return {
        "intent": "quiz",
        "quiz_style": "multiple_choice",
        "word": "ephemeral",
        "correct_definition": "lasting for a very short time",
        "options": [
            "lasting for a very short time",
            "extremely large or great",
            "impossible to understand",
            "happening by chance",
        ],
        "correct_index": 0,
    }


@pytest.fixture
def quiz_fill_content() -> dict:
    """PluginResult.content for a fill-in-the-blank quiz."""
    return {
        "intent": "quiz",
        "quiz_style": "fill_in_blank",
        "word": "ephemeral",
        "sentence_with_blank": "The ______ beauty of cherry blossoms.",
        "original_sentence": "The ephemeral beauty of cherry blossoms.",
        "hint": "lasting for a very short time",
    }


@pytest.fixture
def quiz_def_match_content() -> dict:
    """PluginResult.content for a definition-match quiz."""
    return {
        "intent": "quiz",
        "quiz_style": "definition_match",
        "word": "ephemeral",
        "definition": "lasting for a very short time",
    }


@pytest.fixture
def flashcard_content() -> dict:
    """PluginResult.content for a single flashcard."""
    return {
        "intent": "flashcard",
        "front": "ephemeral",
        "back": "(adjective)\nlasting for a very short time\nExample: \"The ephemeral beauty of cherry blossoms.\"",
        "word": {
            "word": "ephemeral",
            "definition": "lasting for a very short time",
            "example": "The ephemeral beauty of cherry blossoms.",
            "part_of_speech": "adjective",
            "difficulty": "medium",
            "category": "words",
            "topic": "general",
            "language": "en",
        },
    }


@pytest.fixture
def define_content() -> dict:
    """PluginResult.content for a single definition lookup."""
    return {
        "intent": "define",
        "found": True,
        "word": {
            "word": "ephemeral",
            "definition": "lasting for a very short time",
            "example": "The ephemeral beauty of cherry blossoms.",
            "part_of_speech": "adjective",
            "difficulty": "medium",
            "category": "words",
            "topic": "general",
            "language": "en",
        },
    }


@pytest.fixture
def help_content() -> dict:
    return {
        "intent": "help",
        "capabilities": ["vocab", "daily_word", "quiz", "flashcard"],
        "config_options": ["difficulty_level", "words_per_day"],
    }


@pytest.fixture
def formatter() -> VocabContentFormatter:
    return VocabContentFormatter()


@pytest.fixture
def chat_channel_info() -> ChannelInfo:
    return ChannelInfo(
        name="chat",
        channel_type="chat",
        supports_rich_content=True,
        supports_buttons=True,
        supports_images=True,
        max_message_length=4096,
    )


@pytest.fixture
def push_channel_info() -> ChannelInfo:
    return ChannelInfo(
        name="push",
        channel_type="push",
        supports_rich_content=False,
        supports_buttons=False,
        supports_images=False,
        max_message_length=256,
    )


# ---------------------------------------------------------------------------
# DeliveryPreferences
# ---------------------------------------------------------------------------

class TestDeliveryPreferences:
    def test_defaults(self):
        prefs = DeliveryPreferences()
        assert prefs.presentation_format == PresentationFormat.DEFINITION
        assert prefs.verbosity == VerbosityLevel.STANDARD
        assert prefs.emoji_enabled is True
        assert prefs.numbered_items is True

    def test_from_dict(self):
        prefs = DeliveryPreferences.from_dict({
            "presentation_format": "flashcard",
            "verbosity": "minimal",
            "emoji_enabled": False,
            "numbered_items": False,
            "show_difficulty_badge": True,
        })
        assert prefs.presentation_format == PresentationFormat.FLASHCARD
        assert prefs.verbosity == VerbosityLevel.MINIMAL
        assert prefs.emoji_enabled is False
        assert prefs.numbered_items is False
        assert prefs.show_difficulty_badge is True

    def test_from_dict_unknown_values_use_defaults(self):
        prefs = DeliveryPreferences.from_dict({
            "presentation_format": "nonexistent",
            "verbosity": "ultra",
        })
        assert prefs.presentation_format == PresentationFormat.DEFINITION
        assert prefs.verbosity == VerbosityLevel.STANDARD

    def test_from_dict_extra_keys_ignored(self):
        prefs = DeliveryPreferences.from_dict({
            "unknown_key": "whatever",
            "verbosity": "detailed",
        })
        assert prefs.verbosity == VerbosityLevel.DETAILED

    def test_from_empty_dict(self):
        prefs = DeliveryPreferences.from_dict({})
        assert prefs == DeliveryPreferences()


# ---------------------------------------------------------------------------
# Definition format
# ---------------------------------------------------------------------------

class TestDefinitionFormat:
    def test_daily_word_standard(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.DEFINITION)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert isinstance(result, FormattedContent)
        assert isinstance(result.rich, RichContent)
        assert "ephemeral" in result.plain_text
        assert "ubiquitous" in result.plain_text
        assert "lasting for a very short time" in result.plain_text

    def test_daily_word_minimal_no_examples(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(
            presentation_format=PresentationFormat.DEFINITION,
            verbosity=VerbosityLevel.MINIMAL,
        )
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        # Minimal should not include examples
        assert "cherry blossoms" not in result.plain_text
        # But should include the word and definition
        assert "ephemeral" in result.plain_text
        assert "lasting for a very short time" in result.plain_text

    def test_daily_word_detailed_includes_extras(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(
            presentation_format=PresentationFormat.DEFINITION,
            verbosity=VerbosityLevel.DETAILED,
            show_difficulty_badge=True,
        )
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert "Category:" in result.plain_text or "Topic:" in result.plain_text
        assert "Language: en" in result.plain_text

    def test_single_define_lookup(self, formatter, define_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.DEFINITION)
        result = formatter.format(define_content, delivery_prefs=prefs)

        assert "ephemeral" in result.plain_text
        assert "lasting for a very short time" in result.plain_text
        assert result.rich.metadata.get("format") == "definition"

    def test_numbered_items(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(numbered_items=True)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)
        assert "1. " in result.plain_text
        assert "2. " in result.plain_text

    def test_bullet_items(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(numbered_items=False)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)
        assert "• " in result.plain_text


# ---------------------------------------------------------------------------
# Flashcard format
# ---------------------------------------------------------------------------

class TestFlashcardFormat:
    def test_single_flashcard(self, formatter, flashcard_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.FLASHCARD)
        result = formatter.format(flashcard_content, delivery_prefs=prefs)

        assert "Flashcard" in result.plain_text
        assert "Front" in result.plain_text
        assert "Back" in result.plain_text
        assert "ephemeral" in result.plain_text
        assert result.rich.metadata.get("format") == "flashcard"

        # Should have a CARD block
        card_blocks = [b for b in result.rich.blocks if b.type == ContentType.CARD]
        assert len(card_blocks) == 1
        assert card_blocks[0].data["title"] == "ephemeral"

    def test_daily_words_as_flashcards(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.FLASHCARD)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        # Should render multiple words as flashcards
        card_blocks = [b for b in result.rich.blocks if b.type == ContentType.CARD]
        assert len(card_blocks) == 2
        assert "ephemeral" in result.plain_text
        assert "ubiquitous" in result.plain_text

    def test_flashcard_progress_hint(self, formatter, flashcard_content):
        prefs = DeliveryPreferences(
            presentation_format=PresentationFormat.FLASHCARD,
            show_progress_hint=True,
        )
        result = formatter.format(flashcard_content, delivery_prefs=prefs)
        assert "flip" in result.plain_text.lower() or "Tap" in result.plain_text

    def test_flashcard_no_progress_hint(self, formatter, flashcard_content):
        prefs = DeliveryPreferences(
            presentation_format=PresentationFormat.FLASHCARD,
            show_progress_hint=False,
        )
        result = formatter.format(flashcard_content, delivery_prefs=prefs)
        assert "Tap to flip" not in result.plain_text


# ---------------------------------------------------------------------------
# Quiz format
# ---------------------------------------------------------------------------

class TestQuizFormat:
    def test_multiple_choice(self, formatter, quiz_mc_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.QUIZ)
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs)

        assert "ephemeral" in result.plain_text
        assert "A)" in result.plain_text
        assert "B)" in result.plain_text
        assert result.rich.metadata.get("quiz_style") == "multiple_choice"

        # Should have button blocks
        button_blocks = [b for b in result.rich.blocks if b.type == ContentType.BUTTON]
        assert len(button_blocks) == 1
        buttons = button_blocks[0].data["buttons"]
        assert len(buttons) == 4

    def test_fill_in_blank(self, formatter, quiz_fill_content):
        prefs = DeliveryPreferences()
        result = formatter.format(quiz_fill_content, delivery_prefs=prefs)

        assert "Fill in the Blank" in result.plain_text
        assert "______" in result.plain_text
        assert result.rich.metadata.get("quiz_style") == "fill_in_blank"

    def test_fill_in_blank_minimal_no_hint(self, formatter, quiz_fill_content):
        prefs = DeliveryPreferences(verbosity=VerbosityLevel.MINIMAL)
        result = formatter.format(quiz_fill_content, delivery_prefs=prefs)

        assert "______" in result.plain_text
        # Minimal should not include the hint
        assert "Hint:" not in result.plain_text

    def test_definition_match(self, formatter, quiz_def_match_content):
        prefs = DeliveryPreferences()
        result = formatter.format(quiz_def_match_content, delivery_prefs=prefs)

        assert "Definition Match" in result.plain_text
        assert "lasting for a very short time" in result.plain_text
        assert "What word matches" in result.plain_text

    def test_quiz_always_uses_quiz_format(self, formatter, quiz_mc_content):
        """Even if user prefers flashcard, quiz content stays in quiz format."""
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.FLASHCARD)
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs)

        # Should still be quiz format, not flashcard
        assert result.rich.metadata.get("format") == "quiz"
        assert "A)" in result.plain_text


# ---------------------------------------------------------------------------
# Summary format
# ---------------------------------------------------------------------------

class TestSummaryFormat:
    def test_summary_daily_words(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.SUMMARY)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert "Summary" in result.plain_text
        assert "ephemeral" in result.plain_text
        assert "ubiquitous" in result.plain_text
        assert result.rich.metadata.get("format") == "summary"

        # Should have a LIST block
        list_blocks = [b for b in result.rich.blocks if b.type == ContentType.LIST]
        assert len(list_blocks) == 1

    def test_summary_with_progress_hint(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(
            presentation_format=PresentationFormat.SUMMARY,
            show_progress_hint=True,
        )
        result = formatter.format(daily_word_content, delivery_prefs=prefs)
        assert "quiz" in result.plain_text.lower()

    def test_summary_single_define(self, formatter, define_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.SUMMARY)
        result = formatter.format(define_content, delivery_prefs=prefs)
        assert "ephemeral" in result.plain_text


# ---------------------------------------------------------------------------
# Compact format
# ---------------------------------------------------------------------------

class TestCompactFormat:
    def test_compact_daily_words(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.COMPACT)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert "New words:" in result.plain_text
        assert "ephemeral" in result.plain_text
        assert len(result.plain_text) <= 256

    def test_compact_quiz(self, formatter, quiz_mc_content):
        # Quiz forces quiz format, not compact
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.COMPACT)
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs)
        # Quiz always stays quiz format
        assert result.rich.metadata.get("format") == "quiz"

    def test_compact_flashcard(self, formatter, flashcard_content):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.COMPACT)
        result = formatter.format(flashcard_content, delivery_prefs=prefs)

        assert "ephemeral" in result.plain_text
        assert result.rich.metadata.get("format") == "compact"


# ---------------------------------------------------------------------------
# Channel adaptation
# ---------------------------------------------------------------------------

class TestChannelAdaptation:
    def test_buttons_converted_to_text_on_push(self, formatter, quiz_mc_content, push_channel_info):
        prefs = DeliveryPreferences()
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs, channel_info=push_channel_info)

        # Should have no BUTTON blocks — they're converted to TEXT
        button_blocks = [b for b in result.rich.blocks if b.type == ContentType.BUTTON]
        assert len(button_blocks) == 0

        # But the option text should still be present
        text_blocks = [b for b in result.rich.blocks if b.type == ContentType.TEXT]
        all_text = " ".join(b.data.get("text", "") for b in text_blocks)
        assert "A)" in all_text

    def test_cards_converted_to_text_on_push(self, formatter, flashcard_content, push_channel_info):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.FLASHCARD)
        result = formatter.format(flashcard_content, delivery_prefs=prefs, channel_info=push_channel_info)

        card_blocks = [b for b in result.rich.blocks if b.type == ContentType.CARD]
        assert len(card_blocks) == 0

    def test_truncation_on_push(self, formatter, daily_word_content, push_channel_info):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.DEFINITION)
        result = formatter.format(daily_word_content, delivery_prefs=prefs, channel_info=push_channel_info)

        assert len(result.plain_text) <= 256

    def test_no_adaptation_on_chat(self, formatter, quiz_mc_content, chat_channel_info):
        prefs = DeliveryPreferences()
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs, channel_info=chat_channel_info)

        # Chat supports buttons — they should remain
        button_blocks = [b for b in result.rich.blocks if b.type == ContentType.BUTTON]
        assert len(button_blocks) == 1

    def test_no_channel_info_passes_through(self, formatter, quiz_mc_content):
        prefs = DeliveryPreferences()
        result = formatter.format(quiz_mc_content, delivery_prefs=prefs, channel_info=None)

        button_blocks = [b for b in result.rich.blocks if b.type == ContentType.BUTTON]
        assert len(button_blocks) == 1

    def test_list_converted_to_text_on_push(self, formatter, daily_word_content, push_channel_info):
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.SUMMARY)
        result = formatter.format(daily_word_content, delivery_prefs=prefs, channel_info=push_channel_info)

        list_blocks = [b for b in result.rich.blocks if b.type == ContentType.LIST]
        assert len(list_blocks) == 0


# ---------------------------------------------------------------------------
# Help / error handling
# ---------------------------------------------------------------------------

class TestHelpAndErrors:
    def test_help_passes_through(self, formatter, help_content):
        result = formatter.format(
            help_content,
            plugin_text="Vocabulary Learning Plugin\n\nI can help you learn...",
        )
        assert "Vocabulary Learning Plugin" in result.plain_text

    def test_error_content(self, formatter):
        error_content = {"intent": "quiz", "error": "no_words"}
        result = formatter.format(error_content, plugin_text="No words available for quiz.")
        assert "No words available" in result.plain_text

    def test_empty_content(self, formatter):
        result = formatter.format({}, plugin_text="")
        assert isinstance(result, FormattedContent)


# ---------------------------------------------------------------------------
# Emoji toggle
# ---------------------------------------------------------------------------

class TestEmojiToggle:
    def test_emoji_enabled_by_default(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(emoji_enabled=True)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)
        assert "📚" in result.plain_text

    def test_emoji_disabled(self, formatter, daily_word_content):
        prefs = DeliveryPreferences(emoji_enabled=False)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)
        assert "📚" not in result.plain_text


# ---------------------------------------------------------------------------
# format_from_result convenience method
# ---------------------------------------------------------------------------

class TestFormatFromResult:
    def test_with_mock_plugin_result(self, formatter, daily_word_content):
        class MockResult:
            content = daily_word_content
            text = "Daily vocabulary (medium, en):\n\nephemeral..."

        result = formatter.format_from_result(MockResult())
        assert "ephemeral" in result.plain_text
        assert isinstance(result.rich, RichContent)


# ---------------------------------------------------------------------------
# Supported formats introspection
# ---------------------------------------------------------------------------

class TestSupportedFormats:
    def test_supported_formats(self, formatter):
        formats = formatter.supported_formats()
        assert "flashcard" in formats
        assert "quiz" in formats
        assert "definition" in formats
        assert "summary" in formats
        assert "compact" in formats
        assert len(formats) == 5


# ---------------------------------------------------------------------------
# Cross-format consistency
# ---------------------------------------------------------------------------

class TestCrossFormatConsistency:
    """Verify that the same content renders correctly in all formats."""

    @pytest.mark.parametrize("fmt", [
        PresentationFormat.FLASHCARD,
        PresentationFormat.DEFINITION,
        PresentationFormat.SUMMARY,
        PresentationFormat.COMPACT,
    ])
    def test_daily_word_in_all_non_quiz_formats(self, formatter, daily_word_content, fmt):
        """Daily word content renders in all formats except quiz (quiz is intent-locked)."""
        prefs = DeliveryPreferences(presentation_format=fmt)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert isinstance(result, FormattedContent)
        assert isinstance(result.rich, RichContent)
        assert len(result.rich.blocks) > 0
        assert len(result.plain_text) > 0
        # The word should appear in every format
        assert "ephemeral" in result.plain_text

    def test_daily_word_with_quiz_pref_falls_back_to_natural(self, formatter, daily_word_content):
        """When user prefers quiz but content is daily_word, falls back to definition."""
        prefs = DeliveryPreferences(presentation_format=PresentationFormat.QUIZ)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        # Quiz format only applies to quiz intent — daily_word falls back to definition
        assert isinstance(result, FormattedContent)
        assert result.rich.metadata.get("format") == "definition"
        assert "ephemeral" in result.plain_text

    @pytest.mark.parametrize("verbosity", list(VerbosityLevel))
    def test_all_verbosity_levels(self, formatter, daily_word_content, verbosity):
        prefs = DeliveryPreferences(verbosity=verbosity)
        result = formatter.format(daily_word_content, delivery_prefs=prefs)

        assert isinstance(result, FormattedContent)
        assert "ephemeral" in result.plain_text
