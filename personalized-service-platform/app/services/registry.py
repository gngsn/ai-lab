import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import Service


async def register_service(
    db: AsyncSession,
    name: str,
    description: str,
    available_features: list[str],
    available_channels: list[str],
) -> Service:
    service = Service(
        id=str(uuid.uuid4()),
        name=name,
        description=description,
        available_features=available_features,
        available_channels=available_channels,
    )
    db.add(service)
    await db.commit()
    await db.refresh(service)
    return service


async def list_services(db: AsyncSession) -> list[Service]:
    result = await db.execute(select(Service))
    return list(result.scalars().all())


async def get_service(db: AsyncSession, service_id: str) -> Service | None:
    return await db.get(Service, service_id)
