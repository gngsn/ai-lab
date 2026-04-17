from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.feature_config import (
    DifficultyConfig,
    FeatureConfiguration,
    FrequencyConfig,
    ScheduleConfig,
)


class CreateUserRequest(BaseModel):
    name: str


class RegisterUserRequest(BaseModel):
    """Registration request with email, password, and display name."""
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty")
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or fewer")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(v) > 128:
            raise ValueError("Password must be 128 characters or fewer")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        if not any(c.isalpha() for c in v):
            raise ValueError("Password must contain at least one letter")
        return v


class RegisterUserResponse(BaseModel):
    id: str
    name: str
    email: str
    created_at: str | None = None


class UserResponse(BaseModel):
    id: str
    name: str


class RegisterServiceRequest(BaseModel):
    name: str
    description: str = ""
    available_features: list[str]
    available_channels: list[str]


class ServiceResponse(BaseModel):
    id: str
    name: str
    description: str
    available_features: list[str]
    available_channels: list[str]


# --- Preferences (key-value) ---


class SetPreferenceRequest(BaseModel):
    """Set a single preference by key."""
    preference_key: str
    preference_value: Any


class SetPreferencesBulkRequest(BaseModel):
    """Set multiple preferences at once. Keys are dot-notation strings."""
    preferences: dict[str, Any]


class PreferenceResponse(BaseModel):
    id: str
    user_id: str
    preference_key: str
    preference_value: Any
    created_at: str | None = None
    updated_at: str | None = None


class PreferenceListResponse(BaseModel):
    user_id: str
    preferences: list[PreferenceResponse]


class FeatureSettingsDTO(BaseModel):
    """Per-feature configurable settings (not just toggles).

    Each feature can have arbitrary JSON settings — the schema is defined
    by the plugin that owns the feature.

    Supports both untyped settings (dict) and typed structured settings
    (frequency, schedule, difficulty) with full validation.

    Example for "vocab":
        {
            "enabled": true,
            "settings": {"difficulty_level": "hard", "words_per_day": 10},
            "frequency": {"value": 3, "unit": "daily"},
            "schedule": {"active_days": ["monday", "wednesday", "friday"]},
            "difficulty": {"level": "hard", "adaptive": true}
        }
    """
    enabled: bool = True
    settings: dict[str, Any] = {}
    frequency: FrequencyConfig | None = None
    schedule: ScheduleConfig | None = None
    difficulty: DifficultyConfig | None = None

    def to_feature_configuration(self) -> FeatureConfiguration:
        """Convert to the full FeatureConfiguration model."""
        return FeatureConfiguration(
            enabled=self.enabled,
            frequency=self.frequency,
            schedule=self.schedule,
            difficulty=self.difficulty,
            custom_settings=self.settings,
        )

    @classmethod
    def from_feature_configuration(
        cls, config: FeatureConfiguration,
    ) -> "FeatureSettingsDTO":
        """Create from a FeatureConfiguration model."""
        return cls(
            enabled=config.enabled,
            settings=config.custom_settings,
            frequency=config.frequency,
            schedule=config.schedule,
            difficulty=config.difficulty,
        )


class UserPreferencesDTO(BaseModel):
    """Structured view of a user's full preferences.

    This groups key-value preferences into a high-level schema:
    - **selected_features**: which service features the user has opted into
    - **channels**: preferred delivery channels (ordered by priority)
    - **feature_settings**: per-feature configuration (granular, not just on/off)
    - **global_settings**: cross-cutting preferences (e.g. language, timezone)
    """
    selected_features: list[str] = []
    channels: list[str] = []
    feature_settings: dict[str, FeatureSettingsDTO] = {}
    global_settings: dict[str, Any] = {}


class UserPreferencesUpdateDTO(BaseModel):
    """Request body for PUT /api/users/:id/preferences.

    All fields are optional — only provided fields are updated (merge semantics).
    """
    selected_features: list[str] | None = None
    channels: list[str] | None = None
    feature_settings: dict[str, FeatureSettingsDTO] | None = None
    global_settings: dict[str, Any] | None = None


class UserPreferencesResponseDTO(BaseModel):
    """Response for structured preferences endpoints."""
    user_id: str
    preferences: UserPreferencesDTO
    updated_keys: list[str] | None = None


class UserPreferencesUpdateValidatedDTO(BaseModel):
    """Request body for PUT with validation against the feature/channel registry.

    Same as ``UserPreferencesUpdateDTO`` but adds ``run_validation`` flag.
    """
    model_config = {"populate_by_name": True}

    selected_features: list[str] | None = None
    channels: list[str] | None = None
    feature_settings: dict[str, FeatureSettingsDTO] | None = None
    global_settings: dict[str, Any] | None = None
    run_validation: bool = Field(default=True, alias="validate", description="Whether to validate against registry")


class ValidationResultDTO(BaseModel):
    """Structured validation result for preference selections."""
    valid: bool
    errors: list[str] = []
    warnings: list[str] = []


class FeatureConfigOptionDTO(BaseModel):
    """Schema for a user-configurable option with constraint support."""
    key: str
    label: str
    description: str = ""
    type: str
    default: Any = None
    required: bool = False
    choices: list[str] | None = None
    constraints: dict[str, Any] | None = None
    group: str | None = None


class AvailableFeatureDTO(BaseModel):
    """Public description of an available feature."""
    name: str
    display_name: str = ""
    description: str = ""
    capabilities: list[str] = []
    config_options: list[FeatureConfigOptionDTO] = []
    version: str = ""


class AvailableChannelDTO(BaseModel):
    """Public description of a supported channel."""
    name: str
    channel_type: str = ""
    supports_rich_content: bool = True
    supports_buttons: bool = False
    supports_images: bool = False
    supports_files: bool = False
    max_message_length: int | None = None


class AvailableFeaturesResponse(BaseModel):
    """Response listing all available features."""
    features: list[AvailableFeatureDTO]
    total: int


class AvailableChannelsResponse(BaseModel):
    """Response listing all supported channels."""
    channels: list[AvailableChannelDTO]
    total: int


class RegistrySummaryResponse(BaseModel):
    """Combined features + channels summary."""
    features: list[AvailableFeatureDTO]
    channels: list[AvailableChannelDTO]
    feature_count: int
    channel_count: int


class DeliverRequest(BaseModel):
    content: dict


class DeliveryResult(BaseModel):
    channel: str
    status: str
