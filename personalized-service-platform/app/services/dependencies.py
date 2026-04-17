"""FastAPI dependency providers for the preferences and feature config repositories.

The active backend is selected based on the ``PREFERENCES_BACKEND``
environment variable:

- ``"supabase"`` → :class:`UserPreferencesRepository` (Supabase PostgREST)
- ``"sqlalchemy"`` (default) → :class:`SQLAlchemyPreferencesRepository`

Usage in routes::

    from app.services.dependencies import get_preferences_repo, get_feature_config_repo

    @router.get("/users/{user_id}/preferences")
    async def list_preferences(
        user_id: str,
        repo: PreferencesRepository = Depends(get_preferences_repo),
    ):
        ...

    @router.get("/users/{user_id}/features/{feature_name}/config")
    async def get_feature_config(
        user_id: str,
        feature_name: str,
        repo: FeatureConfigRepository = Depends(get_feature_config_repo),
    ):
        ...
"""

from __future__ import annotations

import os
from typing import AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db
from app.services.preferences_repository_protocol import PreferencesRepository
from app.services.sqlalchemy_preferences_repository import SQLAlchemyPreferencesRepository
from app.services.feature_config_repository import FeatureConfigRepository


def _backend() -> str:
    return os.environ.get("PREFERENCES_BACKEND", "sqlalchemy").lower()


async def get_preferences_repo(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[PreferencesRepository, None]:
    """Yield the active preferences repository.

    The repository is scoped to the current request's DB session when using
    the SQLAlchemy backend, or stateless when using Supabase.
    """
    backend = _backend()

    if backend == "supabase":
        # Lazy import to avoid hard crash when supabase env vars are absent
        from app.services.user_preferences_repository import UserPreferencesRepository
        yield UserPreferencesRepository()
    else:
        yield SQLAlchemyPreferencesRepository(db)


async def get_feature_config_repo(
    preferences_repo: PreferencesRepository = Depends(get_preferences_repo),
) -> AsyncGenerator[FeatureConfigRepository, None]:
    """Yield a FeatureConfigRepository wrapping the active preferences backend.

    Schemas can be registered at application startup via the singleton or
    by calling ``register_schema`` on the returned repository.
    """
    repo = FeatureConfigRepository(preferences_repo)

    # Auto-register known schemas from the module-level schema registry
    from app.services.feature_config_repository import get_schema_registry
    for name, schema in get_schema_registry().items():
        repo.register_schema(schema)

    yield repo
