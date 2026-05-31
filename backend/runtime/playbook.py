"""Retry recommendation playbook — defaults plus DB-backed custom entries."""

import re
from typing import Dict

DEFAULT_RETRY_RECOMMENDATIONS: Dict[str, str] = {
    "insufficient_funds": "Please ensure your account has sufficient balance and retry.",
    "card_expired": "Your card has expired. Please update your payment method and retry.",
    "gateway_timeout": "This was a temporary network issue. Please retry your payment.",
    "fraud_detected": "This transaction was flagged for security review. Please contact your bank.",
}


def normalize_reason(reason: str) -> str:
    """Normalize failure reason codes for consistent playbook lookups."""
    raw = (reason or "").strip().lower()
    raw = re.sub(r"[\s\-]+", "_", raw)
    return re.sub(r"[^a-z0-9_]", "", raw)


def default_recommendation(reason: str) -> str:
    key = normalize_reason(reason)
    return DEFAULT_RETRY_RECOMMENDATIONS.get(
        key,
        f"Please review the issue ({key or reason}) and contact support if needed.",
    )
