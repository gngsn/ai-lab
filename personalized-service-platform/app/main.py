from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.api.feature_config_routes import feature_config_router
from app.bot.webhook_routes import webhook_router
from app.models.database import engine
from app.models.schemas import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Personalized Service Platform",
    description="A platform where users customize what a service does and how it delivers",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router, prefix="/api/v1")
app.include_router(feature_config_router, prefix="/api/v1")
app.include_router(webhook_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}
