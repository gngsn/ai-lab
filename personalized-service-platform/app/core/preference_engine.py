import uuid

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import UserPreference


async def get_preference(
    db: AsyncSession, user_id: str, preference_key: str
) -> UserPreference | None:
    """Get a single preference by user_id and key."""
    result = await db.execute(
        select(UserPreference).where(
            UserPreference.user_id == user_id,
            UserPreference.preference_key == preference_key,
        )
    )
    return result.scalar_one_or_none()


async def get_user_preferences(
    db: AsyncSession, user_id: str, prefix: str | None = None
) -> list[UserPreference]:
    """Get all preferences for a user, optionally filtered by key prefix.

    Args:
        db: Database session
        user_id: The user's ID
        prefix: Optional dot-notation prefix to filter keys (e.g. 'vocab' matches 'vocab.difficulty_level')
    """
    stmt = select(UserPreference).where(UserPreference.user_id == user_id)
    if prefix:
        stmt = stmt.where(UserPreference.preference_key.startswith(prefix))
    stmt = stmt.order_by(UserPreference.preference_key)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def set_preference(
    db: AsyncSession,
    user_id: str,
    preference_key: str,
    preference_value: dict | list | str | int | float | bool,
) -> UserPreference:
    """Set a single preference (upsert by user_id + preference_key)."""
    pref = await get_preference(db, user_id, preference_key)
    if pref:
        pref.preference_value = preference_value
    else:
        pref = UserPreference(
            id=str(uuid.uuid4()),
            user_id=user_id,
            preference_key=preference_key,
            preference_value=preference_value,
        )
        db.add(pref)
    await db.commit()
    await db.refresh(pref)
    return pref


async def set_preferences_bulk(
    db: AsyncSession,
    user_id: str,
    preferences: dict[str, dict | list | str | int | float | bool],
) -> list[UserPreference]:
    """Set multiple preferences at once.

    Args:
        db: Database session
        user_id: The user's ID
        preferences: Dict mapping preference_key -> preference_value
    """
    results = []
    for key, value in preferences.items():
        pref = await get_preference(db, user_id, key)
        if pref:
            pref.preference_value = value
        else:
            pref = UserPreference(
                id=str(uuid.uuid4()),
                user_id=user_id,
                preference_key=key,
                preference_value=value,
            )
            db.add(pref)
        results.append(pref)
    await db.commit()
    for pref in results:
        await db.refresh(pref)
    return results


async def delete_preference(
    db: AsyncSession, user_id: str, preference_key: str
) -> bool:
    """Delete a single preference. Returns True if deleted, False if not found."""
    result = await db.execute(
        delete(UserPreference).where(
            UserPreference.user_id == user_id,
            UserPreference.preference_key == preference_key,
        )
    )
    await db.commit()
    return result.rowcount > 0
