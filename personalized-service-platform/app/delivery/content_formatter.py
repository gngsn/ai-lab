"""Content delivery formatter — adapts plugin output to user delivery preferences.

Converts :class:`PluginResult` content from service plugins into channel-ready
:class:`RichContent` messages.  The formatting adapts based on:

1. **Presentation format** — how content is visually structured (flashcard, quiz,
   definition list, summary, compact).
2. **Verbosity level** — how much detail to include (minimal, standard, detailed).
3. **Channel capabilities** — what the target channel supports (buttons, images,
   rich text, etc.).

Design principles:

- **Channel agnosticism**: Outputs :class:`RichContent` blocks that any channel
  can render via its own ``format_content()`` method.
- **Plugin isolation**: Consumes only the public ``PluginResult.content`` dict —
  never imports plugin internals.
- **Preference granularity**: Each formatting dimension (format, verbosity, extras)
  is independently configurable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.delivery.base import (
    ChannelInfo,
    ContentBlock,
    ContentType,
    RichContent,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Delivery preference models
# ---------------------------------------------------------------------------

class PresentationFormat(str, Enum):
    """How vocabulary content should be visually structured."""

    FLASHCARD = "flashcard"
    QUIZ = "quiz"
    DEFINITION = "definition"
    SUMMARY = "summary"
    COMPACT = "compact"


class VerbosityLevel(str, Enum):
    """How much detail to include in formatted output."""

    MINIMAL = "minimal"       # Word + definition only
    STANDARD = "standard"     # + examples, part of speech
    DETAILED = "detailed"     # + category, difficulty, topic, tips


@dataclass
class DeliveryPreferences:
    """User's delivery formatting preferences.

    These are distinct from *plugin* config (which controls what content is
    generated) — delivery preferences control *how* that content is presented
    in the final message.
    """

    presentation_format: PresentationFormat = PresentationFormat.DEFINITION
    verbosity: VerbosityLevel = VerbosityLevel.STANDARD
    show_pronunciation: bool = False
    show_difficulty_badge: bool = False
    show_progress_hint: bool = True
    emoji_enabled: bool = True
    numbered_items: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DeliveryPreferences:
        """Build preferences from a flat settings dictionary.

        Unknown keys are silently ignored so that callers can pass a superset
        of settings (e.g. the full user preference dict).
        """
        kwargs: dict[str, Any] = {}

        if "presentation_format" in data:
            try:
                kwargs["presentation_format"] = PresentationFormat(data["presentation_format"])
            except ValueError:
                logger.warning("Unknown presentation_format %r, using default", data["presentation_format"])

        if "verbosity" in data:
            try:
                kwargs["verbosity"] = VerbosityLevel(data["verbosity"])
            except ValueError:
                logger.warning("Unknown verbosity %r, using default", data["verbosity"])

        for bool_key in (
            "show_pronunciation",
            "show_difficulty_badge",
            "show_progress_hint",
            "emoji_enabled",
            "numbered_items",
        ):
            if bool_key in data:
                kwargs[bool_key] = bool(data[bool_key])

        return cls(**kwargs)


# ---------------------------------------------------------------------------
# Format result
# ---------------------------------------------------------------------------

@dataclass
class FormattedContent:
    """Result of formatting a PluginResult for delivery.

    Contains both a :class:`RichContent` (for channels that support structured
    blocks) and a plain-text fallback.
    """

    rich: RichContent
    plain_text: str
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Individual format renderers
# ---------------------------------------------------------------------------

_DIFFICULTY_EMOJI = {"easy": "🟢", "medium": "🟡", "hard": "🔴"}
_INTENT_EMOJI = {
    "daily_word": "📚",
    "quiz": "❓",
    "flashcard": "🃏",
    "define": "📖",
    "help": "ℹ️",
}


def _difficulty_badge(difficulty: str, emoji_enabled: bool) -> str:
    if emoji_enabled:
        emoji = _DIFFICULTY_EMOJI.get(difficulty, "⚪")
        return f"{emoji} {difficulty.capitalize()}"
    return f"[{difficulty.capitalize()}]"


def _word_header(word: dict[str, Any], prefs: DeliveryPreferences) -> str:
    """Build the header line for a vocabulary word."""
    parts = [f"**{word['word']}**"]
    if prefs.verbosity != VerbosityLevel.MINIMAL:
        pos = word.get("part_of_speech")
        if pos:
            parts.append(f"({pos})")
    if prefs.show_difficulty_badge:
        diff = word.get("difficulty", "")
        if diff:
            parts.append(_difficulty_badge(diff, prefs.emoji_enabled))
    return " ".join(parts)


def _word_body(word: dict[str, Any], prefs: DeliveryPreferences) -> list[str]:
    """Build body lines (definition, example, extras) for a word."""
    lines: list[str] = []
    lines.append(word.get("definition", ""))

    if prefs.verbosity != VerbosityLevel.MINIMAL:
        example = word.get("example")
        if example:
            lines.append(f'💡 "{example}"' if prefs.emoji_enabled else f'Example: "{example}"')

    if prefs.verbosity == VerbosityLevel.DETAILED:
        category = word.get("category")
        if category:
            lines.append(f"Category: {category}")
        topic = word.get("topic")
        if topic:
            lines.append(f"Topic: {topic}")
        lang = word.get("language")
        if lang:
            lines.append(f"Language: {lang}")

    return lines


# ---------------------------------------------------------------------------
# Flashcard formatter
# ---------------------------------------------------------------------------

def _format_flashcard(content: dict[str, Any], prefs: DeliveryPreferences) -> FormattedContent:
    """Format vocab content as flashcard(s) — front/back card style."""
    blocks: list[ContentBlock] = []
    text_parts: list[str] = []
    intent = content.get("intent", "flashcard")
    emoji = _INTENT_EMOJI.get(intent, "🃏") if prefs.emoji_enabled else ""

    # Single flashcard from flashcard intent
    if intent == "flashcard" and "front" in content:
        word_data = content.get("word", {})
        front = content["front"]
        back = content["back"]

        header = f"{emoji} Flashcard" if emoji else "Flashcard"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": header}))
        blocks.append(ContentBlock(type=ContentType.CARD, data={
            "title": front,
            "subtitle": word_data.get("part_of_speech", "") if prefs.verbosity != VerbosityLevel.MINIMAL else "",
            "body": back,
            "style": "flashcard",
        }))

        text_parts.append(header)
        text_parts.append(f"\n┌─── Front ───┐\n  {front}\n└─────────────┘")
        text_parts.append(f"┌─── Back ────┐\n  {back}\n└─────────────┘")

        if prefs.show_progress_hint:
            hint = "Tap to flip • Swipe for next"
            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": hint}))
            text_parts.append(f"\n{hint}")

    # Multiple words rendered as flashcards
    elif "words" in content:
        words = content["words"]
        header = f"{emoji} Flashcards ({len(words)})" if emoji else f"Flashcards ({len(words)})"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": header}))
        text_parts.append(header)

        for i, word in enumerate(words, 1):
            front = word.get("word", "")
            back_lines = _word_body(word, prefs)
            back = "\n".join(back_lines)

            blocks.append(ContentBlock(type=ContentType.CARD, data={
                "title": front,
                "subtitle": word.get("part_of_speech", "") if prefs.verbosity != VerbosityLevel.MINIMAL else "",
                "body": back,
                "style": "flashcard",
                "index": i,
            }))

            prefix = f"{i}. " if prefs.numbered_items else "• "
            text_parts.append(f"\n{prefix}{front}")
            text_parts.append(f"   {back}")

    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "flashcard", "intent": intent}),
        plain_text="\n".join(text_parts),
        metadata={"format": "flashcard"},
    )


# ---------------------------------------------------------------------------
# Quiz formatter
# ---------------------------------------------------------------------------

def _format_quiz(content: dict[str, Any], prefs: DeliveryPreferences) -> FormattedContent:
    """Format vocab content as an interactive quiz."""
    blocks: list[ContentBlock] = []
    text_parts: list[str] = []
    emoji = "❓" if prefs.emoji_enabled else ""
    quiz_style = content.get("quiz_style", "multiple_choice")

    if quiz_style == "multiple_choice":
        word = content.get("word", "")
        options = content.get("options", [])
        correct_index = content.get("correct_index", 0)

        header = f"{emoji} Quiz: What does **{word}** mean?" if emoji else f"Quiz: What does **{word}** mean?"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": header}))
        text_parts.append(header)

        # Build option buttons for rich channels
        button_data: list[dict[str, Any]] = []
        for i, opt in enumerate(options):
            label = f"{chr(65 + i)}) {opt}"
            button_data.append({
                "label": label,
                "callback_data": f"quiz_answer:{i}",
                "correct": i == correct_index,
            })
            text_parts.append(f"  {label}")

        blocks.append(ContentBlock(type=ContentType.BUTTON, data={
            "buttons": button_data,
            "layout": "vertical",
            "style": "quiz",
        }))

        if prefs.verbosity == VerbosityLevel.DETAILED and prefs.show_difficulty_badge:
            difficulty = content.get("difficulty", "")
            if difficulty:
                badge = _difficulty_badge(difficulty, prefs.emoji_enabled)
                blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": badge}))
                text_parts.append(f"\n{badge}")

    elif quiz_style == "fill_in_blank":
        sentence = content.get("sentence_with_blank", "")
        hint = content.get("hint", "")

        header = f"{emoji} Fill in the Blank" if emoji else "Fill in the Blank"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": header}))
        blocks.append(ContentBlock(type=ContentType.TEXT, data={
            "text": sentence,
            "style": "quote",
        }))
        text_parts.append(header)
        text_parts.append(f"\n  {sentence}")

        if prefs.verbosity != VerbosityLevel.MINIMAL and hint:
            hint_line = f"💡 Hint: {hint}" if prefs.emoji_enabled else f"Hint: {hint}"
            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": hint_line}))
            text_parts.append(f"\n{hint_line}")

    elif quiz_style == "definition_match":
        definition = content.get("definition", "")

        header = f"{emoji} Definition Match" if emoji else "Definition Match"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": header}))
        blocks.append(ContentBlock(type=ContentType.TEXT, data={
            "text": f'"{definition}"',
            "style": "quote",
        }))
        blocks.append(ContentBlock(type=ContentType.TEXT, data={
            "text": "What word matches this definition?",
        }))
        text_parts.append(header)
        text_parts.append(f'\n  "{definition}"')
        text_parts.append("\nWhat word matches this definition?")

    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "quiz", "quiz_style": quiz_style}),
        plain_text="\n".join(text_parts),
        metadata={"format": "quiz", "quiz_style": quiz_style},
    )


# ---------------------------------------------------------------------------
# Definition formatter
# ---------------------------------------------------------------------------

def _format_definition(content: dict[str, Any], prefs: DeliveryPreferences) -> FormattedContent:
    """Format vocab content as a definition list — the standard reference style."""
    blocks: list[ContentBlock] = []
    text_parts: list[str] = []
    intent = content.get("intent", "daily_word")
    emoji = _INTENT_EMOJI.get(intent, "📖") if prefs.emoji_enabled else ""

    # Single word definition (from "define" intent)
    if intent == "define" and "word" in content and isinstance(content["word"], dict):
        word = content["word"]
        header_text = _word_header(word, prefs)
        full_header = f"{emoji} {header_text}" if emoji else header_text
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": full_header}))
        text_parts.append(full_header)

        body_lines = _word_body(word, prefs)
        for line in body_lines:
            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": line}))
            text_parts.append(line)

    # Multiple words (daily_word or general list)
    elif "words" in content:
        words = content["words"]
        count = content.get("word_count", len(words))
        difficulty = content.get("difficulty", "")
        language = content.get("language", "")

        # Title
        title_parts = []
        if emoji:
            title_parts.append(emoji)
        title_parts.append(f"Vocabulary — {count} word{'s' if count != 1 else ''}")
        if difficulty and prefs.show_difficulty_badge:
            title_parts.append(_difficulty_badge(difficulty, prefs.emoji_enabled))
        title = " ".join(title_parts)

        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": title}))
        text_parts.append(title)

        if prefs.verbosity == VerbosityLevel.DETAILED and language:
            lang_line = f"Language: {language}"
            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": lang_line}))
            text_parts.append(lang_line)

        # Word entries
        separator = "─" * 30
        for i, word in enumerate(words, 1):
            header = _word_header(word, prefs)
            prefix = f"{i}. " if prefs.numbered_items else "• "

            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": f"\n{prefix}{header}"}))
            text_parts.append(f"\n{prefix}{header}")

            body_lines = _word_body(word, prefs)
            for line in body_lines:
                indented = f"   {line}"
                blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": indented}))
                text_parts.append(indented)

            if i < len(words) and prefs.verbosity == VerbosityLevel.DETAILED:
                blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": separator}))
                text_parts.append(separator)

    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "definition", "intent": intent}),
        plain_text="\n".join(text_parts),
        metadata={"format": "definition"},
    )


# ---------------------------------------------------------------------------
# Summary formatter
# ---------------------------------------------------------------------------

def _format_summary(content: dict[str, Any], prefs: DeliveryPreferences) -> FormattedContent:
    """Format vocab content as a concise summary — good for email digests."""
    blocks: list[ContentBlock] = []
    text_parts: list[str] = []
    intent = content.get("intent", "daily_word")
    emoji = _INTENT_EMOJI.get(intent, "📚") if prefs.emoji_enabled else ""

    if "words" in content:
        words = content["words"]
        difficulty = content.get("difficulty", "")
        language = content.get("language", "")

        # Title line
        title = f"{emoji} Daily Vocabulary Summary" if emoji else "Daily Vocabulary Summary"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": title}))
        text_parts.append(title)

        if prefs.verbosity == VerbosityLevel.DETAILED and (difficulty or language):
            meta = f"({difficulty}, {language})" if difficulty and language else f"({difficulty or language})"
            blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": meta}))
            text_parts.append(meta)

        # Build a list block for efficient rendering
        list_items: list[dict[str, str]] = []
        for word in words:
            entry = f"**{word['word']}** — {word.get('definition', '')}"
            list_items.append({"text": entry})
            text_parts.append(f"• {word['word']} — {word.get('definition', '')}")

        blocks.append(ContentBlock(type=ContentType.LIST, data={
            "items": list_items,
            "style": "bullet",
        }))

        # Footer
        footer = f"{len(words)} word{'s' if len(words) != 1 else ''} for today"
        if prefs.show_progress_hint:
            footer += " • Reply 'quiz' to test yourself"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": footer}))
        text_parts.append(f"\n{footer}")

    elif "word" in content and isinstance(content["word"], dict):
        word = content["word"]
        line = f"{emoji} **{word['word']}** — {word.get('definition', '')}"
        blocks.append(ContentBlock(type=ContentType.TEXT, data={"text": line}))
        text_parts.append(line)

    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "summary", "intent": intent}),
        plain_text="\n".join(text_parts),
        metadata={"format": "summary"},
    )


# ---------------------------------------------------------------------------
# Compact formatter
# ---------------------------------------------------------------------------

def _format_compact(content: dict[str, Any], prefs: DeliveryPreferences) -> FormattedContent:
    """Format vocab content in minimal space — good for push notifications."""
    text_parts: list[str] = []
    intent = content.get("intent", "daily_word")

    if "words" in content:
        words = content["words"]
        word_list = ", ".join(w["word"] for w in words[:5])
        text = f"New words: {word_list}"
        if len(words) > 5:
            text += f" (+{len(words) - 5} more)"
        text_parts.append(text)

    elif intent == "quiz":
        word = content.get("word", "")
        text_parts.append(f"Quiz: {word}")

    elif intent == "flashcard" and "front" in content:
        text_parts.append(f"Flashcard: {content['front']}")

    elif "word" in content and isinstance(content["word"], dict):
        word = content["word"]
        text_parts.append(f"{word['word']}: {word.get('definition', '')}")

    else:
        text_parts.append("New vocabulary content available")

    plain = " | ".join(text_parts)

    blocks = [ContentBlock(type=ContentType.TEXT, data={"text": plain})]

    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "compact", "intent": intent}),
        plain_text=plain[:256],  # Push-safe truncation
        metadata={"format": "compact"},
    )


# ---------------------------------------------------------------------------
# Help / error / fallback formatter
# ---------------------------------------------------------------------------

def _format_help_or_error(content: dict[str, Any], text_fallback: str, prefs: DeliveryPreferences) -> FormattedContent:
    """Format help text or error messages — pass-through with minimal decoration."""
    blocks = [ContentBlock(type=ContentType.TEXT, data={"text": text_fallback})]
    return FormattedContent(
        rich=RichContent(blocks=blocks, metadata={"format": "text"}),
        plain_text=text_fallback,
        metadata={"format": "text"},
    )


# ---------------------------------------------------------------------------
# Format registry
# ---------------------------------------------------------------------------

_FORMAT_RENDERERS = {
    PresentationFormat.FLASHCARD: _format_flashcard,
    PresentationFormat.QUIZ: _format_quiz,
    PresentationFormat.DEFINITION: _format_definition,
    PresentationFormat.SUMMARY: _format_summary,
    PresentationFormat.COMPACT: _format_compact,
}

# Map plugin intents to their "natural" presentation format
_INTENT_NATURAL_FORMAT: dict[str, PresentationFormat] = {
    "quiz": PresentationFormat.QUIZ,
    "flashcard": PresentationFormat.FLASHCARD,
    "define": PresentationFormat.DEFINITION,
    "daily_word": PresentationFormat.DEFINITION,
    "help": PresentationFormat.DEFINITION,  # pass-through
}


# ---------------------------------------------------------------------------
# Channel adaptation
# ---------------------------------------------------------------------------

def _adapt_for_channel(
    formatted: FormattedContent,
    channel_info: ChannelInfo | None,
) -> FormattedContent:
    """Post-process formatted content based on channel capabilities.

    If the channel doesn't support buttons, convert button blocks to text.
    If the channel has a max message length, truncate accordingly.
    """
    if channel_info is None:
        return formatted

    adapted_blocks: list[ContentBlock] = []

    for block in formatted.rich.blocks:
        # Convert buttons to text on channels without button support
        if block.type == ContentType.BUTTON and not channel_info.supports_buttons:
            buttons = block.data.get("buttons", [])
            text_lines = [b.get("label", "") for b in buttons]
            adapted_blocks.append(ContentBlock(
                type=ContentType.TEXT,
                data={"text": "\n".join(text_lines)},
            ))
        # Convert cards to text on channels without rich content
        elif block.type == ContentType.CARD and not channel_info.supports_rich_content:
            title = block.data.get("title", "")
            body = block.data.get("body", "")
            adapted_blocks.append(ContentBlock(
                type=ContentType.TEXT,
                data={"text": f"{title}\n{body}"},
            ))
        # Convert lists to text on channels without rich content
        elif block.type == ContentType.LIST and not channel_info.supports_rich_content:
            items = block.data.get("items", [])
            text_lines = [f"• {item.get('text', '')}" for item in items]
            adapted_blocks.append(ContentBlock(
                type=ContentType.TEXT,
                data={"text": "\n".join(text_lines)},
            ))
        else:
            adapted_blocks.append(block)

    # Truncate plain text if needed
    plain_text = formatted.plain_text
    max_len = channel_info.max_message_length
    if max_len and len(plain_text) > max_len:
        plain_text = plain_text[: max_len - 3] + "..."

    return FormattedContent(
        rich=RichContent(blocks=adapted_blocks, metadata=formatted.rich.metadata),
        plain_text=plain_text,
        metadata=formatted.metadata,
    )


# ---------------------------------------------------------------------------
# Main formatter class
# ---------------------------------------------------------------------------

class VocabContentFormatter:
    """Converts vocabulary plugin output into channel-ready messages.

    This is the bridge between the plugin layer (which generates structured
    content) and the delivery layer (which sends channel-native messages).

    Usage::

        formatter = VocabContentFormatter()
        result = formatter.format(
            plugin_result=plugin_result,
            delivery_prefs=user_delivery_prefs,
            channel_info=channel.get_channel_info(),
        )
        # result.rich   → RichContent for send_rich_content()
        # result.plain_text → fallback for send_message()
    """

    def format(
        self,
        plugin_content: dict[str, Any],
        plugin_text: str = "",
        delivery_prefs: DeliveryPreferences | None = None,
        channel_info: ChannelInfo | None = None,
    ) -> FormattedContent:
        """Format plugin output based on delivery preferences and channel.

        Parameters
        ----------
        plugin_content:
            The ``PluginResult.content`` dict from the vocab plugin.
        plugin_text:
            The ``PluginResult.text`` plain-text fallback.
        delivery_prefs:
            User's delivery formatting preferences.  Defaults are used if
            ``None``.
        channel_info:
            Target channel capabilities.  If provided, the output is adapted
            (e.g. buttons → text on channels without button support).

        Returns
        -------
        FormattedContent
            Contains both ``rich`` (:class:`RichContent`) and ``plain_text``.
        """
        if delivery_prefs is None:
            delivery_prefs = DeliveryPreferences()

        intent = plugin_content.get("intent", "")

        # Handle error, help, or empty content
        if plugin_content.get("error") or intent == "help":
            result = _format_help_or_error(plugin_content, plugin_text, delivery_prefs)
            return _adapt_for_channel(result, channel_info)

        # Determine which format to use
        presentation = self._resolve_format(intent, delivery_prefs)

        # Render
        renderer = _FORMAT_RENDERERS.get(presentation, _format_definition)
        result = renderer(plugin_content, delivery_prefs)

        # Adapt for channel constraints
        result = _adapt_for_channel(result, channel_info)

        return result

    def format_from_result(
        self,
        plugin_result: Any,
        delivery_prefs: DeliveryPreferences | None = None,
        channel_info: ChannelInfo | None = None,
    ) -> FormattedContent:
        """Convenience method that accepts a :class:`PluginResult` directly.

        Parameters
        ----------
        plugin_result:
            A ``PluginResult`` instance (or any object with ``.content`` dict
            and ``.text`` str attributes).
        delivery_prefs:
            User's delivery formatting preferences.
        channel_info:
            Target channel capabilities.
        """
        return self.format(
            plugin_content=plugin_result.content,
            plugin_text=plugin_result.text,
            delivery_prefs=delivery_prefs,
            channel_info=channel_info,
        )

    def _resolve_format(
        self,
        intent: str,
        prefs: DeliveryPreferences,
    ) -> PresentationFormat:
        """Determine the presentation format to use.

        If the user has a preferred format *and* it makes sense for the
        content intent, use it.  Otherwise fall back to the intent's
        natural format.

        For example: if the user prefers flashcards but the content is a
        quiz, use quiz format (because quiz data doesn't render well as
        flashcards).  But if the user prefers flashcards and the content
        is daily_word, flashcard format works fine.
        """
        user_pref = prefs.presentation_format
        natural = _INTENT_NATURAL_FORMAT.get(intent, PresentationFormat.DEFINITION)

        # Quiz content must stay in quiz format — it has quiz-specific fields
        if intent == "quiz":
            return PresentationFormat.QUIZ

        # Quiz format only makes sense for quiz-structured data
        if user_pref == PresentationFormat.QUIZ:
            return natural

        # For all other intents, respect the user's preference
        return user_pref

    def supported_formats(self) -> list[str]:
        """Return the list of supported presentation format values."""
        return [f.value for f in PresentationFormat]
