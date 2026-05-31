from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from ..db.database import get_session
from ..db.models import Payment, PlaybookEntry
from ..runtime.playbook import DEFAULT_RETRY_RECOMMENDATIONS, normalize_reason
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/payments", tags=["payments"])


class PaymentCreate(BaseModel):
    order_id: str
    status: str = "failed"  # failed | success
    reason: Optional[str] = None
    recommendation: Optional[str] = None
    amount: float = 0.0
    currency: str = "USD"
    gateway: str = "Yuno"
    customer: Optional[str] = None


async def _upsert_playbook(
    session: AsyncSession,
    reason: str,
    recommendation: str,
    *,
    is_builtin: bool = False,
) -> PlaybookEntry:
    key = normalize_reason(reason)
    if not key:
        raise HTTPException(400, "Failure reason is required for playbook entries")
    text = (recommendation or "").strip()
    if not text:
        raise HTTPException(400, "Retry recommendation is required for custom failure reasons")

    existing = await session.get(PlaybookEntry, key)
    if existing:
        existing.recommendation = text
        existing.is_builtin = existing.is_builtin and is_builtin
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing

    entry = PlaybookEntry(
        reason=key,
        recommendation=text,
        is_builtin=is_builtin,
    )
    session.add(entry)
    return entry


@router.get("/")
async def list_payments(session: AsyncSession = Depends(get_session)):
    """All payment records agents can look up via the lookup_payment tool."""
    result = await session.exec(select(Payment).order_by(Payment.order_id))
    rows = result.all()
    playbook_rows = (await session.exec(select(PlaybookEntry).order_by(PlaybookEntry.reason))).all()
    return {
        "records": rows,
        "count": len(rows),
        "playbook": [
            {
                "reason": p.reason,
                "recommendation": p.recommendation,
                "is_builtin": p.is_builtin,
            }
            for p in playbook_rows
        ],
        "default_playbook": DEFAULT_RETRY_RECOMMENDATIONS,
        "scenarios": [
            "Payment failure investigation — ask about a failed order",
            "Fraud review — use an order flagged for fraud",
            "General chat — say hi, then share an order ID in a follow-up",
            "Custom data — add your own records below and test immediately",
        ],
        "example_questions": [
            "Hi, I need help with a payment",
            "Why did my payment fail for order ORD-1002?",
            "Was order ORD-1005 successful?",
            "I think there's fraud on my account — check ORD-1004",
        ],
    }


@router.post("/")
async def create_payment(data: PaymentCreate, session: AsyncSession = Depends(get_session)):
    order_id = data.order_id.strip().upper()
    if not order_id:
        raise HTTPException(400, "Order ID is required")
    existing = await session.get(Payment, order_id)
    if existing:
        raise HTTPException(400, f"Order {order_id} already exists")

    if data.status not in ("failed", "success"):
        raise HTTPException(400, "Status must be 'failed' or 'success'")

    reason = normalize_reason(data.reason) if data.status == "failed" and data.reason else None
    if data.status == "failed" and not reason:
        raise HTTPException(400, "Failure reason is required for failed payments")

    if data.status == "failed":
        custom_reason = reason not in DEFAULT_RETRY_RECOMMENDATIONS
        if custom_reason:
            if not (data.recommendation or "").strip():
                raise HTTPException(
                    400,
                    "Add a retry recommendation for custom failure reasons so get_retry_recommendation can guide the agent.",
                )
            await _upsert_playbook(session, reason, data.recommendation)
        elif (data.recommendation or "").strip():
            await _upsert_playbook(session, reason, data.recommendation)

    payment = Payment(
        order_id=order_id,
        status=data.status,
        reason=reason,
        amount=data.amount,
        currency=data.currency,
        gateway=data.gateway,
        customer=data.customer,
    )
    session.add(payment)
    await session.commit()
    await session.refresh(payment)
    return payment


@router.delete("/{order_id}")
async def delete_payment(order_id: str, session: AsyncSession = Depends(get_session)):
    payment = await session.get(Payment, order_id.upper())
    if not payment:
        raise HTTPException(404, "Record not found")
    await session.delete(payment)
    await session.commit()
    return {"ok": True}
