from sqlmodel import SQLModel, Field, Column, JSON
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid


class Agent(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    role: str  # orchestrator | analyst | responder | custom
    system_prompt: str
    model: str = "claude-sonnet-4-20250514"
    tools: List[str] = Field(default=[], sa_column=Column(JSON))
    memory_enabled: bool = True
    max_tokens: int = 1000
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Workflow(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    description: str = ""
    graph_json: Dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    # graph_json stores: { nodes: [{id, agent_id, position}], edges: [{source, target, condition}] }
    is_active: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Message(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    workflow_id: Optional[str] = None
    session_id: str  # groups messages from one conversation
    from_agent: str  # agent name or "human" or "telegram"
    to_agent: Optional[str] = None
    content: str
    message_type: str  # "human_input" | "agent_response" | "tool_call" | "tool_result" | "inter_agent"
    tokens_used: int = 0
    cost_usd: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WorkflowRun(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    workflow_id: str
    session_id: str
    status: str = "running"  # running | completed | failed
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    total_tokens: int = 0
    total_cost_usd: float = 0.0


class ChannelConfig(SQLModel, table=True):
    """Maps an external messaging channel (e.g. Telegram) to the workflow that
    should handle its incoming messages."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    channel: str = Field(index=True)  # "telegram" | future channels
    workflow_id: Optional[str] = None
    enabled: bool = True
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Payment(SQLModel, table=True):
    """A mock payments table the lookup_payment tool actually queries. Seeded with
    sample orders so testers have real order IDs to ask about."""
    order_id: str = Field(primary_key=True)
    status: str  # failed | success
    reason: Optional[str] = None  # failure reason when status == failed
    amount: float = 0.0
    currency: str = "USD"
    gateway: str = "Yuno"
    customer: Optional[str] = None


class PlaybookEntry(SQLModel, table=True):
    """Maps a payment failure reason to customer-facing retry guidance.

    Seeded with built-in defaults; users can add or override entries when creating
    custom payment records in the Knowledge base UI."""
    reason: str = Field(primary_key=True)
    recommendation: str
    is_builtin: bool = False
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TelegramBot(SQLModel, table=True):
    """A user-connected Telegram bot. Each row is an independent bot (its own
    BotFather token) that runs concurrently and routes messages to a workflow."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    bot_username: Optional[str] = None
    label: Optional[str] = None
    token: str
    workflow_id: Optional[str] = None
    source: str = "user"  # "user" | "env"
    created_at: datetime = Field(default_factory=datetime.utcnow)
