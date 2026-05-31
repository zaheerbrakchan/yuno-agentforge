"""Multi-bot Telegram manager.

Each connected bot (its own BotFather token) runs as an independent
python-telegram-bot Application in the same event loop. Several people can
connect their own bots at the same time; every bot routes incoming messages to
whichever workflow it is configured for, and all activity streams to the shared
Monitor log queue via the common executor.
"""
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from sqlmodel import select
from ..db.database import AsyncSessionLocal
from ..db.models import TelegramBot, Workflow, Payment
from ..runtime.executor import execute_workflow
import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_WORKFLOW_NAME = "Payment failure investigator"
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
BACKEND_URL = os.getenv("TELEGRAM_WEBHOOK_URL", "http://localhost:8000")

# bot_id -> running Application
_apps: dict[str, Application] = {}


async def _resolve_workflow_id(bot_id: str, session) -> str:
    bot = await session.get(TelegramBot, bot_id)
    if bot and bot.workflow_id:
        wf = await session.get(Workflow, bot.workflow_id)
        if wf:
            return wf.id
    default_wf = (
        await session.exec(select(Workflow).where(Workflow.name == DEFAULT_WORKFLOW_NAME))
    ).first()
    return default_wf.id if default_wf else "telegram-default"


async def _handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    bot_id = context.application.bot_data.get("bot_id")
    user_message = update.message.text
    # Namespacing the session by bot keeps each connected bot's conversations
    # separate even if two bots share a chat id space.
    session_id = f"{bot_id}:{update.effective_chat.id}"

    await update.message.reply_text("Working on it… one moment.")
    try:
        async with AsyncSessionLocal() as session:
            workflow_id = await _resolve_workflow_id(bot_id, session)
            result = await execute_workflow(
                workflow_id=workflow_id,
                input_message=user_message,
                session=session,
                session_id=session_id,
                from_agent="telegram",
            )
        reply = result.get("final_response") or "I couldn't process your request."
        await update.message.reply_text(reply)
    except Exception:
        logger.exception("Telegram workflow run failed for bot %s", bot_id)
        await update.message.reply_text("Sorry, something went wrong. Please try again.")


async def _orders_text() -> str:
    """Build a human-readable knowledge base summary for testers."""
    async with AsyncSessionLocal() as session:
        payments = (await session.exec(select(Payment).order_by(Payment.order_id))).all()
    if not payments:
        return "No test records yet. Add some in the web UI under Channels → Knowledge base."
    lines = [
        "Knowledge base — payment records agents can look up:",
        "",
    ]
    for p in payments:
        if p.status == "success":
            state = f"✅ paid ({p.amount} {p.currency})"
        else:
            state = f"❌ {p.reason or 'failed'}"
        lines.append(f"• {p.order_id} — {state}")
    lines.extend([
        "",
        "Try: “Why did my payment fail for order ORD-1002?”",
        "Or say hi first, then share an order ID.",
        "Add your own records in the web UI (Channels → Knowledge base).",
    ])
    return "\n".join(lines)


async def _start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    orders = await _orders_text()
    await update.message.reply_text(
        "Hi! I'm an AgentForge support bot. Tell me about a payment or order issue and my "
        "agents will investigate.\n\n" + orders
    )


async def _orders_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(await _orders_text())


def _build_app(token: str, bot_id: str) -> Application:
    app = Application.builder().token(token).build()
    app.bot_data["bot_id"] = bot_id
    app.add_handler(CommandHandler("start", _start_command))
    app.add_handler(CommandHandler("orders", _orders_command))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_message))
    return app


async def start_bot(bot_id: str, token: str) -> str:
    """Initialize a bot and begin receiving updates (polling locally, webhook in
    production). Returns the bot's @username. Raises ValueError on a bad token."""
    if bot_id in _apps:
        try:
            return (await _apps[bot_id].bot.get_me()).username
        except Exception:
            return ""

    app = None
    try:
        app = _build_app(token, bot_id)
        await app.initialize()
        me = await app.bot.get_me()  # validates the token
    except Exception as e:
        if app is not None:
            try:
                await app.shutdown()
            except Exception:
                pass
        raise ValueError(str(e))

    try:
        if ENVIRONMENT == "production":
            await app.bot.set_webhook(
                f"{BACKEND_URL}/telegram/webhook/{bot_id}", drop_pending_updates=True
            )
            await app.start()
        else:
            await app.bot.delete_webhook(drop_pending_updates=True)
            await app.start()
            await app.updater.start_polling(drop_pending_updates=True)
    except Exception as e:
        try:
            await app.shutdown()
        except Exception:
            pass
        raise ValueError(str(e))

    _apps[bot_id] = app
    return me.username


async def stop_bot(bot_id: str):
    app = _apps.pop(bot_id, None)
    if app is None:
        return
    try:
        if app.updater and app.updater.running:
            await app.updater.stop()
        if app.running:
            await app.stop()
    finally:
        await app.shutdown()


def is_running(bot_id: str) -> bool:
    return bot_id in _apps


def get_app(bot_id: str):
    return _apps.get(bot_id)


async def start_all_from_db():
    """Restart every persisted bot on server startup."""
    async with AsyncSessionLocal() as session:
        bots = (await session.exec(select(TelegramBot))).all()
    for b in bots:
        try:
            username = await start_bot(b.id, b.token)
            if username and username != b.bot_username:
                async with AsyncSessionLocal() as session:
                    row = await session.get(TelegramBot, b.id)
                    if row:
                        row.bot_username = username
                        session.add(row)
                        await session.commit()
        except Exception:
            logger.exception("Failed to start Telegram bot %s", b.id)


async def stop_all():
    for bot_id in list(_apps.keys()):
        try:
            await stop_bot(bot_id)
        except Exception:
            logger.exception("Failed to stop Telegram bot %s", bot_id)


async def seed_env_bot():
    """If a TELEGRAM_BOT_TOKEN is present in the environment and not already
    stored, register it as a connection so the maintainer's demo bot works out
    of the box. Its token is masked in the API like any other."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        return
    async with AsyncSessionLocal() as session:
        existing = (
            await session.exec(select(TelegramBot).where(TelegramBot.token == token))
        ).first()
        if existing:
            return
        session.add(TelegramBot(token=token, source="env", label="Demo bot (env)"))
        await session.commit()
