from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from sqlalchemy import func
from ..db.database import get_session
from ..db.models import Agent, Workflow, Message, WorkflowRun
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter(prefix="/api/agents", tags=["agents"])

# Mounted without the /api/agents prefix so the path is exactly /api/stats.
stats_router = APIRouter(prefix="/api", tags=["stats"])


class AgentCreate(BaseModel):
    name: str
    role: str
    system_prompt: str
    model: str = "claude-sonnet-4-20250514"
    tools: List[str] = []
    memory_enabled: bool = True
    max_tokens: int = 1000


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    tools: Optional[List[str]] = None
    memory_enabled: Optional[bool] = None
    max_tokens: Optional[int] = None


@router.get("/")
async def list_agents(session: AsyncSession = Depends(get_session)):
    result = await session.exec(select(Agent))
    return result.all()


@router.post("/")
async def create_agent(data: AgentCreate, session: AsyncSession = Depends(get_session)):
    agent = Agent(**data.dict())
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.get("/tools/available")
async def get_available_tools():
    return ["lookup_payment", "get_retry_recommendation", "list_supported_payment_methods"]


@router.get("/{agent_id}")
async def get_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.put("/{agent_id}")
async def update_agent(agent_id: str, data: AgentUpdate, session: AsyncSession = Depends(get_session)):
    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    for k, v in data.dict(exclude_none=True).items():
        setattr(agent, k, v)
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    await session.delete(agent)
    await session.commit()
    return {"ok": True}


@stats_router.get("/stats")
async def get_stats(session: AsyncSession = Depends(get_session)):
    total_agents = (await session.exec(select(func.count()).select_from(Agent))).one()
    total_workflows = (await session.exec(select(func.count()).select_from(Workflow))).one()

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    messages_today = (
        await session.exec(
            select(func.count()).select_from(Message).where(Message.created_at >= today_start)
        )
    ).one()

    total_tokens = (await session.exec(select(func.coalesce(func.sum(Message.tokens_used), 0)))).one()

    runs_result = await session.exec(
        select(WorkflowRun).order_by(WorkflowRun.started_at.desc()).limit(10)
    )
    recent_runs = [
        {
            "id": r.id,
            "workflow_id": r.workflow_id,
            "session_id": r.session_id,
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "total_tokens": r.total_tokens,
            "total_cost_usd": r.total_cost_usd,
        }
        for r in runs_result.all()
    ]

    return {
        "total_agents": total_agents,
        "total_workflows": total_workflows,
        "messages_today": messages_today,
        "total_tokens": total_tokens,
        "recent_runs": recent_runs,
    }
