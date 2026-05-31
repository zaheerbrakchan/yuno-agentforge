from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from ..db.database import get_session
from ..db.models import Workflow, Message
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
            "description": "2-agent workflow: Router Agent → Specialist Agent",
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
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{workflow_id}/messages")
async def get_messages(workflow_id: str, session_id: Optional[str] = None, session: AsyncSession = Depends(get_session)):
    query = select(Message).where(Message.workflow_id == workflow_id)
    if session_id:
        query = query.where(Message.session_id == session_id)
    result = await session.exec(query.order_by(Message.created_at))
    return result.all()
