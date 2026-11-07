"""
The AI layer.

A failure event tells us almost nothing: a code, an amount, a plan. What to do
about it is a judgement call about a person - retry the charge, wait for payday,
split it, ask for a new card, or get a human involved. A rules table gets the
common cases right; the rest needs something that can read the whole picture and
write to the customer like a person would.

So the model makes the call and writes the one sentence the customer reads, while
engine.enforce() keeps the hard guardrails: the model can never retry a
restricted account, keep retrying after three failures, or automate a whale.

Any OpenAI-compatible endpoint works with AI_BASE_URL / AI_MODEL / AI_API_KEY.
With no key it uses a keyless public endpoint, so the demo runs out of the box;
the rules take over whenever the model is slow or down.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("AI_BASE_URL", "https://text.pollinations.ai").rstrip("/")
MODEL = os.environ.get("AI_MODEL", "openai")
API_KEY = os.environ.get("AI_API_KEY", "")
TIMEOUT = float(os.environ.get("AI_TIMEOUT", "30"))

# One call at a time: the keyless endpoint throttles concurrent requests, and a
# queue of two cases is still faster than two timeouts.
_LOCK = threading.Lock()

SYSTEM = """You are the recovery desk of Second Notice, a service that rescues failed
PayPal subscription payments. You get one failed charge and you decide the single
best next action, then write the sentence the customer will read on the recovery page.

Allowed strategies:
- retry_now: the failure looks transient, charge again immediately.
- wait_48h: timing problem (funds, payday), wait two days then retry once.
- split: the amount is large enough that cash flow may be the issue; offer two halves.
- update_method: the instrument is dead (expired card, closed account); a retry cannot work.
- escalate: a human must handle this; automation would damage the relationship.

How to choose well:
- Most first declines on a modest amount are transient. Retrying is cheap and often works.
- Ask for a new card only when the instrument is provably dead (expired, closed, restricted).
- A large amount on a first failure is more likely cash flow than a dead card.
- Protect the relationship: an annoyed high-value customer costs more than one month.

Write the message in one or two sentences, under 220 characters, calm and specific,
never blaming the customer. Never invent facts you were not given.
Reply with JSON only:
{"strategy": "<one of the five>", "message": "<the customer sentence>", "why": "<one short sentence for the merchant, under 120 characters>"}"""


def enabled() -> bool:
    """AI triage is on unless explicitly disabled."""
    return os.environ.get("AI_ENABLED", "true").lower() not in ("0", "false", "no")


def decide(context: dict) -> dict | None:
    """
    Ask the model for one decision.

    Returns {"strategy", "message", "why", "model"} or None when the model is
    unreachable, slow, or answers with something unusable. The caller keeps the
    rule-based decision, so a dead model never stops a recovery.
    """
    prompt = _prompt(context)
    with _LOCK:
        raw = ""
        for attempt in range(2):
            raw = _ask(SYSTEM + "\n\n" + prompt) if not API_KEY else _ask_openai(SYSTEM, prompt)
            if raw:
                break
            time.sleep(1.5)
    if not raw:
        return None
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError):
        return None
    strategy = str(parsed.get("strategy", "")).strip()
    if not strategy:
        return None
    return {
        "strategy": strategy,
        "message": str(parsed.get("message", "")).strip()[:400],
        "why": str(parsed.get("why", "")).strip()[:160],
        "model": MODEL,
    }


def _prompt(context: dict) -> str:
    return (
        "Failed charge:\n"
        f"- plan: {context.get('plan')}\n"
        f"- amount: {context.get('amount')} {context.get('currency', 'USD')}\n"
        f"- PayPal failure reason: {context.get('reason')} ({context.get('reason_text', '')})\n"
        f"- failed attempts so far: {context.get('failures', 1)}\n"
        f"- payer: {context.get('payer') or 'unknown'}\n"
        f"- merchant notes: {context.get('notes') or 'none'}"
    )


def _ask(prompt: str) -> str:
    """Keyless endpoint: the prompt in the path, JSON back."""
    url = f"{BASE_URL}/{urllib.parse.quote(prompt)}?json=true&model={urllib.parse.quote(MODEL)}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
            return resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return ""


def _ask_openai(system: str, prompt: str) -> str:
    """Standard OpenAI-compatible chat completion."""
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    for payload in (body, {k: v for k, v in body.items() if k != "response_format"}):
        try:
            req = urllib.request.Request(
                f"{BASE_URL}/chat/completions",
                data=json.dumps(payload).encode(),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.load(resp)
            return data["choices"][0]["message"]["content"]
        except Exception:  # noqa: BLE001 - fall through to the next attempt
            continue
    return ""


def _extract_json(text: str) -> dict:
    """Models sometimes wrap JSON in prose or fences; find the object."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{") :]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no json")
    return json.loads(text[start : end + 1])
