from dotenv import load_dotenv

# Load environment variables from a local .env file (repo root or backend/)
# before any module reads them. In Docker/Render the env is injected directly,
# and load_dotenv simply no-ops when no file is present.
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .db.database import init_db, AsyncSessionLocal
from .api.agents import router as agents_router, stats_router
from .api.workflows import router as workflows_router
from .api.channels import router as channels_router
from .api.payments import router as payments_router
from .api.ws import router as ws_router
from .telegram import bot as tg
import os


DEFAULT_AGENTS = [
    {
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
        "memory_enabled": True,
        "max_tokens": 400,
    },
    {
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
        "memory_enabled": True,
        "max_tokens": 1000,
    },
    {
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
        "memory_enabled": True,
        "max_tokens": 300,
    },
]


DEFAULT_WORKFLOW_NAME = "Payment failure investigator"


# Sample orders seeded into the payments table so testers have real order IDs to
# ask about. The lookup_payment tool queries this data directly.
DEFAULT_PAYMENTS = [
    {"order_id": "ORD-1001", "status": "failed", "reason": "insufficient_funds", "amount": 1250.00, "currency": "USD", "gateway": "Stripe", "customer": "Alex Morgan"},
    {"order_id": "ORD-1002", "status": "failed", "reason": "card_expired", "amount": 89.99, "currency": "USD", "gateway": "PayPal", "customer": "Brianna Lee"},
    {"order_id": "ORD-1003", "status": "failed", "reason": "gateway_timeout", "amount": 340.50, "currency": "BRL", "gateway": "Yuno", "customer": "Carlos Diaz"},
    {"order_id": "ORD-1004", "status": "failed", "reason": "fraud_detected", "amount": 5000.00, "currency": "USD", "gateway": "Stripe", "customer": "Dana White"},
    {"order_id": "ORD-1005", "status": "success", "reason": None, "amount": 42.00, "currency": "USD", "gateway": "Yuno", "customer": "Esha Patel"},
]


async def seed_payments():
    """Insert sample orders if the payments table is empty."""
    from sqlmodel import select
    from .db.models import Payment

    async with AsyncSessionLocal() as session:
        existing = await session.exec(select(Payment))
        if existing.first() is not None:
            return
        for p in DEFAULT_PAYMENTS:
            session.add(Payment(**p))
        await session.commit()


async def seed_playbook():
    """Insert default retry recommendations if the playbook table is empty."""
    from sqlmodel import select
    from .db.models import PlaybookEntry
    from .runtime.playbook import DEFAULT_RETRY_RECOMMENDATIONS

    async with AsyncSessionLocal() as session:
        existing = await session.exec(select(PlaybookEntry))
        if existing.first() is not None:
            return
        for reason, recommendation in DEFAULT_RETRY_RECOMMENDATIONS.items():
            session.add(PlaybookEntry(
                reason=reason,
                recommendation=recommendation,
                is_builtin=True,
            ))
        await session.commit()


async def seed_default_agents():
    """Insert the 3 demo agents if the agents table is empty."""
    from sqlmodel import select
    from .db.models import Agent

    async with AsyncSessionLocal() as session:
        existing = await session.exec(select(Agent))
        if existing.first() is not None:
            return
        for cfg in DEFAULT_AGENTS:
            session.add(Agent(**cfg))
        await session.commit()


# Every prompt we have ever shipped for the three default agents. Used to safely
# upgrade existing demo agents to the latest prompts, while preserving any prompt
# a user has customised themselves (which won't be in this managed set).
_MANAGED_DEFAULT_PROMPTS = {
    "Orchestrator": [
        "You are an orchestrator agent for a payments platform. You receive user queries, analyze intent, and pass structured context to the analyst. Be concise and structured in your handoff. Always acknowledge the user's query briefly.",
        "You are the orchestrator for a payments support assistant. Read the conversation so far and the user's latest message, then classify intent and write a brief internal handoff for the analyst.\n- Greeting/small talk: say no payment lookup is needed; the assistant should greet and offer help.\n- Payment or order problem: extract the order ID if present. If present, tell the analyst to investigate it. If missing, note that we must politely ask the user for their order ID first.\n- Anything else: briefly summarize what the user wants.\nBe concise. Do not address the customer directly — you are coordinating internally.",
    ],
    "Payment Analyst": [
        "You are a payment analyst agent with access to payment lookup tools. Given a user query about payment failures, use your tools to: 1) Look up the payment record using lookup_payment, 2) Get a retry recommendation using get_retry_recommendation. Provide a structured analysis including the failure reason and recommendation.",
        "You are a payment analyst with tools: lookup_payment and get_retry_recommendation.\nOnly use the tools when the user is reporting a payment/order issue AND an order ID is available in the conversation. In that case, look up the payment, identify the failure reason, get a retry recommendation, and summarize the findings.\nIf there is no order ID, or the message is a greeting or unrelated, do NOT call any tools. Instead state briefly what is needed (e.g., the order ID) or that no investigation is required. Keep it short and internal.",
        "You are a payment analyst with tools: lookup_payment and get_retry_recommendation.\nIf the conversation contains an order ID (e.g. ORD-1234, or a number the user refers to as an order), immediately call lookup_payment with it — do NOT ask the user to confirm it. If the payment failed, also call get_retry_recommendation, then summarize the status, reason, and recommendation. If lookup_payment returns not_found, say the order wasn't found.\nOnly skip the tools when there is genuinely no order ID and the user is greeting or asking something unrelated; then briefly note what's needed. Keep it short and internal.",
    ],
    "Response Writer": [
        "You are a customer-facing response writer for a payments platform. Given the analyst findings passed to you in the conversation, write a clear, empathetic, and helpful response to the customer. Keep it to 2-3 sentences. Be human and actionable. Never mention agent names or internal system details.",
        "You are the friendly customer-facing voice of a payments support assistant. Using the conversation and the analyst's notes, write a natural reply to the customer (1-3 sentences).\n- Greeting/small talk: greet warmly and let them know you can help with payment or order issues; invite them to share their order ID.\n- Order ID needed but missing: politely ask for it.\n- Analyst found a result: explain the failure reason in plain language and give the recommended next step.\nSound human and helpful. Never mention internal agents, tools, or system details.",
    ],
}


async def upgrade_default_agent_prompts():
    """Refresh the seeded demo agents to the latest prompts when their stored prompt
    is one we previously shipped (so a user's own custom prompt is never overwritten)."""
    from sqlmodel import select
    from .db.models import Agent

    new_by_name = {a["name"]: a for a in DEFAULT_AGENTS}
    async with AsyncSessionLocal() as session:
        agents = (await session.exec(select(Agent))).all()
        changed = False
        for agent in agents:
            managed = _MANAGED_DEFAULT_PROMPTS.get(agent.name)
            new = new_by_name.get(agent.name)
            if not (managed and new):
                continue
            current = agent.system_prompt.strip()
            if current == new["system_prompt"].strip():
                continue  # already latest
            if any(current == m.strip() for m in managed):
                agent.system_prompt = new["system_prompt"]
                agent.max_tokens = new["max_tokens"]
                session.add(agent)
                changed = True
        if changed:
            await session.commit()


async def seed_default_workflow():
    """Ensure a proper (non-empty) default payment workflow exists, wired to the
    3 seeded agents so it shows 3 agents and runs dynamically — no hardcoding."""
    from sqlmodel import select
    from .db.models import Agent, Workflow

    async with AsyncSessionLocal() as session:
        workflows = (await session.exec(select(Workflow))).all()
        for wf in workflows:
            if wf.name == DEFAULT_WORKFLOW_NAME and (wf.graph_json or {}).get("nodes"):
                return  # A real default already exists.

        agents = (await session.exec(select(Agent))).all()

        def find(name, role):
            for a in agents:
                if a.name == name:
                    return a
            for a in agents:
                if a.role == role:
                    return a
            return None

        orch = find("Orchestrator", "orchestrator")
        analyst = find("Payment Analyst", "analyst")
        responder = find("Response Writer", "responder")
        if not (orch and analyst and responder):
            return

        graph_json = {
            "nodes": [
                {"id": "n_orchestrator", "agent_id": orch.id, "role": "orchestrator", "position": {"x": 80, "y": 160}},
                {"id": "n_analyst", "agent_id": analyst.id, "role": "analyst", "position": {"x": 360, "y": 160}},
                {"id": "n_responder", "agent_id": responder.id, "role": "responder", "position": {"x": 640, "y": 160}},
            ],
            "edges": [
                {"source": "n_orchestrator", "target": "n_analyst"},
                {"source": "n_analyst", "target": "n_responder"},
            ],
        }
        session.add(Workflow(
            name=DEFAULT_WORKFLOW_NAME,
            description="Default 3-agent payment failure investigation flow.",
            graph_json=graph_json,
        ))
        await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_default_agents()
    await upgrade_default_agent_prompts()
    await seed_default_workflow()
    await seed_playbook()
    await seed_payments()

    # Register the maintainer's env bot (if any) and (re)start every connected
    # bot. Additional bots can be connected at runtime via the Channels page.
    await tg.seed_env_bot()
    await tg.start_all_from_db()

    yield

    await tg.stop_all()


app = FastAPI(title="Yuno AgentForge", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents_router)
app.include_router(stats_router)
app.include_router(workflows_router)
app.include_router(channels_router)
app.include_router(payments_router)
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "yuno-agentforge"}


@app.post("/telegram/webhook/{bot_id}")
async def telegram_webhook(bot_id: str, request: dict):
    tg_app = tg.get_app(bot_id)
    if tg_app is not None:
        from telegram import Update
        update = Update.de_json(request, tg_app.bot)
        await tg_app.process_update(update)
    return {"ok": True}
