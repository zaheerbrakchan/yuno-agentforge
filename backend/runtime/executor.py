"""Shared workflow execution used by both the HTTP API and the Telegram bot.

Centralising this here guarantees that a workflow behaves identically no matter
which channel triggered it: the same dynamic graph is built from the saved
definition, the same messages are persisted, and the same run record is written.
"""
from sqlmodel import select
from ..db.models import Workflow, WorkflowRun, Agent, Message
from .graph import build_payment_workflow, build_dynamic_workflow
from .handoff import resolve_handoff_target, polish_handoff_message
from langchain_core.messages import HumanMessage, AIMessage
import uuid
from datetime import datetime

# How many prior conversation turns to feed back in as memory.
MEMORY_MESSAGE_LIMIT = 12


# Fallback configs for the hardcoded 3-agent payment flow. Used only when a
# workflow has no usable graph definition (e.g. the synthetic "telegram-default").
_ORCHESTRATOR_CONFIG = {
    "name": "Orchestrator",
    "role": "orchestrator",
    "system_prompt": (
        "You are the orchestrator for a payments support assistant. Read the conversation and the "
        "user's latest message, classify intent, and write a brief internal handoff for the analyst.\n"
        "- Greeting/small talk: no payment lookup needed; the assistant should greet and offer help.\n"
        "- Payment/order problem: if the message contains anything resembling an order ID (e.g. ORD-1234, "
        "or a number the user calls an order), pass it along and instruct an immediate lookup. Only if there "
        "is truly no ID, note that we should ask for it.\n"
        "- Otherwise: briefly summarize the request.\n"
        "Never ask the user to re-confirm an ID they already provided. Be concise and internal."
    ),
    "model": "claude-sonnet-4-20250514",
    "tools": [],
    "max_tokens": 400,
}

_ANALYST_CONFIG = {
    "name": "Payment Analyst",
    "role": "analyst",
    "system_prompt": (
        "You are a payment analyst with tools: lookup_payment and get_retry_recommendation.\n"
        "Call tools ONLY when the user's latest message includes an order ID (e.g. ORD-1234). "
        "Then call lookup_payment, and if failed also get_retry_recommendation, and summarize findings.\n"
        "If the latest message has NO order ID — follow-ups like 'how do I fix it?' or 'can you update it?' — "
        "do NOT call any tools. Payment findings are already in the conversation; answer from that context.\n"
        "If the user greets or reports failure without an order ID, note that you need the order ID. "
        "Keep it short and internal."
    ),
    "model": "claude-sonnet-4-20250514",
    "tools": ["lookup_payment", "get_retry_recommendation"],
    "max_tokens": 1000,
}

_RESPONDER_CONFIG = {
    "name": "Response Writer",
    "role": "responder",
    "system_prompt": (
        "You are the friendly customer-facing voice of a payments support assistant. Using the conversation "
        "and the analyst's notes, write a natural reply (1-3 sentences).\n"
        "- Greeting/small talk: greet warmly and invite them to share an order ID.\n"
        "- Order not found: say you couldn't find that order and ask them to double-check the ID.\n"
        "- Found result: explain the status/failure reason in plain language and give the recommended next step.\n"
        "If the customer already provided an order ID, never ask them to repeat or confirm it. Sound human; "
        "never mention internal agents, tools, or system details."
    ),
    "model": "claude-sonnet-4-20250514",
    "tools": [],
    "max_tokens": 300,
}


async def _build_history(session, session_id: str):
    """Replay prior conversation turns for this session as memory.

    Builds an alternating Human/AI message list from persisted messages: each
    user message becomes a HumanMessage, and the last agent reply of each prior
    run (the customer-facing response) becomes an AIMessage. Intermediate
    tool/inter-agent events are intentionally skipped to keep context clean.
    The current user message (already persisted before this runs) ends the list.
    """
    rows = (
        await session.exec(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at)
        )
    ).all()

    history = []
    pending_ai = None
    for m in rows:
        if m.message_type == "human_input":
            if pending_ai:
                history.append(AIMessage(content=pending_ai))
                pending_ai = None
            history.append(HumanMessage(content=m.content))
        elif m.message_type == "agent_response":
            # Keep overwriting so we end up with the final agent's reply per run.
            pending_ai = m.content
    if pending_ai:
        history.append(AIMessage(content=pending_ai))

    if not history:
        history = [HumanMessage(content="")]
    return history[-MEMORY_MESSAGE_LIMIT:]


async def _load_dynamic(workflow_id: str, session):
    """Return (graph_json, agent_configs) if the workflow can run dynamically."""
    graph_json = {}
    agent_configs = {}
    workflow = await session.get(Workflow, workflow_id)
    if workflow and workflow.graph_json:
        graph_json = workflow.graph_json
        nodes = graph_json.get("nodes", [])
        agent_ids = {n.get("agent_id") for n in nodes if n.get("agent_id")}
        if agent_ids:
            fetched = await session.exec(select(Agent).where(Agent.id.in_(agent_ids)))
            agent_configs = {
                agent.id: {
                    "name": agent.name,
                    "role": agent.role,
                    "system_prompt": agent.system_prompt,
                    "model": agent.model,
                    "tools": agent.tools,
                    "max_tokens": agent.max_tokens,
                }
                for agent in fetched.all()
            }
    return graph_json, agent_configs


async def _run_entry_agent_handoff(
    *,
    workflow_id: str,
    session,
    session_id: str,
    input_message: str,
    target_workflow_name: str,
) -> tuple[str, int, float]:
    """Run only the first agent in a workflow to produce a customer-facing handoff line."""
    from .nodes import run_agent_node

    graph_json, agent_configs = await _load_dynamic(workflow_id, session)
    nodes = graph_json.get("nodes", [])
    if not nodes:
        return (
            f"I'll connect you with our {target_workflow_name} team now.",
            0,
            0.0,
        )

    entry = nodes[0]
    agent_config = agent_configs.get(entry.get("agent_id"))
    if not agent_config:
        return (
            f"I'll connect you with our {target_workflow_name} team now.",
            0,
            0.0,
        )

    handoff_config = {
        **agent_config,
        "system_prompt": (
            f"{agent_config['system_prompt']}\n\n"
            f"IMPORTANT: The customer's question belongs on '{target_workflow_name}', not your line. "
            "Write exactly ONE warm, professional customer-facing sentence saying you are not the "
            "right team for this, and that you are transferring them now. Do not ask them to email "
            "or contact another team manually."
        ),
    }

    history = await _build_history(session, session_id)
    state = {
        "messages": history,
        "session_id": session_id,
        "workflow_id": workflow_id,
        "last_agent": "",
        "last_response": "",
        "total_tokens": 0,
        "total_cost": 0.0,
        "input": input_message,
        "final_response": "",
    }
    result = await run_agent_node(state, handoff_config, session)
    return (
        result.get("last_response") or f"Connecting you with {target_workflow_name}…",
        result.get("total_tokens", 0),
        result.get("total_cost", 0.0),
    )


async def _emit_handoff(session, session_id: str, workflow_id: str, from_agent: str, to_workflow: str, message: str):
    from .nodes import emit_log

    await emit_log({
        "type": "handoff",
        "agent": from_agent,
        "target_workflow": to_workflow,
        "content": message,
        "timestamp": datetime.utcnow().isoformat(),
        "session_id": session_id,
    })
    session.add(
        Message(
            session_id=session_id,
            workflow_id=workflow_id,
            from_agent=from_agent,
            content=f"[Handoff → {to_workflow}] {message}",
            message_type="inter_agent",
        )
    )
    await session.commit()


async def _run_workflow_graph(
    *,
    workflow_id: str,
    session,
    session_id: str,
    input_message: str,
) -> dict:
    """Execute a workflow graph and return the raw result state."""
    graph_json, agent_configs = await _load_dynamic(workflow_id, session)
    use_dynamic = bool(
        graph_json.get("nodes")
        and agent_configs
        and len(agent_configs) == len({n.get("agent_id") for n in graph_json.get("nodes", [])})
    )

    if use_dynamic:
        graph = build_dynamic_workflow(graph_json, agent_configs, session)
    else:
        graph = build_payment_workflow(
            _ORCHESTRATOR_CONFIG, _ANALYST_CONFIG, _RESPONDER_CONFIG, session
        )

    history = await _build_history(session, session_id)
    initial_state = {
        "messages": history,
        "session_id": session_id,
        "workflow_id": workflow_id,
        "last_agent": "",
        "last_response": "",
        "total_tokens": 0,
        "total_cost": 0.0,
        "input": input_message,
        "final_response": "",
    }
    return await graph.ainvoke(initial_state)


async def execute_workflow(
    *,
    workflow_id: str,
    input_message: str,
    session,
    session_id: str | None = None,
    from_agent: str = "human",
    allow_handoff: bool = True,
    persist_input: bool = True,
    staged_handoff: bool = False,
) -> dict:
    """Run a workflow end to end. Persists the human input, a WorkflowRun record,
    and (via the agent nodes) every agent/tool message. Returns a result dict.

    Builds the graph dynamically from the saved definition; falls back to the
    hardcoded payment flow when the workflow has no usable graph.

    When allow_handoff is True and the message clearly belongs on another workflow,
    the entry agent redirects and the target workflow runs automatically.
    """
    session_id = session_id or str(uuid.uuid4())

    if persist_input:
        session.add(
            Message(
                session_id=session_id,
                workflow_id=workflow_id,
                from_agent=from_agent,
                content=input_message,
                message_type="human_input",
            )
        )
        await session.commit()

    source_wf = await session.get(Workflow, workflow_id)

    if allow_handoff and source_wf:
        target_id = await resolve_handoff_target(session, workflow_id, input_message)
        if target_id and target_id != workflow_id:
            target_wf = await session.get(Workflow, target_id)
            if target_wf:
                source_run = WorkflowRun(
                    workflow_id=workflow_id,
                    session_id=session_id,
                    status="running",
                )
                session.add(source_run)
                await session.commit()

                graph_json, entry_agents = await _load_dynamic(workflow_id, session)
                nodes = graph_json.get("nodes", [])
                first_id = nodes[0]["agent_id"] if nodes else None
                first_name = entry_agents.get(first_id, {}).get("name", "Agent")

                handoff_msg, h_tokens, h_cost = await _run_entry_agent_handoff(
                    workflow_id=workflow_id,
                    session=session,
                    session_id=session_id,
                    input_message=input_message,
                    target_workflow_name=target_wf.name,
                )
                handoff_msg = polish_handoff_message(handoff_msg, source_wf.name, target_wf.name)
                last_reply = (
                    await session.exec(
                        select(Message)
                        .where(
                            Message.session_id == session_id,
                            Message.from_agent == first_name,
                            Message.message_type == "agent_response",
                        )
                        .order_by(Message.created_at.desc())
                    )
                ).first()
                if last_reply:
                    last_reply.content = handoff_msg
                    session.add(last_reply)
                    await session.commit()
                await _emit_handoff(
                    session,
                    session_id,
                    workflow_id,
                    first_name,
                    target_wf.name,
                    handoff_msg,
                )

                source_run.status = "completed"
                source_run.completed_at = datetime.utcnow()
                source_run.total_tokens = h_tokens
                source_run.total_cost_usd = h_cost
                session.add(source_run)
                await session.commit()

                if staged_handoff:
                    return {
                        "session_id": session_id,
                        "status": "handoff_pending",
                        "handoff_message": handoff_msg,
                        "final_response": handoff_msg,
                        "handoff_from": source_wf.name,
                        "handoff_to": target_wf.name,
                        "handoff_from_workflow_id": workflow_id,
                        "handoff_to_workflow_id": target_id,
                        "total_tokens": h_tokens,
                        "total_cost": h_cost,
                    }

                target_result = await execute_workflow(
                    workflow_id=target_id,
                    input_message=input_message,
                    session=session,
                    session_id=session_id,
                    from_agent=from_agent,
                    allow_handoff=False,
                    persist_input=False,
                )

                combined = f"{handoff_msg.strip()}\n\n{target_result['final_response'].strip()}"
                return {
                    **target_result,
                    "final_response": combined,
                    "handoff_from": source_wf.name,
                    "handoff_to": target_wf.name,
                    "handoff_from_workflow_id": workflow_id,
                    "handoff_to_workflow_id": target_id,
                    "total_tokens": h_tokens + target_result.get("total_tokens", 0),
                    "total_cost": h_cost + target_result.get("total_cost", 0.0),
                }

    workflow_run = WorkflowRun(
        workflow_id=workflow_id,
        session_id=session_id,
        status="running",
    )
    session.add(workflow_run)
    await session.commit()

    try:
        result = await _run_workflow_graph(
            workflow_id=workflow_id,
            session=session,
            session_id=session_id,
            input_message=input_message,
        )

        workflow_run.status = "completed"
        workflow_run.completed_at = datetime.utcnow()
        workflow_run.total_tokens = result.get("total_tokens", 0)
        workflow_run.total_cost_usd = result.get("total_cost", 0.0)
        session.add(workflow_run)
        await session.commit()

        return {
            "session_id": session_id,
            "final_response": result.get("final_response") or result.get("last_response", ""),
            "total_tokens": result.get("total_tokens", 0),
            "total_cost": result.get("total_cost", 0.0),
            "status": "completed",
        }

    except Exception:
        workflow_run.status = "failed"
        session.add(workflow_run)
        await session.commit()
        raise
