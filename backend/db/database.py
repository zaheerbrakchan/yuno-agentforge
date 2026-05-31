import os

from sqlmodel import SQLModel, create_engine
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

# Import models so that SQLModel.metadata is populated before create_all runs.
from . import models  # noqa: F401

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./agentforge.db")

# Normalise a sync sqlite URL (sqlite:///) into the async driver if provided
# that way, so the same env value works for both sync tooling and the app.
if DATABASE_URL.startswith("sqlite:///"):
    DATABASE_URL = DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# A synchronous engine against the same database file, used by LangChain tools
# (which run synchronously) so they can query real data, e.g. the payments table.
SYNC_DATABASE_URL = DATABASE_URL.replace("+aiosqlite", "")
sync_engine = create_engine(SYNC_DATABASE_URL, echo=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session():
    async with AsyncSessionLocal() as session:
        yield session
