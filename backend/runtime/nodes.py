from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from .tools import AVAILABLE_TOOLS
from ..db.models import Message
import asyncio
import os
import re
from datetime import datetime


def _safe_name(name: str) -> str:
    """OpenAI requires message `name` to match ^[a-zA-Z0-9_-]+$ (no spaces)."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name or "agent")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Global event queue for streaming logs to WebSocket clients
log_queue: asyncio.Queue = asyncio.Queue()


async def emit_log(event: dict):
    await log_queue.put(event)


def _resolve_provider() -> str:
    """Pick the LLM provider. Explicit LLM_PROVIDER wins; otherwise default to
    whichever API key is available (OpenAI preferred when both are set)."""
    explicit = os.getenv("LLM_PROVIDER")
    if explicit:
        return explicit.lower()
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return "anthropic"


def get_llm(agent_config: dict):
    provider = _resolve_provider()
    max_tokens = agent_config.get("max_tokens", 1000)
    model = agent_config.get("model")

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        # Agent configs may carry a Claude model name; fall back to an OpenAI
        # model when the configured model isn't an OpenAI one.
        if not model or not str(model).startswith("gpt"):
            model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        return ChatOpenAI(
            model=model,
            max_tokens=max_tokens,
            api_key=os.getenv("OPENAI_API_KEY"),
        )

    from langchain_anthropic import ChatAnthropic

    if not model or not str(model).startswith("claude"):
        model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    return ChatAnthropic(
        model=model,
        max_tokens=max_tokens,
        api_key=os.getenv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
    )


# Matches our order ids (ORD-1234) or a phrase like "order 1234".
_ORDER_ID_RE = re.compile(r"(ord[-\s]?\d+)|((?:order|payment|txn|transaction)\D{0,15}\d{3,})", re.I)


def _latest_user_text(messages) -> str:
    """Return the most recent human message in the conversation."""
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return str(m.content or "")
    return ""


def _latest_message_has_order(messages) -> bool:
    """True only when the *current* user turn mentions an order — not older turns."""
    return bool(_ORDER_ID_RE.search(_latest_user_text(messages)))


def _is_greeting_only(text: str) -> bool:
    return bool(
        re.match(r"^\s*(hi|hello|hey|thanks|thank you|ok|okay)\s*[!.?]*\s*$", text or "", re.I)
    )


def _should_use_payment_tools(messages) -> bool:
    """Decide if the analyst should call lookup tools on this turn.

    Tools run when the latest message includes an order reference (fresh lookup).
    Follow-ups like "how do I fix it?" or "can you update it?" reuse conversation
    memory and must not re-hit the database every turn.
    """
    latest = _latest_user_text(messages).strip()
    if not latest or _is_greeting_only(latest):
        return False
    return _latest_message_has_order(messages)


def _should_use_agent_tools(tool_names: list, messages) -> bool:
    """Payment tools need an order ID; general support tools skip pure greetings."""
    if not tool_names:
        return False
    latest = _latest_user_text(messages).strip()
    if not latest or _is_greeting_only(latest):
        return False
    if "lookup_payment" in tool_names:
        return _should_use_payment_tools(messages)
    return True


async def run_agent_node(state: dict, agent_config: dict, session) -> dict:
    """Generic agent node — runs an agent, logs all events, returns updated state."""
    agent_name = agent_config["name"]
    tool_names = [t for t in agent_config.get("tools", []) if t in AVAILABLE_TOOLS]
    tools = [AVAILABLE_TOOLS[t] for t in tool_names]

    llm = get_llm(agent_config)

    convo = state.get("messages", [])
    messages = [SystemMessage(content=agent_config["system_prompt"])] + convo

    await emit_log({
        "type": "agent_start",
        "agent": agent_name,
        "timestamp": datetime.utcnow().isoformat(),
        "session_id": state.get("session_id"),
    })

    # Tool guard: only bind/call payment tools when the *latest* user message
    # references an order ID. Follow-ups reuse prior findings from memory.
    use_tools = _should_use_agent_tools(tool_names, convo)
    force_lookup = use_tools and "lookup_payment" in tool_names and _latest_message_has_order(convo)

    if use_tools and force_lookup:
        first_llm = llm.bind_tools(
            tools, tool_choice={"type": "function", "function": {"name": "lookup_payment"}}
        )
    elif use_tools:
        first_llm = llm.bind_tools(tools)
    else:
        first_llm = llm

    auto_llm = llm.bind_tools(tools) if use_tools else llm

    response = await first_llm.ainvoke(messages)

    # Resolve tool calls across multiple rounds (e.g. lookup then recommendation),
    # always finishing with a natural-language response.
    rounds = 0
    while getattr(response, "tool_calls", None) and rounds < 4:
        rounds += 1
        messages.append(response)
        for tc in response.tool_calls:
            tool_fn = AVAILABLE_TOOLS.get(tc["name"])
            if not tool_fn:
                continue
            await emit_log({
                "type": "tool_call",
                "agent": agent_name,
                "tool": tc["name"],
                "args": tc["args"],
                "timestamp": datetime.utcnow().isoformat(),
                "session_id": state.get("session_id"),
            })
            result = tool_fn.invoke(tc["args"])
            messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))

            await emit_log({
                "type": "tool_result",
                "agent": agent_name,
                "tool": tc["name"],
                "result": str(result),
                "timestamp": datetime.utcnow().isoformat(),
                "session_id": state.get("session_id"),
            })

            if session:
                tool_msg = Message(
                    session_id=state.get("session_id", "unknown"),
                    workflow_id=state.get("workflow_id"),
                    from_agent=agent_name,
                    content=f"{tc['name']}({tc['args']}) -> {result}",
                    message_type="tool_result",
                )
                session.add(tool_msg)
                await session.commit()

        response = await auto_llm.ainvoke(messages)

    # Estimate tokens and cost
    tokens = len(str(response.content)) // 4
    cost = tokens * 0.000003

    await emit_log({
        "type": "agent_response",
        "agent": agent_name,
        "content": response.content,
        "tokens": tokens,
        "cost": cost,
        "timestamp": datetime.utcnow().isoformat(),
        "session_id": state.get("session_id"),
    })

    # Persist message to DB
    if session:
        msg = Message(
            session_id=state.get("session_id", "unknown"),
            workflow_id=state.get("workflow_id"),
            from_agent=agent_name,
            content=str(response.content),
            message_type="agent_response",
            tokens_used=tokens,
            cost_usd=cost,
        )
        session.add(msg)
        await session.commit()

    return {
        **state,
        "messages": state.get("messages", []) + [AIMessage(content=str(response.content), name=_safe_name(agent_name))],
        "last_agent": agent_name,
        "last_response": str(response.content),
        "total_tokens": state.get("total_tokens", 0) + tokens,
        "total_cost": state.get("total_cost", 0.0) + cost,
    }
