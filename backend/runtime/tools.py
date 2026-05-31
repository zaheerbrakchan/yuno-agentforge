from langchain_core.tools import tool
from typing import Dict, Any
import re


@tool
def lookup_payment(order_id: str) -> Dict[str, Any]:
    """Look up a payment record by order ID and return its status and failure reason."""
    from sqlmodel import Session, select
    from ..db.database import sync_engine
    from ..db.models import Payment

    raw = (order_id or "").strip()
    # Be forgiving about how the user typed the id (e.g. "order 1001" -> "ORD-1001").
    candidates = [raw, raw.upper()]
    digits = re.findall(r"\d+", raw)
    if digits:
        candidates.append(f"ORD-{digits[-1]}")

    with Session(sync_engine) as session:
        payment = None
        for cand in candidates:
            payment = session.get(Payment, cand)
            if payment:
                break
        if payment is None:
            # Fall back to a case-insensitive scan before giving up.
            for p in session.exec(select(Payment)).all():
                if p.order_id.lower() == raw.lower():
                    payment = p
                    break

        if payment is None:
            return {
                "status": "not_found",
                "order_id": raw,
                "message": "No payment record found for this order ID.",
            }

        return {
            "order_id": payment.order_id,
            "status": payment.status,
            "reason": payment.reason,
            "amount": payment.amount,
            "currency": payment.currency,
            "gateway": payment.gateway,
        }


@tool
def get_retry_recommendation(failure_reason: str) -> str:
    """Given a payment failure reason, return a recommendation for the user."""
    from sqlmodel import Session
    from ..db.database import sync_engine
    from ..db.models import PlaybookEntry
    from .playbook import default_recommendation, normalize_reason

    key = normalize_reason(failure_reason)
    if not key:
        return default_recommendation(failure_reason)

    with Session(sync_engine) as session:
        entry = session.get(PlaybookEntry, key)
        if entry:
            return entry.recommendation

    return default_recommendation(key)


@tool
def list_supported_payment_methods() -> list:
    """Returns the list of payment methods supported by Yuno."""
    return [
        "Visa", "Mastercard", "Amex", "PayPal", "Stripe",
        "PIX", "OXXO", "Mercado Pago", "PSE", "Nequi"
    ]


_SUPPORT_TOPICS = {
    "hours": (
        "Support is available 24/7 for urgent payment failures. "
        "Billing and refund questions: Mon–Fri 9am–6pm BRT."
    ),
    "refunds": (
        "Refunds are returned to the original payment method within 5–10 business days. "
        "Include your order ID when opening a refund request."
    ),
    "contact": (
        "Email support@yuno.com or use in-app chat. "
        "For failed payments, include your order ID (e.g. ORD-1002) so we can investigate."
    ),
    "regions": (
        "Yuno operates in the US, Brazil, Mexico, and Colombia with local methods "
        "such as PIX, OXXO, PSE, and Mercado Pago."
    ),
}


@tool
def get_support_info(topic: str) -> str:
    """Return Yuno customer support policy info. Topics: hours, refunds, contact, regions."""
    raw = (topic or "").strip().lower()
    aliases = {
        "hour": "hours",
        "time": "hours",
        "schedule": "hours",
        "refund": "refunds",
        "return": "refunds",
        "money back": "refunds",
        "email": "contact",
        "phone": "contact",
        "help": "contact",
        "region": "regions",
        "country": "regions",
        "countries": "regions",
        "market": "regions",
    }
    key = aliases.get(raw, raw)
    if key not in _SUPPORT_TOPICS:
        for k in _SUPPORT_TOPICS:
            if k in raw or raw in k:
                key = k
                break
    return _SUPPORT_TOPICS.get(
        key,
        "Available topics: hours, refunds, contact, regions. Ask about any of these.",
    )


AVAILABLE_TOOLS = {
    "lookup_payment": lookup_payment,
    "get_retry_recommendation": get_retry_recommendation,
    "list_supported_payment_methods": list_supported_payment_methods,
    "get_support_info": get_support_info,
}
