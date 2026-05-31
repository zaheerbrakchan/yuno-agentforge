"""Cross-workflow routing — when the user picks the wrong workflow, hand off automatically."""

import re
from sqlmodel import select

PAYMENT_WORKFLOW_NAME = "Payment failure investigator"
SUPPORT_WORKFLOW_NAME = "Customer support router"

_ORDER_ID_RE = re.compile(
    r"(ord[-\s]?\d+)|((?:order|payment|txn|transaction)\D{0,15}\d{3,})",
    re.I,
)
_FAILURE_KW = re.compile(
    r"fail|declin|reject|denied|error|chargeback|fraud|unsuccessful|"
    r"didn't go through|did not go through|won't go through|not go through|was declined",
    re.I,
)
_SUPPORT_KW = re.compile(
    r"payment method|methods do you|what do you accept|what cards|accept visa|accept card|"
    r"paypal|pix|refund policy|support hour|business hour|how (?:do i|to) contact|"
    r"regions?|countries|wallet|oxxo|pse|nequi|mercado pago",
    re.I,
)
_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|good morning|good afternoon|thanks|thank you|ok|okay)\s*[!.?]*\s*$",
    re.I,
)


def classify_message_intent(message: str) -> str:
    """Classify user intent for cross-workflow routing."""
    text = (message or "").strip()
    if not text or _GREETING_RE.match(text):
        return "greeting"
    if (
        re.match(r"^\s*(hi|hello|hey|good morning|good afternoon)\b", text, re.I)
        and not _ORDER_ID_RE.search(text)
        and not _FAILURE_KW.search(text)
        and not _SUPPORT_KW.search(text)
        and len(text.split()) <= 6
    ):
        return "greeting"
    has_order = bool(_ORDER_ID_RE.search(text))
    if has_order:
        return "payment_investigation"
    if _SUPPORT_KW.search(text):
        return "general_support"
    if _FAILURE_KW.search(text):
        return "payment_investigation"
    return "ambiguous"


def workflow_kind(name: str) -> str | None:
    """Return 'payment', 'support', or None based on workflow name."""
    n = (name or "").lower()
    if "payment failure" in n or "payment investigator" in n or "fraud investigation" in n:
        return "payment"
    if "customer support" in n or "support router" in n:
        return "support"
    return None


async def find_workflow_by_name(session, name: str):
    from ..db.models import Workflow

    exact = (
        await session.exec(select(Workflow).where(Workflow.name == name))
    ).first()
    if exact:
        return exact
    kind = workflow_kind(name)
    workflows = (await session.exec(select(Workflow))).all()
    for wf in workflows:
        if workflow_kind(wf.name) == kind:
            return wf
    return None


async def resolve_handoff_target(session, workflow_id: str, input_message: str) -> str | None:
    """If the message belongs on a different workflow, return that workflow's id."""
    from ..db.models import Workflow

    wf = await session.get(Workflow, workflow_id)
    if not wf:
        return None

    intent = classify_message_intent(input_message)
    kind = workflow_kind(wf.name)
    if not kind or intent in ("greeting", "ambiguous"):
        return None

    if kind == "support" and intent == "payment_investigation":
        target = await find_workflow_by_name(session, PAYMENT_WORKFLOW_NAME)
        return target.id if target else None

    if kind == "payment" and intent == "general_support":
        target = await find_workflow_by_name(session, SUPPORT_WORKFLOW_NAME)
        return target.id if target else None

    return None


_HANDOFF_LINES = {
    ("support", "payment"): (
        "I'm sorry — order failure investigations aren't handled on our general support line. "
        "I'm transferring you to our payment specialist now."
    ),
    ("payment", "support"): (
        "That's a general support question. I'll connect you with our customer support team now."
    ),
}


def polish_handoff_message(raw: str, source_name: str, target_name: str) -> str:
    """Ensure the redirect line is customer-facing, not internal routing notes."""
    text = (raw or "").strip()
    lowered = text.lower()
    internal = any(
        m in lowered
        for m in (
            "user is inquiring",
            "internal",
            "handoff",
            "inform them",
            "scope of",
            "please politely",
            "this request is",
            "falls under",
            "note this",
            "tell the analyst",
        )
    )
    sk, tk = workflow_kind(source_name), workflow_kind(target_name)
    if internal or len(text) > 160:
        return _HANDOFF_LINES.get((sk, tk), f"I'm transferring you to our {target_name} team now.")
    return text
