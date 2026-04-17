"""Feature configuration CRUD API endpoints.

Provides REST endpoints for creating, reading, updating, and deleting
per-feature settings with input validation against registered schemas.

Endpoints:
    POST   /users/{user_id}/features/{feature_name}/config       — Create config
    GET    /users/{user_id}/features/{feature_name}/config        — Read single
    GET    /users/{user_id}/features/config                       — Read all
    PUT    /users/{user_id}/features/{feature_name}/config        — Full replace
    PATCH  /users/{user_id}/features/{feature_name}/config        — Partial update
    DELETE /users/{user_id}/features/{feature_name}/config        — Delete single
    DELETE /users/{user_id}/features/config                       — Delete all

    GET    /features/{feature_name}/config/schema                 — Get schema
    POST   /features/{feature_name}/config/validate               — Validate only

Design principles:
- **preference_granularity**: Each feature has structured, validated settings
- **plugin_isolation**: Validates against schemas without depending on plugin code
- **channel_agnosticism**: Configuration layer is delivery-channel agnostic
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator

from app.models.feature_config import (
    DifficultyConfig,
    FeatureConfiguration,
    FrequencyConfig,
    ScheduleConfig,
)
from app.services.dependencies import get_feature_config_repo
from app.services.feature_config_repository import FeatureConfigRepository

feature_config_router = APIRouter(tags=["feature-config"])


# ---------------------------------------------------------------------------
# Request / Response DTOs
# ---------------------------------------------------------------------------


class FeatureConfigCreateRequest(BaseModel):
    """Request body for creating a new feature configuration.

    All fields are optional — omitted fields use defaults.
    """

    enabled: bool = Field(default=True, description="Whether this feature is active")
    custom_settings: dict[str, Any] = Field(
        default_factory=dict,
        description="Plugin-specific settings (validated against schema)",
    )
    frequency: FrequencyConfig | None = Field(
        default=None, description="How often content is delivered"
    )
    schedule: ScheduleConfig | None = Field(
        default=None, description="When content is delivered"
    )
    difficulty: DifficultyConfig | None = Field(
        default=None, description="Difficulty settings"
    )

    @field_validator("custom_settings")
    @classmethod
    def custom_settings_keys_valid(cls, v: dict[str, Any]) -> dict[str, Any]:
        """Ensure custom_settings keys are non-empty strings."""
        for key in v:
            if not key or not isinstance(key, str):
                raise ValueError(f"Invalid setting key: {key!r}")
            if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", key):
                raise ValueError(
                    f"Setting key '{key}' must be alphanumeric with underscores, "
                    "starting with a letter or underscore"
                )
        return v

    def to_feature_configuration(self) -> FeatureConfiguration:
        """Convert to the internal FeatureConfiguration model."""
        return FeatureConfiguration(
            enabled=self.enabled,
            custom_settings=self.custom_settings,
            frequency=self.frequency,
            schedule=self.schedule,
            difficulty=self.difficulty,
        )


class FeatureConfigUpdateRequest(BaseModel):
    """Request body for partially updating a feature configuration.

    All fields are optional — only provided fields are merged.
    Uses deep-merge semantics for nested structures.
    """

    enabled: bool | None = Field(default=None, description="Whether this feature is active")
    custom_settings: dict[str, Any] | None = Field(
        default=None,
        description="Plugin-specific settings to merge (not replace)",
    )
    frequency: FrequencyConfig | None = Field(
        default=None, description="Frequency settings override"
    )
    schedule: ScheduleConfig | None = Field(
        default=None, description="Schedule settings override"
    )
    difficulty: DifficultyConfig | None = Field(
        default=None, description="Difficulty settings override"
    )

    @field_validator("custom_settings")
    @classmethod
    def custom_settings_keys_valid(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is None:
            return v
        for key in v:
            if not key or not isinstance(key, str):
                raise ValueError(f"Invalid setting key: {key!r}")
            if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", key):
                raise ValueError(
                    f"Setting key '{key}' must be alphanumeric with underscores, "
                    "starting with a letter or underscore"
                )
        return v

    def to_overrides_dict(self) -> dict[str, Any]:
        """Convert to a flat overrides dict for merge_with()."""
        overrides: dict[str, Any] = {}
        if self.enabled is not None:
            overrides["enabled"] = self.enabled
        if self.custom_settings is not None:
            overrides["custom_settings"] = self.custom_settings
        if self.frequency is not None:
            overrides["frequency"] = self.frequency.model_dump()
        if self.schedule is not None:
            overrides["schedule"] = self.schedule.model_dump()
        if self.difficulty is not None:
            overrides["difficulty"] = self.difficulty.model_dump()
        return overrides


class FeatureConfigResponse(BaseModel):
    """Response for a single feature configuration."""

    user_id: str
    feature_name: str
    config: FeatureConfigDTO
    validation_errors: list[str] = []
    validation_warnings: list[str] = []


class FeatureConfigDTO(BaseModel):
    """Serialized feature configuration."""

    enabled: bool = True
    custom_settings: dict[str, Any] = {}
    frequency: FrequencyConfig | None = None
    schedule: ScheduleConfig | None = None
    difficulty: DifficultyConfig | None = None

    @classmethod
    def from_feature_configuration(cls, config: FeatureConfiguration) -> FeatureConfigDTO:
        return cls(
            enabled=config.enabled,
            custom_settings=config.custom_settings,
            frequency=config.frequency,
            schedule=config.schedule,
            difficulty=config.difficulty,
        )


class FeatureConfigListResponse(BaseModel):
    """Response listing all feature configurations for a user."""

    user_id: str
    configs: dict[str, FeatureConfigDTO]
    total: int


class FeatureConfigDeleteResponse(BaseModel):
    """Response for delete operations."""

    deleted: bool
    feature_name: str | None = None
    deleted_count: int | None = None


class FeatureConfigValidateRequest(BaseModel):
    """Request body for validating a configuration without persisting."""

    enabled: bool = True
    custom_settings: dict[str, Any] = Field(default_factory=dict)
    frequency: FrequencyConfig | None = None
    schedule: ScheduleConfig | None = None
    difficulty: DifficultyConfig | None = None

    def to_feature_configuration(self) -> FeatureConfiguration:
        return FeatureConfiguration(
            enabled=self.enabled,
            custom_settings=self.custom_settings,
            frequency=self.frequency,
            schedule=self.schedule,
            difficulty=self.difficulty,
        )


class FeatureConfigValidationResponse(BaseModel):
    """Result of validating a feature configuration."""

    valid: bool
    feature_name: str
    errors: list[str] = []
    warnings: list[str] = []
    schema_registered: bool = False


class FeatureConfigSchemaResponse(BaseModel):
    """Schema description for a feature's configuration options."""

    feature_name: str
    version: str
    supports_frequency: bool = False
    supports_schedule: bool = False
    supports_difficulty: bool = False
    options: list[FeatureConfigSchemaOptionDTO] = []


class FeatureConfigSchemaOptionDTO(BaseModel):
    """A single config option from a feature's schema."""

    key: str
    label: str
    description: str = ""
    type: str
    default: Any = None
    required: bool = False
    choices: list[str] | None = None
    constraints: dict[str, Any] | None = None
    group: str | None = None


# ---------------------------------------------------------------------------
# Path parameter validation
# ---------------------------------------------------------------------------

_FEATURE_NAME_PATTERN = r"^[a-zA-Z_][a-zA-Z0-9_-]*$"


def _validate_feature_name(feature_name: str) -> str:
    """Validate that a feature name is well-formed."""
    if not feature_name or len(feature_name) > 100:
        raise HTTPException(
            status_code=400,
            detail="Feature name must be 1-100 characters",
        )
    if not re.match(_FEATURE_NAME_PATTERN, feature_name):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid feature name '{feature_name}'. "
                "Must start with a letter or underscore and contain only "
                "alphanumeric characters, underscores, or hyphens."
            ),
        )
    return feature_name


def _validate_user_id(user_id: str) -> str:
    """Validate that a user ID is non-empty."""
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="User ID must not be empty")
    return user_id


# ---------------------------------------------------------------------------
# Helper: convert FeatureConfigRecord to response
# ---------------------------------------------------------------------------


def _record_to_response(record) -> FeatureConfigResponse:
    return FeatureConfigResponse(
        user_id=record.user_id,
        feature_name=record.feature_name,
        config=FeatureConfigDTO.from_feature_configuration(record.config),
        validation_errors=record.validation_errors,
        validation_warnings=record.validation_warnings,
    )


# ---------------------------------------------------------------------------
# CREATE — POST /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


@feature_config_router.post(
    "/users/{user_id}/features/{feature_name}/config",
    response_model=FeatureConfigResponse,
    status_code=201,
    summary="Create feature configuration",
    description="Create a new per-feature configuration for a user. Returns 409 if config already exists.",
)
async def create_feature_config(
    user_id: str,
    feature_name: str,
    req: FeatureConfigCreateRequest,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)
    _validate_feature_name(feature_name)

    # Check if config already exists
    existing = await repo.get(user_id, feature_name)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Configuration for feature '{feature_name}' already exists. "
            "Use PUT to replace or PATCH to update.",
        )

    config = req.to_feature_configuration()

    # Validate against schema if registered
    errors, warnings = repo.validate(feature_name, config)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"Validation failed for feature '{feature_name}'",
                "errors": errors,
                "warnings": warnings,
            },
        )

    record = await repo.set(user_id, feature_name, config)
    return _record_to_response(record)


# ---------------------------------------------------------------------------
# READ — GET /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


@feature_config_router.get(
    "/users/{user_id}/features/{feature_name}/config",
    response_model=FeatureConfigResponse,
    summary="Get feature configuration",
    description="Get the per-feature configuration for a specific feature. Returns defaults if not set.",
)
async def get_feature_config(
    user_id: str,
    feature_name: str,
    include_defaults: bool = Query(
        default=False,
        description="If true, return schema defaults when no config is saved",
    ),
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)
    _validate_feature_name(feature_name)

    if include_defaults:
        config = await repo.get_or_default(user_id, feature_name)
    else:
        config = await repo.get(user_id, feature_name)
        if config is None:
            raise HTTPException(
                status_code=404,
                detail=f"No configuration found for feature '{feature_name}'",
            )

    errors, warnings = repo.validate(feature_name, config)
    return FeatureConfigResponse(
        user_id=user_id,
        feature_name=feature_name,
        config=FeatureConfigDTO.from_feature_configuration(config),
        validation_errors=errors,
        validation_warnings=warnings,
    )


# ---------------------------------------------------------------------------
# READ ALL — GET /users/{user_id}/features/config
# ---------------------------------------------------------------------------


@feature_config_router.get(
    "/users/{user_id}/features/config",
    response_model=FeatureConfigListResponse,
    summary="List all feature configurations",
    description="Get all per-feature configurations for a user.",
)
async def list_feature_configs(
    user_id: str,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)

    configs = await repo.get_all(user_id)
    config_dtos = {
        name: FeatureConfigDTO.from_feature_configuration(config)
        for name, config in configs.items()
    }
    return FeatureConfigListResponse(
        user_id=user_id,
        configs=config_dtos,
        total=len(config_dtos),
    )


# ---------------------------------------------------------------------------
# FULL REPLACE — PUT /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


@feature_config_router.put(
    "/users/{user_id}/features/{feature_name}/config",
    response_model=FeatureConfigResponse,
    summary="Replace feature configuration",
    description="Fully replace the per-feature configuration. Creates if not exists.",
)
async def replace_feature_config(
    user_id: str,
    feature_name: str,
    req: FeatureConfigCreateRequest,
    validate: bool = Query(
        default=True,
        description="Whether to reject invalid configurations (422) or save with warnings",
    ),
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)
    _validate_feature_name(feature_name)

    config = req.to_feature_configuration()

    errors, warnings = repo.validate(feature_name, config)
    if validate and errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"Validation failed for feature '{feature_name}'",
                "errors": errors,
                "warnings": warnings,
            },
        )

    record = await repo.set(user_id, feature_name, config)
    return _record_to_response(record)


# ---------------------------------------------------------------------------
# PARTIAL UPDATE — PATCH /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


@feature_config_router.patch(
    "/users/{user_id}/features/{feature_name}/config",
    response_model=FeatureConfigResponse,
    summary="Partially update feature configuration",
    description=(
        "Merge updates into the existing configuration. Only provided fields "
        "are changed; omitted fields remain untouched. Deep-merge semantics "
        "for custom_settings."
    ),
)
async def update_feature_config(
    user_id: str,
    feature_name: str,
    req: FeatureConfigUpdateRequest,
    validate: bool = Query(
        default=True,
        description="Whether to reject invalid configurations (422) or save with warnings",
    ),
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)
    _validate_feature_name(feature_name)

    overrides = req.to_overrides_dict()
    if not overrides:
        raise HTTPException(
            status_code=400,
            detail="No fields provided for update",
        )

    record = await repo.update(user_id, feature_name, overrides)

    if validate and record.validation_errors:
        # Rollback is not needed since repo.update already saved;
        # but we return 422 to signal the caller about issues.
        # The caller can use validate=false to accept warnings.
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"Validation failed for feature '{feature_name}' after merge",
                "errors": record.validation_errors,
                "warnings": record.validation_warnings,
            },
        )

    return _record_to_response(record)


# ---------------------------------------------------------------------------
# DELETE — DELETE /users/{user_id}/features/{feature_name}/config
# ---------------------------------------------------------------------------


@feature_config_router.delete(
    "/users/{user_id}/features/{feature_name}/config",
    response_model=FeatureConfigDeleteResponse,
    summary="Delete feature configuration",
    description="Delete a user's configuration for a specific feature.",
)
async def delete_feature_config(
    user_id: str,
    feature_name: str,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)
    _validate_feature_name(feature_name)

    deleted = await repo.delete(user_id, feature_name)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"No configuration found for feature '{feature_name}'",
        )
    return FeatureConfigDeleteResponse(deleted=True, feature_name=feature_name)


# ---------------------------------------------------------------------------
# DELETE ALL — DELETE /users/{user_id}/features/config
# ---------------------------------------------------------------------------


@feature_config_router.delete(
    "/users/{user_id}/features/config",
    response_model=FeatureConfigDeleteResponse,
    summary="Delete all feature configurations",
    description="Delete all per-feature configurations for a user.",
)
async def delete_all_feature_configs(
    user_id: str,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_user_id(user_id)

    count = await repo.delete_all(user_id)
    return FeatureConfigDeleteResponse(deleted=count > 0, deleted_count=count)


# ---------------------------------------------------------------------------
# SCHEMA — GET /features/{feature_name}/config/schema
# ---------------------------------------------------------------------------


@feature_config_router.get(
    "/features/{feature_name}/config/schema",
    response_model=FeatureConfigSchemaResponse,
    summary="Get feature config schema",
    description=(
        "Get the configuration schema for a feature, describing all "
        "available settings, their types, defaults, and constraints."
    ),
)
async def get_feature_config_schema(
    feature_name: str,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_feature_name(feature_name)

    schema = repo.get_schema(feature_name)
    if schema is None:
        raise HTTPException(
            status_code=404,
            detail=f"No configuration schema registered for feature '{feature_name}'",
        )

    options = [
        FeatureConfigSchemaOptionDTO(
            key=opt.key,
            label=opt.label,
            description=opt.description,
            type=opt.type,
            default=opt.default,
            required=opt.required,
            choices=opt.choices,
            constraints=(
                opt.constraints.model_dump(exclude_none=True)
                if opt.constraints
                else None
            ),
            group=opt.group,
        )
        for opt in schema.options
    ]

    return FeatureConfigSchemaResponse(
        feature_name=schema.feature_name,
        version=schema.version,
        supports_frequency=schema.supports_frequency,
        supports_schedule=schema.supports_schedule,
        supports_difficulty=schema.supports_difficulty,
        options=options,
    )


# ---------------------------------------------------------------------------
# VALIDATE — POST /features/{feature_name}/config/validate
# ---------------------------------------------------------------------------


@feature_config_router.post(
    "/features/{feature_name}/config/validate",
    response_model=FeatureConfigValidationResponse,
    summary="Validate feature configuration",
    description=(
        "Validate a feature configuration against its schema without "
        "persisting. Useful for client-side validation before saving."
    ),
)
async def validate_feature_config(
    feature_name: str,
    req: FeatureConfigValidateRequest,
    repo: FeatureConfigRepository = Depends(get_feature_config_repo),
):
    _validate_feature_name(feature_name)

    config = req.to_feature_configuration()
    schema = repo.get_schema(feature_name)
    errors, warnings = repo.validate(feature_name, config)

    return FeatureConfigValidationResponse(
        valid=len(errors) == 0,
        feature_name=feature_name,
        errors=errors,
        warnings=warnings,
        schema_registered=schema is not None,
    )
