from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from ..db.database import get_session
from ..db.models import TelegramBot, Workflow
from ..telegram import bot as tg
from pydantic import BaseModel
from typing import Optional
import os

router = APIRouter(prefix="/api/channels", tags=["channels"])

DEFAULT_WORKFLOW_NAME = "Payment failure investigator"


class TelegramConnect(BaseModel):
    token: str
    workflow_id: Optional[str] = None
    label: Optional[str] = None


class TelegramUpdate(BaseModel):
    workflow_id: Optional[str] = None


def _mask_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


async def _resolve_workflow(session: AsyncSession, workflow_id: Optional[str]) -> Optional[Workflow]:
    if workflow_id:
        wf = await session.get(Workflow, workflow_id)
        if wf:
            return wf
    return (
        await session.exec(select(Workflow).where(Workflow.name == DEFAULT_WORKFLOW_NAME))
    ).first()


async def _serialize_bot(session: AsyncSession, bot: TelegramBot) -> dict:
    workflow = await _resolve_workflow(session, bot.workflow_id)
    return {
        "id": bot.id,
        "bot_username": bot.bot_username,
        "label": bot.label,
        "token_preview": _mask_token(bot.token),
        "source": bot.source,
        "status": "connected" if tg.is_running(bot.id) else "stopped",
        "workflow_id": workflow.id if workflow else None,
        "workflow_name": workflow.name if workflow else None,
        "uses_default_workflow": bool(workflow and not bot.workflow_id),
    }


@router.get("/")
async def list_channels(session: AsyncSession = Depends(get_session)):
    bots = (await session.exec(select(TelegramBot))).all()
    telegram_bots = [await _serialize_bot(session, b) for b in bots]
    return {
        "telegram": {
            "mode": "webhook" if os.getenv("ENVIRONMENT") == "production" else "polling",
            "bots": telegram_bots,
        },
        "web": {
            "id": "web",
            "name": "Web & API",
            "description": "The Monitor panel and REST API. Always available — pick any workflow per run.",
            "status": "active",
            "mode": "always-on",
        },
    }


@router.post("/telegram")
async def connect_telegram(data: TelegramConnect, session: AsyncSession = Depends(get_session)):
    token = data.token.strip()
    if not token:
        raise HTTPException(400, "A bot token is required")

    existing = (await session.exec(select(TelegramBot).where(TelegramBot.token == token))).first()
    if existing:
        raise HTTPException(400, "This bot is already connected")

    if data.workflow_id:
        wf = await session.get(Workflow, data.workflow_id)
        if not wf:
            raise HTTPException(404, "Workflow not found")

    bot = TelegramBot(token=token, workflow_id=data.workflow_id, label=data.label, source="user")
    session.add(bot)
    await session.commit()
    await session.refresh(bot)

    try:
        username = await tg.start_bot(bot.id, token)
    except ValueError as e:
        await session.delete(bot)
        await session.commit()
        raise HTTPException(400, f"Could not connect to Telegram: {e}")

    bot.bot_username = username
    session.add(bot)
    await session.commit()
    await session.refresh(bot)
    return await _serialize_bot(session, bot)


@router.put("/telegram/{bot_id}")
async def update_telegram(bot_id: str, data: TelegramUpdate, session: AsyncSession = Depends(get_session)):
    bot = await session.get(TelegramBot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    if data.workflow_id:
        wf = await session.get(Workflow, data.workflow_id)
        if not wf:
            raise HTTPException(404, "Workflow not found")
    bot.workflow_id = data.workflow_id
    session.add(bot)
    await session.commit()
    await session.refresh(bot)
    return await _serialize_bot(session, bot)


@router.delete("/telegram/{bot_id}")
async def delete_telegram(bot_id: str, session: AsyncSession = Depends(get_session)):
    bot = await session.get(TelegramBot, bot_id)
    if not bot:
        raise HTTPException(404, "Bot not found")
    await tg.stop_bot(bot_id)
    await session.delete(bot)
    await session.commit()
    return {"ok": True}
