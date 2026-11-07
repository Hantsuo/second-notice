"""
Second Notice - webhook in, recovered revenue out.

Routes:
  POST /webhook/paypal      PayPal event receiver (signature verified in live mode)
  POST /demo/fail           Seed a failure for the demo
  GET  /r/{case_id}         Hosted recovery page
  POST /r/{case_id}/pay     Create a PayPal order and send the payer to approve
  GET  /r/{case_id}/return  Capture after approval, re-activate the subscription
  GET  /dashboard           Cases and recovered MRR
"""

import html
import os
import secrets
from decimal import Decimal, InvalidOperation

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from . import engine, paypal_api, store

app = FastAPI(title="Second Notice", version="0.1.0")

DB = store.connect()


def _cents(amount: str) -> int:
    try:
        return int(Decimal(str(amount).replace(",", "")) * 100)
    except (InvalidOperation, ValueError):
        return 0


def _money(cents: int, currency: str = "USD") -> str:
    return f"{Decimal(cents) / 100:.2f} {currency}"


def _open_case_for(subscription: str) -> dict | None:
    for case in store.list_cases(DB, status="open"):
        if case["subscription"] == subscription:
            return case
    return None


def _new_case(event: dict) -> dict:
    """Turn a PayPal failure event into a case with a decision."""
    resource = event.get("resource", {}) or {}
    subscription = resource.get("billing_agreement_id") or resource.get("id") or "unknown"
    amount = (resource.get("amount") or {}).get("total") or (resource.get("amount") or {}).get("value") or "0.00"
    currency = (resource.get("amount") or {}).get("currency_code") or "USD"
    plan = resource.get("plan_id") or "subscription"

    if not amount or amount == "0.00":
        plan_info = paypal_api.get_plan(resource.get("id", "")) if str(resource.get("id", "")).startswith("P-") else {}
        cycles = plan_info.get("billing_cycles") or []
        if cycles:
            price = (cycles[0].get("pricing_scheme") or {}).get("fixed_price") or {}
            amount = price.get("value") or amount
            currency = price.get("currency_code") or currency
            plan = plan_info.get("name") or plan

    if str(subscription).startswith("P-"):
        subscription = "SUB-" + str(event.get("id", ""))[-8:]
    if str(plan).startswith("P-"):
        plan_info = paypal_api.get_plan(str(plan))
        plan = plan_info.get("name") or "unknown plan"
    email = resource.get("payer", {}).get("email_address") or resource.get("subscriber", {}).get("email_address")
    reason_code = resource.get("payment_failure_reason") or resource.get("reason_code") or "UNKNOWN"

    try:
        amount = f"{Decimal(str(amount)):.2f}"
    except (InvalidOperation, ValueError):
        amount = "0.00"

    kind, _ = engine.classify(reason_code)
    cents = _cents(amount)
    if cents == 0:
        decision = engine.Decision("escalate", "Amount missing from the event; a human should price it.")
    else:
        decision = engine.decide(failures=1, amount_cents=cents, kind=kind)

    case = {
        "id": "SN-" + secrets.token_hex(4).upper(),
        "subscription": subscription,
        "payer_email": email,
        "plan": plan,
        "amount": amount,
        "currency": currency,
        "failures": 1,
        "reason": reason_code,
        "status": "open",
        "strategy": decision.strategy,
        "rationale": decision.rationale,
        "source": event.get("_source", "live"),
        "created_at": store.now(),
        "updated_at": store.now(),
    }
    store.upsert_case(DB, case)
    store.add_event(DB, case["id"], "payment_failed", {"reason": reason_code, "amount": amount, "plan": plan})
    store.add_event(DB, case["id"], "decided", {"strategy": decision.strategy, "why": decision.rationale})
    return case


@app.get("/healthz")
def healthz() -> dict:
    """Liveness and mode."""
    return {"ok": True, "live_paypal": paypal_api.configured(), "cases": len(store.list_cases(DB))}


@app.post("/webhook/paypal")
async def paypal_webhook(request: Request) -> JSONResponse:
    """Receive a PayPal webhook, verify it, and open or update a case."""
    raw = await request.body()
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "invalid json"}, status_code=400)

    headers = {k.lower(): v for k, v in request.headers.items()}
    if not paypal_api.verify_webhook(headers, body):
        return JSONResponse({"error": "bad signature"}, status_code=401)

    event_type = body.get("event_type", "")
    if event_type not in ("BILLING.SUBSCRIPTION.PAYMENT.FAILED", "BILLING.SUBSCRIPTION.SUSPENDED"):
        return JSONResponse({"ignored": event_type})

    subscription = (body.get("resource") or {}).get("billing_agreement_id") or ""
    existing = _open_case_for(subscription) if subscription else None
    if existing:
        existing["failures"] += 1
        existing["updated_at"] = store.now()
        kind, _ = engine.classify(existing["reason"])
        decision = engine.decide(existing["failures"], _cents(existing["amount"]), kind)
        existing["strategy"] = decision.strategy
        existing["rationale"] = decision.rationale
        store.upsert_case(DB, existing)
        store.add_event(DB, existing["id"], "failed_again", {"failures": existing["failures"], "strategy": decision.strategy})
        return JSONResponse({"case": existing["id"], "failures": existing["failures"], "strategy": decision.strategy})

    case = _new_case(body)
    return JSONResponse({"case": case["id"], "strategy": case["strategy"]})


@app.post("/demo/fail")
async def demo_fail(request: Request) -> JSONResponse:
    """Seed a failure without PayPal, for the demo."""
    payload = await request.json()
    event = {
        "_source": "demo",
        "event_type": "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
        "resource": {
            "billing_agreement_id": payload.get("subscription_id", "I-DEMO"),
            "plan_id": payload.get("plan", "Pro monthly"),
            "amount": {"total": payload.get("amount", "49.00"), "currency_code": payload.get("currency", "USD")},
            "payment_failure_reason": payload.get("reason", "INSTRUMENT_DECLINED"),
            "payer": {"email_address": payload.get("email", "sam@example.com")},
        },
    }
    case = _new_case(event)
    return JSONResponse({"case": case["id"], "strategy": case["strategy"], "rationale": case["rationale"]})


@app.post("/replay/subscription/{subscription_id}")
def replay_subscription(subscription_id: str) -> JSONResponse:
    """
    Bind a case to a real PayPal subscription.

    PayPal cannot be told to fail a live charge on demand, so this replays a
    failure against the subscription's real plan, price and payer. Everything
    after this point - the page, the order, the capture, the re-activation - is
    real API traffic.
    """
    sub = paypal_api.get_subscription(subscription_id)
    if not sub:
        return JSONResponse({"error": "subscription not found"}, status_code=404)

    plan_id = sub.get("plan_id", "")
    plan = paypal_api.get_plan(plan_id)
    cycles = plan.get("billing_cycles") or []
    price = (cycles[0].get("pricing_scheme") or {}).get("fixed_price") or {}
    amount = price.get("value") or "0.00"
    currency = price.get("currency_code") or "USD"

    event = {
        "_source": "replay",
        "event_type": "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
        "id": "REPLAY-" + subscription_id[-8:],
        "resource": {
            "billing_agreement_id": subscription_id,
            "plan_id": plan_id,
            "amount": {"total": amount, "currency_code": currency},
            "payment_failure_reason": "INSTRUMENT_DECLINED",
            "payer": {"email_address": sub.get("subscriber", {}).get("email_address", "")},
        },
    }
    case = _new_case(event)
    return JSONResponse({
        "case": case["id"],
        "subscription": subscription_id,
        "plan": plan.get("name"),
        "amount": amount,
        "strategy": case["strategy"],
    })


@app.get("/r/{case_id}", response_class=HTMLResponse)
def recovery_page(case_id: str) -> HTMLResponse:
    """The page the customer sees."""
    case = store.get_case(DB, case_id)
    if not case:
        return HTMLResponse("<h1>Unknown case</h1>", status_code=404)
    kind, _ = engine.classify(case["reason"])
    message = engine.recovery_message(kind, case["plan"], case["amount"], case["strategy"])
    split = case["strategy"] == "split"
    half = f"{Decimal(case['amount']) / 2:.2f}"
    options = (
        f'<a class="btn" href="/r/{case_id}/pay?kind=split">Pay {half} now, {half} in two weeks</a>'
        if split
        else f'<a class="btn" href="/r/{case_id}/pay?kind=full">Pay {case["amount"]} now</a>'
    )
    note = (
        '<p class="meta">A person from the team will also email you today about this one.</p>'
        if case["strategy"] == "escalate"
        else ""
    )
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment problem - {html.escape(case["plan"])}</title>
<style>
:root{{--ink:#101418;--muted:#5b6672;--line:#e3e7ec;--accent:#0b5fff}}
*{{box-sizing:border-box}}
body{{margin:0;font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#f7f8fa}}
main{{max-width:620px;margin:8vh auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:36px}}
h1{{font-size:22px;margin:0 0 6px}}
p{{color:var(--muted);margin:0 0 18px}}
.btn{{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin:10px 0}}
.alt{{background:#fff;color:var(--ink);border:1px solid var(--line)}}
.meta{{font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:22px;padding-top:14px}}
</style></head><body><main>
<h1>Your subscription payment didn't go through</h1>
<p>{html.escape(message)}</p>
{options}
{note}
<a class="btn alt" href="/r/{case_id}/pay?kind=update">Use a different card</a>
<p class="meta">Case {case_id} · {html.escape(case["plan"])} · {html.escape(case["amount"])} {html.escape(case["currency"])}. Nothing has been charged twice; this replaces the failed payment.</p>
</main></body></html>"""
    return HTMLResponse(page)


@app.get("/r/{case_id}/pay")
def pay(case_id: str, kind: str = "full") -> RedirectResponse:
    """Create an order and send the payer to PayPal (or the demo capture)."""
    case = store.get_case(DB, case_id)
    if not case:
        return RedirectResponse("/", status_code=404)
    amount = case["amount"]
    if kind == "split":
        amount = f"{Decimal(amount) / 2:.2f}"
    order = paypal_api.create_order(amount, case["currency"], case_id, f"{case['plan']} recovery")
    offer_id = "OF-" + secrets.token_hex(4).upper()
    store.add_offer(
        DB,
        {
            "id": offer_id,
            "case_id": case_id,
            "kind": kind,
            "amount": amount,
            "order_id": order["id"],
            "status": "created",
            "created_at": store.now(),
        },
    )
    store.add_event(DB, case_id, "offer_created", {"kind": kind, "amount": amount, "order": order["id"]})
    target = order["approve_url"] if not order.get("demo") else f"/r/{case_id}/demo-pay?order={order['id']}"
    return RedirectResponse(target, status_code=303)


@app.get("/r/{case_id}/demo-pay", response_class=HTMLResponse)
def demo_pay(case_id: str, order: str) -> HTMLResponse:
    """Stand-in for the PayPal approval screen, demo mode only."""
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Demo checkout</title>
<style>body{{font:16px/1.5 -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f8fa}}
main{{background:#fff;border:1px solid #e3e7ec;border-radius:14px;padding:32px;max-width:460px;text-align:center}}
a{{display:block;background:#0b5fff;color:#fff;text-decoration:none;padding:14px;border-radius:10px;margin-top:18px;font-weight:600}}</style>
</head><body><main><h2>Demo mode</h2><p>No PayPal credentials are configured, so this stands in for the approval screen.</p>
<a href="/r/{case_id}/return?token={order}">Approve and pay</a></main></body></html>"""
    return HTMLResponse(page)


@app.get("/r/{case_id}/return")
def complete(case_id: str, token: str) -> RedirectResponse:
    """Capture the order, mark the case recovered, re-activate the subscription."""
    case = store.get_case(DB, case_id)
    if not case:
        return RedirectResponse("/", status_code=404)
    capture = paypal_api.capture_order(token)
    store.mark_paid_by_order(DB, token)
    case["status"] = "recovered"
    case["updated_at"] = store.now()
    store.upsert_case(DB, case)
    store.add_event(DB, case_id, "captured", {"order": token, "status": capture.get("status")})
    activated = paypal_api.reactivate_subscription(case["subscription"], "Second Notice recovery")
    sub = paypal_api.get_subscription(case["subscription"])
    store.add_event(DB, case_id, "subscription_reactivated", {
        "subscription": case["subscription"],
        "activated": activated,
        "status_now": sub.get("status", "unknown"),
    })
    return RedirectResponse(f"/r/{case_id}/done", status_code=303)


@app.get("/r/{case_id}/done", response_class=HTMLResponse)
def done(case_id: str) -> HTMLResponse:
    """Thanks page."""
    page = """<!doctype html><html><head><meta charset="utf-8"><title>Paid</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f8fa}
main{background:#fff;border:1px solid #e3e7ec;border-radius:14px;padding:36px;max-width:480px;text-align:center}</style>
</head><body><main><h2>You're all set</h2><p>Payment received and the subscription is active again. You can close this page.</p></main></body></html>"""
    return HTMLResponse(page)


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard() -> HTMLResponse:
    """Merchant view: at-risk and recovered."""
    cases = store.list_cases(DB)
    recovered = [c for c in cases if c["status"] == "recovered"]
    open_cases = [c for c in cases if c["status"] == "open"]
    mrr = sum(_cents(c["amount"]) for c in recovered)
    at_risk = sum(_cents(c["amount"]) for c in open_cases)
    rows = "".join(
        f"<tr><td>{html.escape(c['id'])}</td><td>{html.escape(c['plan'])}</td>"
        f"<td>{c['amount']}</td><td>{html.escape(c['strategy'] or '')}</td>"
        f"<td>{html.escape(c['status'])}</td><td>{html.escape(c.get('source', 'live'))}</td>"
        f"<td><a href='/r/{c['id']}'>open</a></td></tr>"
        for c in cases
    ) or "<tr><td colspan=7>No cases yet. POST /demo/fail to make one.</td></tr>"
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Second Notice</title>
<style>body{{font:15px/1.5 -apple-system,Segoe UI,sans-serif;margin:0;background:#f7f8fa;color:#101418}}
main{{max-width:960px;margin:6vh auto;padding:0 20px}}
.cards{{display:flex;gap:16px;margin:20px 0}}
.card{{flex:1;background:#fff;border:1px solid #e3e7ec;border-radius:12px;padding:18px}}
.card b{{display:block;font-size:26px;margin-top:6px}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e7ec;border-radius:12px;overflow:hidden}}
th,td{{text-align:left;padding:10px 12px;border-bottom:1px solid #eef1f4;font-size:14px}}
th{{background:#fbfcfd;color:#5b6672;font-weight:600}}</style></head><body><main>
<h1>Second Notice</h1>
<div class="cards">
<div class="card">Recovered<b>${mrr/100:,.2f}</b></div>
<div class="card">At risk<b>${at_risk/100:,.2f}</b></div>
<div class="card">Cases<b>{len(cases)}</b></div>
</div>
<table><tr><th>Case</th><th>Plan</th><th>Amount</th><th>Strategy</th><th>Status</th><th>Source</th><th></th></tr>{rows}</table>
</main></body></html>"""
    return HTMLResponse(page)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8020")))
