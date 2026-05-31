from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from ..db.database import get_session
from ..db.models import Workflow, Message, WorkflowRun
from ..runtime.executor import execute_workflow
from pydantic import BaseModel
from typing import Optional, Dict, Any

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    graph_json: Dict[str, Any] = {}


class RunWorkflowRequest(BaseModel):
    input_message: str
    session_id: Optional[str] = None
    staged_handoff: bool = False
    skip_handoff: bool = False


@router.get("/")
async def list_workflows(session: AsyncSession = Depends(get_session)):
    result = await session.exec(select(Workflow))
    return result.all()


@router.post("/")
async def create_workflow(data: WorkflowCreate, session: AsyncSession = Depends(get_session)):
    workflow = Workflow(**data.dict())
    session.add(workflow)
    await session.commit()
    await session.refresh(workflow)
    return workflow


@router.delete("/runs/{run_id}")
async def delete_workflow_run(run_id: str, session: AsyncSession = Depends(get_session)):
    """Remove a single workflow run from history (dashboard recent runs)."""
    run = await session.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    await session.delete(run)
    await session.commit()
    return {"ok": True}


async def _delete_session_data(session: AsyncSession, session_id: str) -> int:
    """Remove every message and run record for a session (may span workflows after handoff)."""
    messages = (
        await session.exec(select(Message).where(Message.session_id == session_id))
    ).all()
    if not messages:
        raise HTTPException(404, "Session not found")

    for msg in messages:
        await session.delete(msg)

    runs = (
        await session.exec(select(WorkflowRun).where(WorkflowRun.session_id == session_id))
    ).all()
    for run in runs:
        await session.delete(run)

    await session.commit()
    return len(messages)


@router.delete("/sessions/{session_id}")
async def delete_session_by_id(session_id: str, session: AsyncSession = Depends(get_session)):
    """Delete a conversation and all related messages/runs across workflows."""
    deleted = await _delete_session_data(session, session_id)
    return {"ok": True, "deleted_messages": deleted}


@router.delete("/{workflow_id}/sessions/{session_id}")
async def delete_session(
    workflow_id: str,
    session_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete all messages (and run records) for a conversation session."""
    workflow = await session.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    deleted = await _delete_session_data(session, session_id)
    return {"ok": True, "deleted_messages": deleted}


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    workflow = await session.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    await session.delete(workflow)
    await session.commit()
    return {"ok": True}


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: str, data: WorkflowCreate, session: AsyncSession = Depends(get_session)):
    workflow = await session.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    workflow.name = data.name
    workflow.description = data.description
    workflow.graph_json = data.graph_json
    session.add(workflow)
    await session.commit()
    await session.refresh(workflow)
    return workflow


@router.get("/templates")
async def get_templates():
    return [
        {
            "id": "payment-investigator",
            "name": "Payment failure investigator",
            "description": "3-agent workflow: Orchestrator → Payment Analyst → Response Writer",
            "graph_json": {
                "nodes": [
                    {"id": "orchestrator", "agent_id": "orchestrator", "position": {"x": 100, "y": 200}},
                    {"id": "analyst", "agent_id": "analyst", "position": {"x": 400, "y": 200}},
                    {"id": "responder", "agent_id": "responder", "position": {"x": 700, "y": 200}},
                ],
                "edges": [
                    {"source": "orchestrator", "target": "analyst"},
                    {"source": "analyst", "target": "responder"},
                ]
            }
        },
        {
            "id": "support-router",
            "name": "Customer support router",
            "description": "General support (no order lookup): Support Router → General Support Agent — payment methods, hours, refunds, regions",
            "graph_json": {
                "nodes": [
                    {"id": "router", "agent_id": "router", "position": {"x": 100, "y": 200}},
                    {"id": "specialist", "agent_id": "specialist", "position": {"x": 400, "y": 200}},
                ],
                "edges": [
                    {"source": "router", "target": "specialist"},
                ]
            }
        }
    ]


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: str,
    req: RunWorkflowRequest,
    session: AsyncSession = Depends(get_session)
):
    try:
        return await execute_workflow(
            workflow_id=workflow_id,
            input_message=req.input_message,
            session=session,
            session_id=req.session_id,
            from_agent="human",
            allow_handoff=not req.skip_handoff,
            staged_handoff=req.staged_handoff,
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/sessions/list")
async def list_sessions(session: AsyncSession = Depends(get_session)):
    """All conversation sessions across workflows (for Monitor sidebar)."""
    rows = (await session.exec(select(Message).order_by(Message.created_at))).all()
    map: dict = {}
    for m in rows:
        sid = m.session_id
        if sid not in map:
            map[sid] = {
                "session_id": sid,
                "last": m.created_at,
                "count": 0,
                "preview": "",
                "workflow_id": m.workflow_id,
            }
        map[sid]["count"] += 1
        if m.created_at > map[sid]["last"]:
            map[sid]["last"] = m.created_at
        if m.message_type == "human_input" and not map[sid]["preview"]:
            map[sid]["preview"] = m.content[:42]
            map[sid]["workflow_id"] = m.workflow_id
    return sorted(map.values(), key=lambda x: x["last"] or "", reverse=True)


@router.get("/{workflow_id}/messages")
async def get_messages(workflow_id: str, session_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    if session_id:
        # A session may span workflows after an automatic handoff — return the full thread.
        query = select(Message).where(Message.session_id == session_id)
    else:
        query = select(Message).where(Message.workflow_id == workflow_id)
    result = await session.exec(query.order_by(Message.created_at))
    return result.all()
