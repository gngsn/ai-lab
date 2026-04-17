from sqlalchemy import Column, String, JSON, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, relationship

import uuid


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True, unique=True, index=True)
    password_hash = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    preferences = relationship("UserPreference", back_populates="user", cascade="all, delete-orphan")


class Service(Base):
    __tablename__ = "services"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    available_features = Column(JSON, default=list)  # ["words", "phrases", "idioms", ...]
    available_channels = Column(JSON, default=list)   # ["chat", "email", "push", ...]
    created_at = Column(DateTime, server_default=func.now())


class UserPreference(Base):
    """Key-value preference store for per-user configuration.

    Each row represents a single preference setting identified by a
    dot-notation key (e.g. 'vocab.difficulty_level', 'delivery.frequency').
    The value is stored as JSONB, supporting strings, numbers, arrays, and objects.
    """

    __tablename__ = "user_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "preference_key", name="uq_user_preferences_user_key"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    preference_key = Column(String, nullable=False, index=True)
    preference_value = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="preferences")
