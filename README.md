# Yuno AgentForge

**AI Agent Orchestration Platform** — build, connect, run, and monitor teams of AI agents, with live Telegram integration and a visual workflow builder.

Built as part of the Yuno AI Engineer hiring challenge.

🔗 **Live demo**: [https://yuno-agentforge-frontend.onrender.com](https://yuno-agentforge-frontend.onrender.com)
🤖 **Telegram bot**: [@yuno_agentforge_user_bot](https://t.me/yuno_agentforge_user_bot)

---

## What it does

A user messages the Telegram bot: *"Why did my payment fail for order ORD-10234?"*

1. **Orchestrator Agent** receives the message, classifies intent, routes to analyst
2. **Payment Analyst Agent** calls `lookup_payment` tool → finds failure reason → calls `get_retry_recommendation`
3. **Response Writer Agent** drafts an empathetic reply → sends back via Telegram

Every step — agent starts, tool calls, tool results, responses, token counts — streams live to the web monitoring panel in real time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Studio (React)                     │
│  Dashboard · Agents CRUD · Workflow Builder · Monitor        │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                   FastAPI Backend                            │
│  /api/agents  /api/workflows  /api/stats  /ws/logs           │
│  /telegram/webhook                                           │
└──────────┬───────────────────────────┬──────────────────────┘
           │ LangGraph                 │ SQLite (SQLModel)
┌──────────▼──────────┐   ┌───────────▼──────────────────────┐
│   Agent Runtime      │   │         Persistence               │
│  Orchestrator node   │   │  agents · workflows · messages   │
│  Analyst node        │   │  workflow_runs                   │
│  Responder node      │   └──────────────────────────────────┘
│  Tool dispatcher     │
└──────────┬──────────┘
           │ LLM API (OpenAI or Anthropic)
┌──────────▼──────────┐   ┌──────────────────────────────────┐
│  OpenAI gpt-4o-mini │   │  Telegram Bot                    │
│  or Claude Sonnet 4 │   │  python-telegram-bot v21         │
│  (auto-detected)    │   │  Webhook (prod) / polling (local)│
└─────────────────────┘   └──────────────────────────────────┘
```

---

## Tech stack & decisions

| Layer | Technology | Why |
|---|---|---|
| Agent runtime | **LangGraph** | Explicit state machine graphs. Each agent is a node, edges define handoffs. Graphs serialize to JSON — maps 1:1 to the visual workflow builder. Async-native, inspectable, and deterministic compared to CrewAI/AutoGen. |
| Backend | **FastAPI** | Async-first, built-in WebSocket support, LangGraph integrates naturally. Auto-generates OpenAPI docs. Much faster than Flask/Django for concurrent agent runs. |
| Database | **SQLite + SQLModel** | Zero setup, single file, perfect for "single command" local run. SQLModel gives type-safe queries. Swappable to PostgreSQL by changing one env var. |
| LLM | **OpenAI or Anthropic** | Provider is auto-detected from whichever key is set (`LLM_PROVIDER` to force one). Model is config-driven per agent. |
| Frontend | **React + Vite** | Fast HMR during development, optimized production builds. |
| Workflow UI | **ReactFlow** | Purpose-built for node/edge UIs. The visual workflow builder requirement is ReactFlow's core feature — using anything else would mean re-implementing it from scratch. |
| Styling | **TailwindCSS** | Utility-first, consistent dark theme, no CSS file bloat. |
| Telegram | **python-telegram-bot v21** | Async, clean webhook API, well-maintained. |
| Deployment | **Render** | Free tier HTTPS (Telegram webhooks require HTTPS), auto-deploy from GitHub, zero DevOps. |

---

## Quick start (local)

### Prerequisites
- Docker + Docker Compose (or Python 3.11 + Node 20 for manual run)
- An **OpenAI** API key *or* an **Anthropic** API key
- Telegram bot token (message [@BotFather](https://t.me/botfather), send `/newbot`)

### 1. Clone and configure
```bash
git clone https://github.com/zaheerbrakchan/yuno-agentforge.git
cd yuno-agentforge
cp backend/.env.example .env
```

Edit `.env` (root). Set ONE provider:
```
# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# …or Anthropic
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...

TELEGRAM_BOT_TOKEN=...
ENVIRONMENT=development
```

### 2a. Run with Docker
```bash
docker compose up --build
```
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

### 2b. Run manually
```bash
# backend (from repo root)
cd backend && pip install -r requirements.txt && cd ..
python -m uvicorn backend.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

> The backend runs as the `backend` package (`backend.main:app`) from the repo root. This is intentional: it prevents the `backend/telegram/` module from shadowing the `python-telegram-bot` library. Locally the Telegram bot runs in **polling** mode (no public URL needed); in production it uses a **webhook**.

### 3. Run the demo
1. Open the Monitor page (`/monitor`)
2. Type: `Why did my payment fail for order ORD-10234?`
3. Click Send — watch 3 agents collaborate live with real tool calls

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One provider required | OpenAI key (used when `LLM_PROVIDER=openai` or no Anthropic key set) |
| `ANTHROPIC_API_KEY` | One provider required | Anthropic key for Claude |
| `LLM_PROVIDER` | No | `openai` or `anthropic`. Auto-detected from the available key if unset. |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | No | Default model per provider |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Token from @BotFather |
| `TELEGRAM_WEBHOOK_URL` | Production only | Public HTTPS URL of your backend |
| `ENVIRONMENT` | No | `development` (polling) or `production` (webhook) |
| `DATABASE_URL` | No | Defaults to `sqlite+aiosqlite:///./agentforge.db` |

---

## Demo walkthrough

### Web UI
1. **Dashboard** — see platform stats, click "Run demo workflow" for an instant demo
2. **Agents** — 3 agents are pre-seeded on first startup (Orchestrator, Payment Analyst, Response Writer). Create custom agents with any role, tools, and system prompt.
3. **Workflow Builder** — drag agents onto the canvas, connect them with edges, save as a named workflow. Saved workflows with valid agents run dynamically; otherwise the demo falls back to the built-in payment flow.
4. **Monitor** — type any payment query, watch the agents work in real time. Token and cost tracking updates live, and the final response is highlighted.

### Telegram
Message [@yuno_agentforge_user_bot](https://t.me/yuno_agentforge_user_bot):
- `Why did my payment fail?`
- `What payment methods do you support?`
- `My order ORD-5678 was declined, what should I do?`

---

## How to add a new workflow template

1. Open `backend/api/workflows.py`
2. Find the `get_templates()` endpoint
3. Add a new dict to the returned list:
```python
{
    "id": "your-template-id",
    "name": "Your Template Name",
    "description": "What this workflow does",
    "graph_json": {
        "nodes": [
            {"id": "node1", "agent_id": "agent1", "position": {"x": 100, "y": 200}},
            {"id": "node2", "agent_id": "agent2", "position": {"x": 400, "y": 200}},
        ],
        "edges": [
            {"source": "node1", "target": "node2"},
        ]
    }
}
```
4. The template appears in the "Load template" dropdown in Workflow Builder automatically.

---

## How to add a new messaging channel (e.g. Slack)

1. Create `backend/slack/bot.py` following the same pattern as `backend/telegram/bot.py`
2. Handle incoming messages by calling `build_dynamic_workflow()` or `build_payment_workflow()`
3. Register a webhook endpoint in `backend/main.py`: `@app.post("/slack/webhook")`
4. Add the Slack SDK to `requirements.txt`: `slack-bolt`
5. Add env vars: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

The agent runtime is channel-agnostic — only the input/output layer changes per channel. Because every node emits to the shared log queue, new channels stream to the Monitor panel automatically.

---

## Running tests

From the repo root:
```bash
pip install -r backend/requirements.txt
python -m pytest backend/tests -v
```
All 6 critical-path tests should pass (health, agent create/list, workflow create, templates, tools).

---

## Project structure

```
yuno-agentforge/
├── backend/
│   ├── main.py                  # FastAPI app, lifespan, agent seeding, Telegram
│   ├── api/
│   │   ├── agents.py            # Agent CRUD + /api/stats endpoint
│   │   ├── workflows.py         # Workflow CRUD + dynamic run + templates
│   │   └── ws.py                # WebSocket log stream
│   ├── runtime/
│   │   ├── graph.py             # LangGraph workflow builders
│   │   ├── nodes.py             # Agent node functions + log emitter
│   │   └── tools.py             # Payment tool definitions
│   ├── telegram/
│   │   └── bot.py               # Telegram bot (polling/webhook)
│   ├── db/
│   │   ├── models.py            # SQLModel tables
│   │   └── database.py          # Async engine + session
│   └── tests/
│       └── test_critical_paths.py
├── frontend/
│   └── src/
│       ├── pages/               # Dashboard, Agents, WorkflowBuilder, Monitor
│       └── components/          # AgentCard, AgentForm, LogStream, MessageHistory, Navbar
├── docker-compose.yml
├── render.yaml
└── README.md
```

---

## Evaluation criteria mapping

| Criterion | Weight | Implementation |
|---|---|---|
| Working end-to-end demo | 40% | 3-agent payment workflow via Telegram + web UI with live streaming |
| Architecture & code quality | 30% | LangGraph state machine, clean layer separation, async throughout, tests |
| UI/UX & configurability | 20% | ReactFlow builder, agent CRUD, live monitoring, pre-built templates |
| Documentation | 10% | This README — architecture diagram, setup, design decisions |
