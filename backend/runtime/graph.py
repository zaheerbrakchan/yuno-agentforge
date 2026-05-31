from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Annotated
from langchain_core.messages import BaseMessage
import operator


class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    session_id: str
    workflow_id: str
    last_agent: str
    last_response: str
    total_tokens: int
    total_cost: float
    input: str
    final_response: str


def build_payment_workflow(orchestrator_config, analyst_config, responder_config, session):
    """Build the payment failure investigation workflow graph."""
    from .nodes import run_agent_node

    graph = StateGraph(AgentState)

    async def orchestrator_node(state):
        return await run_agent_node(state, orchestrator_config, session)

    async def analyst_node(state):
        return await run_agent_node(state, analyst_config, session)

    async def responder_node(state):
        result = await run_agent_node(state, responder_config, session)
        return {**result, "final_response": result["last_response"]}

    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("analyst", analyst_node)
    graph.add_node("responder", responder_node)

    graph.set_entry_point("orchestrator")
    graph.add_edge("orchestrator", "analyst")
    graph.add_edge("analyst", "responder")
    graph.add_edge("responder", END)

    return graph.compile()


def build_dynamic_workflow(workflow_json: dict, agent_configs: dict, session):
    """Build any workflow from a JSON graph definition (from the visual builder)."""
    from .nodes import run_agent_node

    graph = StateGraph(AgentState)

    nodes = workflow_json.get("nodes", [])
    edges = workflow_json.get("edges", [])

    for node in nodes:
        agent_id = node["agent_id"]
        agent_config = agent_configs.get(agent_id)
        if not agent_config:
            continue

        node_id = node["id"]

        def make_node_fn(cfg):
            async def node_fn(state):
                return await run_agent_node(state, cfg, session)
            return node_fn

        graph.add_node(node_id, make_node_fn(agent_config))

    valid_ids = {n["id"] for n in nodes}

    if nodes:
        graph.set_entry_point(nodes[0]["id"])

    sources_with_edges = set()
    for edge in edges:
        src = edge["source"]
        tgt = edge["target"] if edge["target"] != "END" else END
        if src in valid_ids and (tgt == END or tgt in valid_ids):
            graph.add_edge(src, tgt)
            sources_with_edges.add(src)

    # Any node that has no outgoing edge is a terminal node -> END.
    for n in nodes:
        if n["id"] not in sources_with_edges:
            graph.add_edge(n["id"], END)

    return graph.compile()
