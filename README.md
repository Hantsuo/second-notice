# Second Notice

> PayPal subscription payments fail silently. Second Notice goes and gets them.

When a subscription charge fails, PayPal tells you (a webhook) and nothing else
happens: the customer is not asked to fix the card, the merchant does not know
how much is at risk, and the subscription quietly suspends. Commercial recovery
tools (Churnkey, Baremetrics Recover) are Stripe-only. This is the PayPal gap.

## What it does

1. Receives `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `SUSPENDED`.
2. Builds a case: how many failures, plan, amount, customer history.
3. Decides a recovery path — retry, wait, split the amount, ask for a new card,
   or hand it to a human when the money is large enough to matter.
4. Serves a hosted recovery page: why it failed, what to do, and a PayPal button.
5. On payment, captures the order and re-activates the subscription.
6. Reports one number: recovered MRR.

## Design notes

- **Payments never touch the client.** Orders are created server-side with the
  merchant credentials; the browser only receives an approval link.
- **Every action is a row.** Cases, events, offers and captures are stored, so a
  merchant can explain to a customer exactly what was sent and when.
- **The decision is inspectable.** Each case stores the reason code, the inputs,
  and the chosen strategy with a one-line rationale.

## Run

```bash
uv venv && uv pip install -r requirements.txt
uv run uvicorn app.main:app --port 8020
```

Demo mode (no PayPal credentials) is the default: orders are simulated, the
webhook accepts a shared secret header, and the recovery page works end to end.

```bash
curl -X POST localhost:8020/demo/fail -H 'content-type: application/json' \
  -d '{"subscription_id":"I-DEMO1","amount":"49.00","plan":"Pro monthly"}'
```

## Status

| Piece | State |
|---|---|
| Case engine + decision rules | done |
| Hosted recovery page | done |
| Webhook receiver (signature verify) | done |
| PayPal Orders create/capture | wired, needs sandbox credentials |
| Subscription re-activate | wired, needs sandbox credentials |
| Dashboard | next |

## License

MIT.
