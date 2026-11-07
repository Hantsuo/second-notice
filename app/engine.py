"""
The decision layer.

A failed payment is not one problem, it is four: an expired card, a customer
without money this week, a bank that said no, or a whale we should not annoy
with automation. The rules below pick a recovery path and say why, in one line,
so a merchant can audit it.
"""

from dataclasses import dataclass

STRATEGIES = {
    "retry_now": "Try the same charge again right away.",
    "wait_48h": "Wait two days, then retry once.",
    "split": "Offer to split the amount into two payments.",
    "update_method": "Ask for a new card; the old one is dead.",
    "escalate": "Hand to a human: the amount is worth a personal message.",
    "write_off": "Stop chasing; recovery cost is higher than the value.",
}

REASONS = {
    "INSTRUMENT_DECLINED": ("declined", "The bank declined the card."),
    "CREDIT_CARD_EXPIRED": ("expired", "The card on file has expired."),
    "INSUFFICIENT_FUNDS": ("funds", "Not enough funds at charge time."),
    "PAYER_ACCOUNT_RESTRICTED": ("restricted", "The payer account is restricted."),
    "SELLER_ACCOUNT_RESTRICTED": ("seller", "The merchant account is restricted."),
    "UNKNOWN": ("unknown", "PayPal did not say why."),
}


@dataclass
class Decision:
    """One case's recovery path."""

    strategy: str
    rationale: str

    @property
    def explanation(self) -> str:
        return STRATEGIES.get(self.strategy, "")


def classify(raw_reason: str | None) -> tuple[str, str]:
    """Map a PayPal failure code to (short kind, human sentence)."""
    if not raw_reason:
        return REASONS["UNKNOWN"]
    return REASONS.get(raw_reason, REASONS["UNKNOWN"])


def decide(failures: int, amount_cents: int, kind: str, ltv_cents: int = 0) -> Decision:
    """
    Pick a recovery path.

    Order matters: protect high-value relationships first, then fix the cause,
    then try cheap recovery, then give up.
    """
    dollars = amount_cents / 100

    if kind in ("restricted", "seller"):
        return Decision("escalate", f"Account restriction, not a card problem; ${dollars:.2f} at stake.")
    if amount_cents >= 20000 or ltv_cents >= 100000:
        return Decision("escalate", f"${dollars:.2f} this cycle, LTV ${ltv_cents/100:.2f}: worth a person.")
    if kind == "expired":
        return Decision("update_method", "Card expired; a retry cannot succeed.")
    if failures >= 3:
        return Decision("escalate", f"{failures} failures in a row; automation has run out of moves.")
    if failures == 1 and amount_cents < 5000:
        return Decision("retry_now", f"First failure on ${dollars:.2f}; most are transient.")
    if amount_cents >= 8000:
        return Decision("split", f"${dollars:.2f} may be a cash-flow problem; split it.")
    if kind == "funds":
        return Decision("wait_48h", "Insufficient funds usually clears at payday.")
    return Decision("retry_now", "Small amount, first or second failure: retry is cheapest.")


def recovery_message(kind: str, plan: str, amount: str, strategy: str) -> str:
    """The one sentence shown at the top of the recovery page."""
    if kind == "expired":
        return f"Your card on file expired, so the {plan} payment of ${amount} did not go through."
    if kind == "funds":
        return f"The {plan} payment of ${amount} did not clear — the bank said insufficient funds."
    if kind == "declined":
        return f"The bank declined the {plan} payment of ${amount}."
    return f"The {plan} payment of ${amount} could not be collected."


def enforce(strategy: str, failures: int, amount_cents: int, kind: str) -> tuple[str, bool]:
    """
    Apply the hard guardrails to a model's choice.

    The model may pick the strategy; it may not pick one that automation is not
    allowed to take. Returns (strategy, changed).
    """
    wanted = strategy
    if strategy not in STRATEGIES:
        strategy = "escalate"
    elif kind in ("restricted", "seller"):
        strategy = "escalate"
    elif strategy == "retry_now" and failures >= 3:
        strategy = "escalate"
    elif strategy == "retry_now" and amount_cents >= 20000:
        strategy = "escalate"
    return strategy, strategy != wanted
