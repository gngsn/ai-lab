"""Preference-aware vocabulary content selection.

Bridges user preferences (stored in the FeatureConfigRepository) with the
VocabContentEngine to produce personalized, ranked vocabulary items.

This module is the "intelligence layer" between raw content generation and
delivery — it queries user settings, builds filters, applies ranking logic,
and returns items tailored to individual users.

Design principles:
- **Preference granularity**: Uses the full range of per-feature settings
  (difficulty, categories, topics, schedule, etc.) — not simple toggles.
- **Plugin isolation**: Depends only on the plugin's own types and the
  repository protocol — no platform internals.
- **Channel agnosticism**: Produces structured ``SelectionResult`` data that
  any delivery channel can format independently.

Usage::

    selector = PersonalizedContentSelector(
        engine=VocabContentEngine(),
        config_repo=feature_config_repo,
    )
    result = await selector.select_for_user("user-123")
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.models.feature_config import (
    DifficultyConfig,
    DifficultyLevel,
    FeatureConfigSchema,
    FeatureConfiguration,
)
from app.plugins.vocab_content_engine import (
    ContentFilter,
    GenerationResult,
    VocabContentEngine,
    VocabItem,
)
from app.services.feature_config_repository import (
    FeatureConfigRepository,
    FeatureConfigRepositoryProtocol,
)

logger = logging.getLogger(__name__)

# Feature name constant — matches the plugin manifest
VOCAB_FEATURE_NAME = "vocab_learning"


# ---------------------------------------------------------------------------
# Ranking & scoring models
# ---------------------------------------------------------------------------


@dataclass
class ScoredItem:
    """A vocabulary item annotated with a relevance score.

    Higher scores mean greater relevance to the user's preferences.
    Score components are tracked for transparency / debugging.
    """

    item: VocabItem
    score: float = 0.0
    score_breakdown: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.score_breakdown:
            self.score_breakdown = {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "item": self.item.to_dict(),
            "score": round(self.score, 4),
            "score_breakdown": {
                k: round(v, 4) for k, v in self.score_breakdown.items()
            },
        }


@dataclass
class SelectionResult:
    """Output of the content selection process.

    Contains scored items, the resolved preferences used, and any
    warnings or diagnostics.
    """

    user_id: str
    items: list[ScoredItem] = field(default_factory=list)
    resolved_config: dict[str, Any] = field(default_factory=dict)
    total_candidates: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return len(self.items) == 0

    @property
    def top_items(self) -> list[VocabItem]:
        """Return just the VocabItem objects in ranked order."""
        return [si.item for si in self.items]

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "items": [si.to_dict() for si in self.items],
            "resolved_config": self.resolved_config,
            "total_candidates": self.total_candidates,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Ranking weights — configurable scoring factors
# ---------------------------------------------------------------------------


@dataclass
class RankingWeights:
    """Weights for different scoring factors.

    Each weight controls how much a particular preference dimension
    contributes to the final item score.
    """

    # Base score for items matching the primary difficulty level
    difficulty_match: float = 1.0
    # Bonus for items matching preferred topic categories
    topic_match: float = 0.8
    # Bonus for items matching preferred content categories
    category_match: float = 0.6
    # Penalty for items that are adjacent difficulty levels
    difficulty_adjacent: float = 0.4
    # Bonus for items with examples (when user wants examples)
    has_example: float = 0.2
    # Bonus for items with part of speech (when user wants PoS)
    has_part_of_speech: float = 0.1
    # Small random factor to add variety
    variety_factor: float = 0.05


DEFAULT_WEIGHTS = RankingWeights()


# ---------------------------------------------------------------------------
# Preference resolver — extracts usable config from storage
# ---------------------------------------------------------------------------


def resolve_user_config(
    feature_config: FeatureConfiguration | None,
    plugin_defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve a user's effective configuration.

    Merges feature config custom_settings, difficulty settings, and
    plugin defaults into a single flat dict suitable for the content
    engine.

    Parameters
    ----------
    feature_config:
        The user's stored FeatureConfiguration (may be None if no
        preferences have been set yet).
    plugin_defaults:
        Default values from the plugin manifest. Used as the base
        layer that user settings override.

    Returns
    -------
    A flat dict with all resolved preference values.
    """
    defaults = dict(plugin_defaults or {})
    if feature_config is None:
        return defaults

    # Layer 1: Start with plugin defaults
    resolved = dict(defaults)

    # Layer 2: Apply custom_settings from feature config
    if feature_config.custom_settings:
        resolved.update(feature_config.custom_settings)

    # Layer 3: Apply structured difficulty settings if present
    if feature_config.difficulty is not None:
        diff = feature_config.difficulty
        # Map DifficultyConfig.level to the plugin's difficulty_level key
        resolved["difficulty_level"] = diff.level.value
        resolved["adaptive_difficulty"] = diff.adaptive
        if diff.adaptive:
            resolved["min_difficulty"] = diff.min_level.value
            resolved["max_difficulty"] = diff.max_level.value
            resolved["progression_threshold"] = diff.progression_threshold

    # Layer 4: Apply frequency settings for count derivation
    if feature_config.frequency is not None:
        freq = feature_config.frequency
        # If frequency has a max_per_day, use it to cap words_per_day
        if freq.max_per_day is not None:
            current_wpd = resolved.get("words_per_day", 5)
            resolved["words_per_day"] = min(current_wpd, freq.max_per_day)

    return resolved


# ---------------------------------------------------------------------------
# Item scorer — computes relevance scores
# ---------------------------------------------------------------------------


class ItemScorer:
    """Scores vocabulary items based on user preferences.

    The scorer evaluates each candidate item against the user's resolved
    config and assigns a composite relevance score. Items with higher
    scores are more aligned with the user's preferences.
    """

    def __init__(self, weights: RankingWeights | None = None) -> None:
        self._weights = weights or DEFAULT_WEIGHTS

    def score(
        self,
        item: VocabItem,
        config: dict[str, Any],
    ) -> ScoredItem:
        """Score a single item against the user's preferences.

        Returns a ScoredItem with the total score and a breakdown
        of contributing factors.
        """
        breakdown: dict[str, float] = {}

        # --- Difficulty match ---
        target_difficulty = config.get("difficulty_level", "medium")
        if item.difficulty == target_difficulty:
            breakdown["difficulty_match"] = self._weights.difficulty_match
        elif self._is_adjacent_difficulty(item.difficulty, target_difficulty):
            breakdown["difficulty_adjacent"] = self._weights.difficulty_adjacent
        else:
            breakdown["difficulty_mismatch"] = 0.0

        # --- Topic match ---
        target_topics = config.get("topic_categories", ["general"])
        if isinstance(target_topics, str):
            target_topics = [target_topics]
        if item.topic in target_topics or "general" in target_topics:
            breakdown["topic_match"] = self._weights.topic_match
        else:
            breakdown["topic_miss"] = 0.0

        # --- Category match ---
        target_categories = config.get("content_categories", ["words"])
        if isinstance(target_categories, str):
            target_categories = [target_categories]
        if item.category in target_categories:
            breakdown["category_match"] = self._weights.category_match
        else:
            breakdown["category_miss"] = 0.0

        # --- Content richness bonuses ---
        if config.get("include_examples", True) and item.example:
            breakdown["has_example"] = self._weights.has_example

        if config.get("include_part_of_speech", True) and item.part_of_speech:
            breakdown["has_part_of_speech"] = self._weights.has_part_of_speech

        total = sum(breakdown.values())
        return ScoredItem(item=item, score=total, score_breakdown=breakdown)

    def score_batch(
        self,
        items: list[VocabItem],
        config: dict[str, Any],
    ) -> list[ScoredItem]:
        """Score a batch of items and return them sorted by score (descending)."""
        scored = [self.score(item, config) for item in items]
        scored.sort(key=lambda si: si.score, reverse=True)
        return scored

    @staticmethod
    def _is_adjacent_difficulty(actual: str, target: str) -> bool:
        """Check if two difficulty levels are adjacent on the scale."""
        levels = ["easy", "medium", "hard"]
        try:
            actual_idx = levels.index(actual)
            target_idx = levels.index(target)
            return abs(actual_idx - target_idx) == 1
        except ValueError:
            return False


# ---------------------------------------------------------------------------
# Main content selector — ties everything together
# ---------------------------------------------------------------------------


class PersonalizedContentSelector:
    """Preference-aware content selection for vocabulary learning.

    Orchestrates the full flow:
    1. Query user's feature configuration from the repository
    2. Resolve effective preferences (merge defaults + user overrides)
    3. Generate candidate items via the content engine
    4. Score and rank items based on preference alignment
    5. Return the top-N items with scores and diagnostics

    Parameters
    ----------
    engine:
        The vocabulary content generation engine.
    config_repo:
        Repository for fetching user feature configurations.
        If None, the selector operates in "defaults-only" mode.
    plugin_defaults:
        Default config values from the plugin manifest.
    scorer:
        Custom item scorer (uses default weights if not provided).
    """

    def __init__(
        self,
        engine: VocabContentEngine,
        config_repo: FeatureConfigRepositoryProtocol | None = None,
        plugin_defaults: dict[str, Any] | None = None,
        scorer: ItemScorer | None = None,
    ) -> None:
        self._engine = engine
        self._config_repo = config_repo
        self._plugin_defaults = plugin_defaults or _default_plugin_config()
        self._scorer = scorer or ItemScorer()

    async def select_for_user(
        self,
        user_id: str,
        *,
        count: int | None = None,
        exclude_words: list[str] | None = None,
        intent: str | None = None,
    ) -> SelectionResult:
        """Select personalized vocabulary items for a user.

        Parameters
        ----------
        user_id:
            The user whose preferences to query.
        count:
            Override the number of items to return. If None, uses the
            user's words_per_day setting.
        exclude_words:
            Additional words to exclude (e.g., recently delivered).
        intent:
            Optional intent hint (e.g., "quiz", "daily_word") that may
            influence item selection.

        Returns
        -------
        A SelectionResult with scored, ranked items.
        """
        warnings: list[str] = []

        # Step 1: Fetch user's feature config
        feature_config = await self._fetch_user_config(user_id)

        # Step 2: Resolve effective preferences
        resolved = resolve_user_config(feature_config, self._plugin_defaults)

        # Apply count override
        if count is not None:
            resolved["words_per_day"] = count

        # Apply exclude_words
        if exclude_words:
            existing_excludes = resolved.get("exclude_words", [])
            resolved["exclude_words"] = list(set(existing_excludes + exclude_words))

        # Apply intent-specific adjustments
        if intent:
            resolved = self._adjust_for_intent(resolved, intent)

        # Step 3: Generate broader candidate pool for ranking
        # Request more items than needed so we can rank and select the best
        target_count = resolved.get("words_per_day", 5)
        pool_multiplier = 3  # fetch 3x for ranking pool
        pool_config = dict(resolved)
        pool_config["words_per_day"] = min(
            target_count * pool_multiplier,
            50,  # hard cap for performance
        )

        gen_result = self._engine.generate_from_config(pool_config)
        warnings.extend(gen_result.warnings)

        if gen_result.is_empty:
            logger.warning(
                "No candidates for user=%s config=%s", user_id, resolved,
            )
            return SelectionResult(
                user_id=user_id,
                items=[],
                resolved_config=resolved,
                total_candidates=0,
                warnings=warnings + ["No vocabulary items match your preferences."],
            )

        # Step 4: Score and rank all candidates
        scored_items = self._scorer.score_batch(gen_result.items, resolved)

        # Step 5: Select top-N items
        selected = scored_items[:target_count]

        logger.info(
            "Selected %d/%d items for user=%s (pool=%d, total_avail=%d)",
            len(selected),
            target_count,
            user_id,
            len(gen_result.items),
            gen_result.total_available,
        )

        return SelectionResult(
            user_id=user_id,
            items=selected,
            resolved_config=resolved,
            total_candidates=gen_result.total_available,
            warnings=warnings,
        )

    async def select_for_user_with_config(
        self,
        user_id: str,
        user_config: dict[str, Any],
        *,
        count: int | None = None,
        exclude_words: list[str] | None = None,
    ) -> SelectionResult:
        """Select content using an explicit config dict (no repo lookup).

        Useful when the caller already has the user's config (e.g., from
        a PluginContext) and doesn't need a repository round-trip.
        """
        # Build a FeatureConfiguration from the flat dict
        feature_config = FeatureConfiguration(custom_settings=user_config)
        resolved = resolve_user_config(feature_config, self._plugin_defaults)

        if count is not None:
            resolved["words_per_day"] = count
        if exclude_words:
            resolved["exclude_words"] = list(
                set(resolved.get("exclude_words", []) + exclude_words)
            )

        target_count = resolved.get("words_per_day", 5)
        pool_config = dict(resolved)
        pool_config["words_per_day"] = min(target_count * 3, 50)

        gen_result = self._engine.generate_from_config(pool_config)

        if gen_result.is_empty:
            return SelectionResult(
                user_id=user_id,
                items=[],
                resolved_config=resolved,
                total_candidates=0,
                warnings=gen_result.warnings + [
                    "No vocabulary items match your preferences."
                ],
            )

        scored_items = self._scorer.score_batch(gen_result.items, resolved)
        selected = scored_items[:target_count]

        return SelectionResult(
            user_id=user_id,
            items=selected,
            resolved_config=resolved,
            total_candidates=gen_result.total_available,
            warnings=gen_result.warnings,
        )

    # -- Internal helpers ---------------------------------------------------

    async def _fetch_user_config(
        self, user_id: str
    ) -> FeatureConfiguration | None:
        """Fetch the user's vocab_learning feature configuration."""
        if self._config_repo is None:
            return None
        try:
            return await self._config_repo.get(user_id, VOCAB_FEATURE_NAME)
        except Exception:
            logger.exception(
                "Failed to fetch feature config for user=%s", user_id
            )
            return None

    @staticmethod
    def _adjust_for_intent(
        config: dict[str, Any], intent: str
    ) -> dict[str, Any]:
        """Apply intent-specific tweaks to the resolved config.

        Different intents may benefit from different selection strategies:
        - quiz: prefer items with clear, distinct definitions
        - flashcard: prefer items with examples for the back of the card
        - daily_word: standard selection
        """
        adjusted = dict(config)

        if intent == "quiz":
            # For quizzes, ensure we have enough variety — boost count slightly
            current = adjusted.get("words_per_day", 5)
            adjusted["words_per_day"] = max(current, 4)
        elif intent == "flashcard":
            # For flashcards, prefer items with examples
            adjusted["include_examples"] = True

        return adjusted


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_plugin_config() -> dict[str, Any]:
    """Return the default plugin configuration matching the manifest."""
    return {
        "difficulty_level": "medium",
        "words_per_day": 5,
        "include_examples": True,
        "include_part_of_speech": True,
        "quiz_style": "multiple_choice",
        "content_categories": ["words", "phrases"],
        "target_language": "en",
        "topic_categories": ["general"],
        "review_interval_hours": 24,
    }
