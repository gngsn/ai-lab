"""SQLAlchemy-backed implementation of :class:`PreferencesRepository`.

Wraps the existing ``preference_engine`` functions into a class that
satisfies the :class:`PreferencesRepository` protocol and can be injected
as a FastAPI dependency.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import UserPreference
from app.services.preferences_repository_protocol import (
    PreferenceRecord,
    PreferenceValue,
)


def _to_record(pref: UserPreference) -> PreferenceRecord:
    return PreferenceRecord(
        id=pref.id,
        user_id=pref.user_id,
        preference_key=pref.preference_key,
        preference_value=pref.preference_value,
        created_at=str(pref.created_at) if pref.created_at else None,
        updated_at=str(pref.updated_at) if pref.updated_at else None,
    )


class SQLAlchemyPreferencesRepository:
    """Preferences repository backed by SQLAlchemy async sessions.

    Parameters
    ----------
    session:
        An ``AsyncSession`` — typically provided by a FastAPI dependency.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    # -- Read ---------------------------------------------------------------

    async def get(
        self,
        user_id: str,
        preference_key: str,
    ) -> PreferenceRecord | None:
        result = await self._db.execute(
            select(UserPreference).where(
                UserPreference.user_id == user_id,
                UserPreference.preference_key == preference_key,
            )
        )
        pref = result.scalar_one_or_none()
        return _to_record(pref) if pref else None

    async def get_all(
        self,
        user_id: str,
        *,
        prefix: str | None = None,
    ) -> list[PreferenceRecord]:
        stmt = select(UserPreference).where(UserPreference.user_id == user_id)
        if prefix:
            stmt = stmt.where(UserPreference.preference_key.startswith(prefix))
        stmt = stmt.order_by(UserPreference.preference_key)
        result = await self._db.execute(stmt)
        return [_to_record(p) for p in result.scalars().all()]

    # -- Write (upsert) -----------------------------------------------------

    async def set(
        self,
        user_id: str,
        preference_key: str,
        preference_value: PreferenceValue,
    ) -> PreferenceRecord:
        result = await self._db.execute(
            select(UserPreference).where(
                UserPreference.user_id == user_id,
                UserPreference.preference_key == preference_key,
            )
        )
        pref = result.scalar_one_or_none()
        if pref:
            pref.preference_value = preference_value
        else:
            pref = UserPreference(
                id=str(uuid.uuid4()),
                user_id=user_id,
                preference_key=preference_key,
                preference_value=preference_value,
            )
            self._db.add(pref)
        await self._db.commit()
        await self._db.refresh(pref)
        return _to_record(pref)

    async def set_bulk(
        self,
        user_id: str,
        preferences: dict[str, PreferenceValue],
    ) -> list[PreferenceRecord]:
        if not preferences:
            return []
        results: list[UserPreference] = []
        for key, value in preferences.items():
            result = await self._db.execute(
                select(UserPreference).where(
                    UserPreference.user_id == user_id,
                    UserPreference.preference_key == key,
                )
            )
            pref = result.scalar_one_or_none()
            if pref:
                pref.preference_value = value
            else:
                pref = UserPreference(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    preference_key=key,
                    preference_value=value,
                )
                self._db.add(pref)
            results.append(pref)
        await self._db.commit()
        for pref in results:
            await self._db.refresh(pref)
        return [_to_record(p) for p in results]

    # -- Delete -------------------------------------------------------------

    async def delete(
        self,
        user_id: str,
        preference_key: str,
    ) -> bool:
        result = await self._db.execute(
            sa_delete(UserPreference).where(
                UserPreference.user_id == user_id,
                UserPreference.preference_key == preference_key,
            )
        )
        await self._db.commit()
        return result.rowcount > 0
