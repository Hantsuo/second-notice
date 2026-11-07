# Second Notice

> PayPal subscription payments fail silently. Second Notice goes and gets them.

When a subscription charge fails, PayPal tells you (a webhook) and nothing else
happens: the customer is not asked to fix the card, the merchant does not know
how much is at risk, and the subscription quietly suspends. Commercial recovery
tools (Churnkey, Baremetrics Recover) are Stripe-only. This is the PayPal gap.

**Demo video:** https://youtu.be/ZQhQmaML8vM Â· **Live:** https://second-notice.phosphor-bbs.duckdns.org/dashboard

## What it does

1. Receives `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `SUSPENDED`, signature
   verified against PayPal on every event.
2. Builds a case: subscription, plan, price (resolved from the PayPal API), payer,
   failure code, amount at risk.
3. **An AI desk decides the move** â€?retry now, wait 48h, split the amount, ask for
   a new card, or hand it to a human â€?and writes the sentence the customer reads.
   Deterministic rules guard the edges: the model can never retry a restricted
   account, keep retrying after three failures, or automate a high-value case.
4. Serves a hosted recovery page: why it failed, what to do, and a PayPal button.
5. On payment, captures the order and re-activates the subscription.
6. Reports one number: recovered MRR.

## The AI part

`app/ai.py` sends one compact case to a model over an OpenAI-compatible endpoint
and asks for a single JSON decision: the strategy, a customer sentence, and a
one-line reason for the merchant. `engine.enforce()` then checks it against the
hard policy, and every step lands in the case timeline (`decided`, `ai_decided`).

It runs off the request path: PayPal gets its 200 in milliseconds, the case exists
immediately with the rule-based default, and the AI's call replaces it seconds
later. If the model is slow or down, the case simply stays on the rules â€?a dead
model never blocks a recovery.

Any provider works:

```bash
AI_BASE_URL=https://api.openai.com/v1 AI_MODEL=gpt-4o-mini AI_API_KEY=sk-... uv run uvicorn app.main:app
```

With no key it uses a keyless public endpoint, so the demo runs out of the box.

## Design notes

- **Payments never touch the client.** Orders are created server-side with the
  merchant credentials; the browser only receives an approval link.
- **Every action is a row.** Cases, events, offers and captures are stored, so a
  merchant can explain to a customer exactly what was sent and when.
- **The decision is inspectable.** Each case stores the reason code, the inputs,
  who decided (ai or rules), and the chosen strategy with a one-line rationale.
- **Idempotent capture.** A payer refreshing the return URL gets a 422 from PayPal;
  that is treated as success and the existing capture is read, never double charged.

## Run

```bash
uv venv && uv pip install -r requirements.txt
uv run uvicorn app.main:app --port 8020
```

Demo mode (no PayPal credentials) is the default: orders are simulated, and the
recovery page works end to end.

```bash
curl -X POST localhost:8020/demo/fail -H 'content-type: application/json' \
  -d '{"subscription_id":"I-DEMO1","amount":"49.00","plan":"Pro monthly"}'
```

## Status

| Piece | State |
|---|---|
| Case engine + decision rules | done |
| AI decision desk + guardrails | done |
| Hosted recovery page | done |
| Webhook receiver (signature verify) | done |
| PayPal Orders create/capture | live on sandbox |
| Subscription re-activate | live on sandbox |
| Dashboard | done |

## License

MIT.
