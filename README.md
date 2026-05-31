# Yuno AgentForge

**AI Agent Orchestration Platform** — build, connect, run, and monitor teams of AI agents, with live Telegram integration, a visual workflow builder, and smart cross-workflow routing.

Built as part of the Yuno AI Engineer hiring challenge.

🔗 **Live demo**: [https://yuno-agentforge-frontend.onrender.com](https://yuno-agentforge-frontend.onrender.com)  
🔗 **Backend API**: [https://yuno-agentforge-backend.onrender.com/docs](https://yuno-agentforge-backend.onrender.com/docs)  
🤖 **Telegram bot**: [@yuno_agentforge_user_bot](https://t.me/yuno_agentforge_user_bot)

📄 **Full project reference**: see [`PROJECT_DETAILS.txt`](PROJECT_DETAILS.txt) for complete documentation.

---

## What it does

A user asks: *"Why did my payment fail for order ORD-1002?"*

1. **Orchestrator** classifies intent and hands off internally to the analyst
2. **Payment Analyst** calls `lookup_payment` → finds `card_expired` → calls `get_retry_recommendation`
3. **Response Writer** drafts a friendly customer reply

Every step — agent starts, tool calls, tool results, responses, token counts — streams live to the Monitor panel via WebSocket.

If the user asks a **general support** question on the wrong workflow (e.g. *"What payment methods do you accept?"* while on the payment workflow), the platform **auto-transfers** them to the **Customer support router** workflow and continues the same conversation session.

---

## Two pre-built workflows

| Workflow | Agents | Tools | Purpose |
|---|---|---|---|
| **Payment failure investigator** | Orchestrator → Payment Analyst → Response Writer | `lookup_payment`, `get_retry_recommendation` | Investigate failed orders via SQLite knowledge base |
| **Customer support router** | Support Router → General Support Agent | `list_supported_payment_methods`, `get_support_info` | General FAQ — methods, hours, refunds, regions (no order lookup) |

Both workflows are seeded on first startup and available as templates in the Workflow Builder.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Agent Studio (React + Vite)                          │
│  Dashboard · Agents · Workflows · Builder · Monitor · Channels           │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────▼──────────────────────────────────────────┐
│                   FastAPI Backend (backend.main:app)                       │
│  /api/agents  /api/workflows  /api/stats  /api/payments  /api/channels  │
│  /ws/logs  /telegram/webhook/{bot_id}  /health                           │
└──────────┬───────────────────────────────┬──────────────────────────────┘
           │ LangGraph executor            │ SQLite (SQLModel)
┌──────────▼──────────┐         ┌──────────▼──────────────────────────────┐
│   Agent Runtime      │         │  agents · workflows · messages           │
│  graph.py            │         │  workflow_runs · payments · playbook     │
│  nodes.py            │         │  telegram_bots                           │
│  executor.py         │         └──────────────────────────────────────────┘
│  handoff.py          │
│  tools.py            │
└──────────┬──────────┘
           │ LLM API (OpenAI or Anthropic)
┌──────────▼──────────┐         ┌──────────────────────────────────────────┐
│  OpenAI / Anthropic  │         │  Telegram Bot(s) — polling (local) /     │
└─────────────────────┘         │  webhook (production)                    │
                                └──────────────────────────────────────────┘
```

---

## Tech stack & decisions

| Layer | Technology | Why |
|---|---|---|
| Agent runtime | **LangGraph** | Explicit state machine graphs. Each agent is a node, edges define handoffs. Graphs serialize to JSON — maps 1:1 to the visual workflow builder. |
| Backend | **FastAPI** | Async-first, built-in WebSocket support, LangGraph integrates naturally. Auto-generates OpenAPI docs. |
| Database | **SQLite + SQLModel** | Zero setup, single file. Swappable to PostgreSQL via `DATABASE_URL`. |
| LLM | **OpenAI or Anthropic** | Auto-detected from API keys. Set `LLM_PROVIDER` to force one. |
| Frontend | **React + Vite** | Fast HMR, optimized production builds. |
| Workflow UI | **ReactFlow** | Purpose-built for node/edge workflow builder. |
| Styling | **TailwindCSS** | Dark theme, utility-first. |
| Telegram | **python-telegram-bot v21** | Async, webhook in production, polling locally. |
| Deployment | **Render** | Free tier HTTPS, auto-deploy from GitHub via `render.yaml`. |

---

## Quick start (local)

### Prerequisites
- Python 3.11+ (3.12 recommended) and Node 20+
- An **OpenAI** API key *or* an **Anthropic** API key
- Optional: Telegram bot token from [@BotFather](https://t.me/botfather)

### 1. Clone and configure
```bash
git clone https://github.com/zaheerbrakchan/yuno-agentforge.git
cd yuno-agentforge
cp backend/.env.example .env
```

Edit `.env` (repo root). Set ONE provider:
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Optional
TELEGRAM_BOT_TOKEN=...
ENVIRONMENT=development
```

### 2a. Run with Docker
```bash
docker compose up --build
```
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

### 2b. Run manually
```bash
# backend (from repo root — important!)
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

> Run the backend as `backend.main:app` from the **repo root** so `backend/telegram/` does not shadow the `python-telegram-bot` library.

### 3. Run the demo
1. Open **Monitor** (`/monitor`)
2. Send: `Why did my payment fail for order ORD-1002?`
3. Watch 3 agents collaborate with live tool calls
4. Follow up: `What payment methods do you accept?` → smart handoff to support workflow

---

## Sample order IDs (knowledge base)

| Order ID | Status | Reason |
|---|---|---|
| ORD-1001 | failed | insufficient_funds |
| ORD-1002 | failed | card_expired ← **primary demo order** |
| ORD-1003 | failed | gateway_timeout |
| ORD-1004 | failed | fraud_detected |
| ORD-1005 | success | — |

Add custom orders via **Monitor → Knowledge base** or **Channels** page.

---

## Environment variables

### Backend (local `.env` or Render `yuno-agentforge-backend`)

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One provider | OpenAI key |
| `ANTHROPIC_API_KEY` | One provider | Anthropic key (optional if using OpenAI) |
| `LLM_PROVIDER` | No | `openai` or `anthropic` |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | No | Model override per provider |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Token from @BotFather |
| `TELEGRAM_WEBHOOK_URL` | Production | Backend URL only, e.g. `https://yuno-agentforge-backend.onrender.com` (no trailing slash) |
| `ENVIRONMENT` | No | `development` (polling) or `production` (webhook) |
| `DATABASE_URL` | No | Default: `sqlite+aiosqlite:///./agentforge.db` |
| `PYTHON_VERSION` | Render | `3.12.8` (set in `render.yaml`) |

### Frontend (Render `yuno-agentforge-frontend`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | **Yes on Render** | Backend URL, e.g. `https://yuno-agentforge-backend.onrender.com` — baked in at build time |

---

## Demo walkthrough

### Web UI
1. **Dashboard** — stats, one-click demo run, recent runs with channel (Monitor/Telegram)
2. **Agents** — 5 agents pre-seeded (3 payment + 2 support). Create/edit/delete custom agents.
3. **Workflows** — list saved workflows, open in Builder
4. **Workflow Builder** — ReactFlow canvas, load templates, connect agents, save
5. **Monitor** — chat with agents, session history, live log stream, knowledge base picker, staged handoff UX, focus monitor mode
6. **Channels** — connect Telegram bots, assign workflows, manage knowledge base

### Smart handoff
- Wrong workflow selected? The platform detects intent and transfers automatically.
- Monitor shows a redirect message first, then runs the target workflow (same session).
- Workflow dropdown updates to the active workflow after handoff.

### Telegram
Message [@yuno_agentforge_user_bot](https://t.me/yuno_agentforge_user_bot):
- `Hi` → greeting
- `Why did my payment fail for order ORD-1002?` → payment investigation
- `What payment methods do you support?` → general support (handoff if on payment workflow)

---

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET/POST /api/agents/` | Agent CRUD |
| `GET /api/stats` | Dashboard statistics |
| `GET/POST /api/workflows/` | Workflow CRUD |
| `GET /api/workflows/templates` | Pre-built templates (2) |
| `POST /api/workflows/{id}/run` | Run workflow |
| `GET /api/payments/` | Knowledge base records + playbook |
| `GET /api/channels/` | Telegram bots + channel status |
| `WS /ws/logs` | Live agent event stream |

Full endpoint list: [`PROJECT_DETAILS.txt`](PROJECT_DETAILS.txt) or `/docs` on the backend.

---

## How to add a new workflow template

1. Open `backend/api/workflows.py` → `get_templates()`
2. Add a new template dict with `id`, `name`, `description`, `graph_json`
3. It appears in Workflow Builder → **Load template** automatically

---

## How to add a new messaging channel (e.g. Slack)

1. Create `backend/slack/bot.py` following `backend/telegram/bot.py`
2. Route messages through `backend/runtime/executor.py` (channel-agnostic)
3. Register webhook in `backend/main.py`
4. Events stream to Monitor automatically via the shared log queue

---

## Running tests

From the repo root:
```bash
pip install -r backend/requirements.txt
python -m pytest backend/tests -v
```

7 tests cover health, agents, workflows, templates, tools, custom playbook, and handoff intent classification.

---

## Deploy on Render

The repo includes `render.yaml` (Blueprint):

- **yuno-agentforge-backend** — Python 3.12.8, free web service
- **yuno-agentforge-frontend** — static site; set `VITE_API_URL` to backend URL and redeploy after any change

See [`PROJECT_DETAILS.txt`](PROJECT_DETAILS.txt) §17 for full deployment checklist.

---

## Project structure

```
yuno-agentforge/
├── backend/
│   ├── main.py                  # FastAPI app, seeding, Telegram webhook
│   ├── api/
│   │   ├── agents.py            # Agent CRUD + /api/stats
│   │   ├── workflows.py         # Workflow CRUD, run, templates, sessions
│   │   ├── payments.py          # Knowledge base / payment records
│   │   ├── channels.py          # Telegram bot management
│   │   └── ws.py                # WebSocket log stream
│   ├── runtime/
│   │   ├── graph.py             # LangGraph builders
│   │   ├── nodes.py             # Agent nodes + log emitter
│   │   ├── executor.py          # Shared execution + handoff
│   │   ├── handoff.py           # Cross-workflow intent routing
│   │   ├── tools.py             # LangChain tools
│   │   └── playbook.py          # Retry recommendation defaults
│   ├── telegram/bot.py
│   ├── db/models.py, database.py
│   └── tests/test_critical_paths.py
├── frontend/src/
│   ├── pages/                   # Dashboard, Agents, Workflows, Builder, Monitor, Channels
│   ├── components/              # LogStream, MessageHistory, KnowledgeBase, …
│   └── api/client.js
├── render.yaml
├── docker-compose.yml
├── PROJECT_DETAILS.txt          # Complete reference document
└── README.md
```

---

## Evaluation criteria mapping

| Criterion | Weight | Implementation |
|---|---|---|
| Working end-to-end demo | 40% | Dual workflows, payment + support, Telegram + web, live streaming, smart handoff |
| Architecture & code quality | 30% | LangGraph, shared executor, async throughout, handoff module, tests |
| UI/UX & configurability | 20% | ReactFlow builder, agent CRUD, Monitor sessions/handoff/focus mode, knowledge base, Channels |
| Documentation | 10% | README + PROJECT_DETAILS.txt, architecture, setup, design decisions |
