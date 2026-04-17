import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dto import (
    AvailableChannelDTO,
    AvailableChannelsResponse,
    AvailableFeatureDTO,
    AvailableFeaturesResponse,
    CreateUserRequest,
    DeliverRequest,
    FeatureConfigOptionDTO,
    FeatureSettingsDTO,
    PreferenceListResponse,
    PreferenceResponse,
    RegisterServiceRequest,
    RegisterUserRequest,
    RegisterUserResponse,
    RegistrySummaryResponse,
    ServiceResponse,
    SetPreferenceRequest,
    SetPreferencesBulkRequest,
    UserPreferencesDTO,
    UserPreferencesResponseDTO,
    UserPreferencesUpdateDTO,
    UserPreferencesUpdateValidatedDTO,
    UserResponse,
    ValidationResultDTO,
)
from app.core.security import hash_password
from app.core.feature_channel_registry import get_feature_channel_registry
from app.delivery.router import deliver_to_user
from app.models.database import get_db
from app.models.schemas import User
from app.services.dependencies import get_preferences_repo
from app.services.preferences_repository_protocol import PreferencesRepository
from app.services.registry import get_service, list_services, register_service

router = APIRouter()


# --- Users ---


@router.post("/users", response_model=UserResponse)
async def create_user(req: CreateUserRequest, db: AsyncSession = Depends(get_db)):
    user = User(id=str(uuid.uuid4()), name=req.name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse(id=user.id, name=user.name)


@router.post("/users/register", response_model=RegisterUserResponse, status_code=201)
async def register_user(req: RegisterUserRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user with email, password, and display name.

    - Validates email format and password strength
    - Hashes password with bcrypt before persisting
    - Returns 409 if email is already registered
    """
    from sqlalchemy import select

    # Check for duplicate email
    result = await db.execute(select(User).where(User.email == req.email))
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        id=str(uuid.uuid4()),
        name=req.name,
        email=req.email,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return RegisterUserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        created_at=str(user.created_at) if user.created_at else None,
    )


# --- Services ---


@router.post("/services", response_model=ServiceResponse)
async def create_service(req: RegisterServiceRequest, db: AsyncSession = Depends(get_db)):
    service = await register_service(db, req.name, req.description, req.available_features, req.available_channels)
    return ServiceResponse(
        id=service.id,
        name=service.name,
        description=service.description,
        available_features=service.available_features,
        available_channels=service.available_channels,
    )


@router.get("/services", response_model=list[ServiceResponse])
async def get_services(db: AsyncSession = Depends(get_db)):
    services = await list_services(db)
    return [
        ServiceResponse(
            id=s.id,
            name=s.name,
            description=s.description,
            available_features=s.available_features,
            available_channels=s.available_channels,
        )
        for s in services
    ]


# --- Structured Preferences (selected features, channels, per-feature settings) ---

# Well-known preference keys used by the structured preferences layer.
# These map between the flat key-value store and the structured DTO.
_KEY_SELECTED_FEATURES = "features.selected"
_KEY_CHANNELS = "delivery.channels"
_FEATURE_SETTINGS_PREFIX = "feature_settings."
_GLOBAL_SETTINGS_PREFIX = "global."


async def _build_structured_preferences(
    repo: PreferencesRepository, user_id: str
) -> UserPreferencesDTO:
    """Assemble a structured UserPreferencesDTO from flat key-value records."""
    all_prefs = await repo.get_all(user_id)
    prefs_map: dict[str, Any] = {p.preference_key: p.preference_value for p in all_prefs}

    # Selected features
    selected_features = prefs_map.get(_KEY_SELECTED_FEATURES, [])
    if not isinstance(selected_features, list):
        selected_features = [selected_features]

    # Delivery channels
    channels = prefs_map.get(_KEY_CHANNELS, [])
    if not isinstance(channels, list):
        channels = [channels]

    # Per-feature settings (feature_settings.<feature_name> → FeatureSettingsDTO)
    feature_settings: dict[str, FeatureSettingsDTO] = {}
    for key, value in prefs_map.items():
        if key.startswith(_FEATURE_SETTINGS_PREFIX):
            feature_name = key[len(_FEATURE_SETTINGS_PREFIX):]
            if isinstance(value, dict):
                enabled = value.pop("enabled", True)
                feature_settings[feature_name] = FeatureSettingsDTO(
                    enabled=enabled, settings=value
                )
            else:
                feature_settings[feature_name] = FeatureSettingsDTO(
                    enabled=bool(value), settings={}
                )

    # Global settings
    global_settings: dict[str, Any] = {}
    for key, value in prefs_map.items():
        if key.startswith(_GLOBAL_SETTINGS_PREFIX):
            setting_name = key[len(_GLOBAL_SETTINGS_PREFIX):]
            global_settings[setting_name] = value

    return UserPreferencesDTO(
        selected_features=selected_features,
        channels=channels,
        feature_settings=feature_settings,
        global_settings=global_settings,
    )


@router.get("/users/{user_id}/preferences/structured", response_model=UserPreferencesResponseDTO)
async def get_structured_preferences(
    user_id: str,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Get the user's full preferences as a structured object.

    Groups flat key-value preferences into:
    - selected_features: list of opted-in features
    - channels: preferred delivery channels
    - feature_settings: per-feature configuration (granular, not just toggles)
    - global_settings: cross-cutting preferences
    """
    prefs = await _build_structured_preferences(repo, user_id)
    return UserPreferencesResponseDTO(user_id=user_id, preferences=prefs)


@router.put("/users/{user_id}/preferences/structured", response_model=UserPreferencesResponseDTO)
async def update_structured_preferences(
    user_id: str,
    req: UserPreferencesUpdateDTO,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Update the user's preferences using the structured schema.

    Merge semantics: only the fields present in the request body are updated.
    Omitted fields are left unchanged.

    Returns the full preferences after the update, plus the list of keys
    that were written.
    """
    updated_keys: list[str] = []

    if req.selected_features is not None:
        await repo.set(user_id, _KEY_SELECTED_FEATURES, req.selected_features)
        updated_keys.append(_KEY_SELECTED_FEATURES)

    if req.channels is not None:
        await repo.set(user_id, _KEY_CHANNELS, req.channels)
        updated_keys.append(_KEY_CHANNELS)

    if req.feature_settings is not None:
        for feature_name, feature_dto in req.feature_settings.items():
            key = f"{_FEATURE_SETTINGS_PREFIX}{feature_name}"
            value = {"enabled": feature_dto.enabled, **feature_dto.settings}
            await repo.set(user_id, key, value)
            updated_keys.append(key)

    if req.global_settings is not None:
        for setting_name, setting_value in req.global_settings.items():
            key = f"{_GLOBAL_SETTINGS_PREFIX}{setting_name}"
            await repo.set(user_id, key, setting_value)
            updated_keys.append(key)

    prefs = await _build_structured_preferences(repo, user_id)
    return UserPreferencesResponseDTO(
        user_id=user_id,
        preferences=prefs,
        updated_keys=updated_keys,
    )


# --- Feature & Channel Registry ---


@router.get("/registry/features", response_model=AvailableFeaturesResponse)
async def list_available_features():
    """List all available features that users can select in their preferences."""
    registry = get_feature_channel_registry()
    features = registry.list_features()
    return AvailableFeaturesResponse(
        features=[
            AvailableFeatureDTO(
                name=f.name,
                display_name=f.display_name,
                description=f.description,
                capabilities=f.capabilities,
                config_options=[
                    FeatureConfigOptionDTO(
                        key=opt.key,
                        label=opt.label,
                        description=opt.description,
                        type=opt.type,
                        default=opt.default,
                        required=opt.required,
                        choices=opt.choices,
                    )
                    for opt in f.config_options
                ],
                version=f.version,
            )
            for f in features
        ],
        total=len(features),
    )


@router.get("/registry/channels", response_model=AvailableChannelsResponse)
async def list_available_channels():
    """List all supported delivery channels that users can select."""
    registry = get_feature_channel_registry()
    channels = registry.list_channels()
    return AvailableChannelsResponse(
        channels=[
            AvailableChannelDTO(
                name=c.name,
                channel_type=c.channel_type,
                supports_rich_content=c.supports_rich_content,
                supports_buttons=c.supports_buttons,
                supports_images=c.supports_images,
                supports_files=c.supports_files,
                max_message_length=c.max_message_length,
            )
            for c in channels
        ],
        total=len(channels),
    )


@router.get("/registry/summary", response_model=RegistrySummaryResponse)
async def get_registry_summary():
    """Get a combined summary of available features and channels."""
    registry = get_feature_channel_registry()
    features = registry.list_features()
    channels = registry.list_channels()
    return RegistrySummaryResponse(
        features=[
            AvailableFeatureDTO(
                name=f.name,
                display_name=f.display_name,
                description=f.description,
                capabilities=f.capabilities,
                config_options=[
                    FeatureConfigOptionDTO(
                        key=opt.key,
                        label=opt.label,
                        description=opt.description,
                        type=opt.type,
                        default=opt.default,
                        required=opt.required,
                        choices=opt.choices,
                    )
                    for opt in f.config_options
                ],
                version=f.version,
            )
            for f in features
        ],
        channels=[
            AvailableChannelDTO(
                name=c.name,
                channel_type=c.channel_type,
                supports_rich_content=c.supports_rich_content,
                supports_buttons=c.supports_buttons,
                supports_images=c.supports_images,
                supports_files=c.supports_files,
                max_message_length=c.max_message_length,
            )
            for c in channels
        ],
        feature_count=len(features),
        channel_count=len(channels),
    )


@router.post("/registry/validate", response_model=ValidationResultDTO)
async def validate_preference_selections(req: UserPreferencesUpdateValidatedDTO):
    """Validate feature/channel selections without saving.

    Checks that:
    - All selected features are available in the registry
    - All selected channels are supported
    - Feature settings match the config schema
    """
    registry = get_feature_channel_registry()
    feature_settings_raw = None
    if req.feature_settings is not None:
        feature_settings_raw = {
            name: dto.settings for name, dto in req.feature_settings.items()
        }
    result = registry.validate_preferences(
        selected_features=req.selected_features,
        channels=req.channels,
        feature_settings=feature_settings_raw,
    )
    return ValidationResultDTO(
        valid=result.valid,
        errors=result.errors,
        warnings=result.warnings,
    )


@router.put(
    "/users/{user_id}/preferences/structured/validated",
    response_model=UserPreferencesResponseDTO,
)
async def update_structured_preferences_validated(
    user_id: str,
    req: UserPreferencesUpdateValidatedDTO,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Update preferences with validation against the feature/channel registry.

    If ``validate`` is True (the default), selections are checked against the
    registry before persisting. Invalid selections return 422.
    """
    if req.run_validation:
        registry = get_feature_channel_registry()
        feature_settings_raw = None
        if req.feature_settings is not None:
            feature_settings_raw = {
                name: dto.settings for name, dto in req.feature_settings.items()
            }
        validation = registry.validate_preferences(
            selected_features=req.selected_features,
            channels=req.channels,
            feature_settings=feature_settings_raw,
        )
        if not validation.valid:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Preference validation failed",
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                },
            )

    # Persist using same logic as unvalidated endpoint
    updated_keys: list[str] = []

    if req.selected_features is not None:
        await repo.set(user_id, _KEY_SELECTED_FEATURES, req.selected_features)
        updated_keys.append(_KEY_SELECTED_FEATURES)

    if req.channels is not None:
        await repo.set(user_id, _KEY_CHANNELS, req.channels)
        updated_keys.append(_KEY_CHANNELS)

    if req.feature_settings is not None:
        for feature_name, feature_dto in req.feature_settings.items():
            key = f"{_FEATURE_SETTINGS_PREFIX}{feature_name}"
            value = {"enabled": feature_dto.enabled, **feature_dto.settings}
            await repo.set(user_id, key, value)
            updated_keys.append(key)

    if req.global_settings is not None:
        for setting_name, setting_value in req.global_settings.items():
            key = f"{_GLOBAL_SETTINGS_PREFIX}{setting_name}"
            await repo.set(user_id, key, setting_value)
            updated_keys.append(key)

    prefs = await _build_structured_preferences(repo, user_id)
    return UserPreferencesResponseDTO(
        user_id=user_id,
        preferences=prefs,
        updated_keys=updated_keys,
    )


# --- Preferences (key-value, repository-backed) ---


def _record_to_response(rec) -> PreferenceResponse:
    return PreferenceResponse(
        id=rec.id,
        user_id=rec.user_id,
        preference_key=rec.preference_key,
        preference_value=rec.preference_value,
        created_at=str(rec.created_at) if rec.created_at else None,
        updated_at=str(rec.updated_at) if rec.updated_at else None,
    )


@router.get("/users/{user_id}/preferences", response_model=PreferenceListResponse)
async def list_preferences(
    user_id: str,
    prefix: str | None = Query(None, description="Filter by key prefix, e.g. 'vocab'"),
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """List all preferences for a user, optionally filtered by key prefix."""
    prefs = await repo.get_all(user_id, prefix=prefix)
    return PreferenceListResponse(
        user_id=user_id,
        preferences=[_record_to_response(p) for p in prefs],
    )


@router.get("/users/{user_id}/preferences/{preference_key:path}", response_model=PreferenceResponse)
async def get_single_preference(
    user_id: str,
    preference_key: str,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Get a single preference by key."""
    pref = await repo.get(user_id, preference_key)
    if not pref:
        raise HTTPException(status_code=404, detail=f"Preference '{preference_key}' not found")
    return _record_to_response(pref)


@router.put("/users/{user_id}/preferences", response_model=PreferenceResponse)
async def upsert_preference(
    user_id: str,
    req: SetPreferenceRequest,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Set (create or update) a single preference."""
    pref = await repo.set(user_id, req.preference_key, req.preference_value)
    return _record_to_response(pref)


@router.put("/users/{user_id}/preferences/bulk", response_model=PreferenceListResponse)
async def upsert_preferences_bulk(
    user_id: str,
    req: SetPreferencesBulkRequest,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Set multiple preferences at once."""
    prefs = await repo.set_bulk(user_id, req.preferences)
    return PreferenceListResponse(
        user_id=user_id,
        preferences=[_record_to_response(p) for p in prefs],
    )


@router.delete("/users/{user_id}/preferences/{preference_key:path}")
async def remove_preference(
    user_id: str,
    preference_key: str,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Delete a single preference."""
    deleted = await repo.delete(user_id, preference_key)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Preference '{preference_key}' not found")
    return {"deleted": preference_key}


# --- Delivery ---


@router.post("/users/{user_id}/deliver")
async def deliver_content(
    user_id: str,
    req: DeliverRequest,
    repo: PreferencesRepository = Depends(get_preferences_repo),
):
    """Deliver content to a user using their channel preferences."""
    prefs = await repo.get_all(user_id, prefix="delivery")
    if not prefs:
        raise HTTPException(status_code=404, detail="No delivery preferences found — set preferences first")

    # Build channels and settings from key-value preferences
    channels = []
    settings = {}
    for p in prefs:
        if p.preference_key == "delivery.channels":
            channels = p.preference_value if isinstance(p.preference_value, list) else [p.preference_value]
        else:
            settings[p.preference_key] = p.preference_value

    if not channels:
        raise HTTPException(status_code=400, detail="No delivery channels configured")

    results = await deliver_to_user(user_id, channels, req.content, settings)
    return {"delivered_to": results}
