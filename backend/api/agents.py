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
    from ..runtime.tools import AVAILABLE_TOOLS
    return list(AVAILABLE_TOOLS.keys())


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
    runs = runs_result.all()

    workflow_names: dict[str, str] = {}
    if runs:
        wf_ids = {r.workflow_id for r in runs}
        wf_rows = await session.exec(select(Workflow).where(Workflow.id.in_(list(wf_ids))))
        workflow_names = {w.id: w.name for w in wf_rows.all()}

    session_ids = {r.session_id for r in runs}
    msgs_by_session: dict[str, list] = {sid: [] for sid in session_ids}
    if session_ids:
        msg_rows = await session.exec(
            select(Message)
            .where(Message.session_id.in_(list(session_ids)))
            .order_by(Message.created_at)
        )
        for msg in msg_rows.all():
            msgs_by_session.setdefault(msg.session_id, []).append(msg)

    recent_runs = []
    for r in runs:
        session_msgs = msgs_by_session.get(r.session_id, [])
        human_msgs = [m for m in session_msgs if m.message_type == "human_input"]
        human = human_msgs[0] if human_msgs else None

        # Prefer the customer-facing Response Writer reply over internal agent notes.
        writer_reply = next(
            (
                m
                for m in reversed(session_msgs)
                if m.message_type == "agent_response" and m.from_agent == "Response Writer"
            ),
            None,
        )
        agent_responses = [m for m in session_msgs if m.message_type == "agent_response"]
        last_response = writer_reply or (agent_responses[-1] if agent_responses else None)

        channel = "Monitor"
        if human:
            if human.from_agent == "telegram":
                channel = "Telegram"
            elif human.from_agent not in ("human", "Human"):
                channel = human.from_agent.replace("_", " ").title()

        duration_sec = None
        if r.completed_at and r.started_at:
            duration_sec = round((r.completed_at - r.started_at).total_seconds(), 1)

        recent_runs.append({
            "id": r.id,
            "workflow_id": r.workflow_id,
            "workflow_name": workflow_names.get(r.workflow_id, "Unknown workflow"),
            "session_id": r.session_id,
            "status": r.status,
            "channel": channel,
            "user_query": (human.content[:120] + "…") if human and len(human.content) > 120 else (human.content if human else None),
            "agent_reply": (
                (last_response.content[:140] + "…")
                if last_response and len(last_response.content) > 140
                else (last_response.content if last_response else None)
            ),
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "duration_sec": duration_sec,
            "total_tokens": r.total_tokens,
            "total_cost_usd": r.total_cost_usd,
        })

    return {
        "total_agents": total_agents,
        "total_workflows": total_workflows,
        "messages_today": messages_today,
        "total_tokens": total_tokens,
        "recent_runs": recent_runs,
    }
