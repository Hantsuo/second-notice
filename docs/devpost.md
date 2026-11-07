# Devpost submission draft — Second Notice

## Elevator pitch
PayPal subscriptions fail silently. Second Notice catches the failed-charge webhook, decides what to do about it, asks the customer on one hosted page, takes the payment through PayPal, and re-activates the subscription — recovered MRR instead of silent churn.

## Inspiration
Every subscription business loses 5–10% of monthly revenue to failed cards: expired cards, bank declines, insufficient funds. Stripe shops have Churnkey and Baremetrics Recover. PayPal shops have nothing — you get a webhook, then a spreadsheet. We searched GitHub for "paypal dunning" and "paypal subscription retry": zero repositories. That gap is the whole product.

## What it does
1. **Listens** — `POST /webhook/paypal`, signature verified with `/v1/notifications/verify-webhook-signature` on every event. Handles `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `BILLING.SUBSCRIPTION.SUSPENDED`.
2. **Opens a case** — subscription id, plan name and price resolved from the PayPal API, payer email, failure reason, amount at risk.
3. **Decides** — a rule engine picks `retry_now`, `wait_48h`, `split`, `update_method` or `escalate` from the failure code, the amount and the number of failed attempts. Split payments are offered automatically above a threshold.
4. **Asks** — a hosted recovery page per case. No login, no dunning email chain: one page with the amount, the reason and a Pay button.
5. **Collects** — a real PayPal order is created per case, the payer approves, the order is captured.
6. **Re-activates** — `POST /v1/billing/subscriptions/{id}/activate`, then the case flips to `recovered` and the dashboard moves the money from *at risk* to *recovered MRR*.

## How we built it
Python 3.12, FastAPI, uvicorn, SQLite, no ORM, no queue, no front-end framework — the whole service is four modules and ~900 lines. PayPal Orders v2 and Subscriptions v1 over REST with a client-credentials token cache. Docker Compose behind Caddy with Let's Encrypt. Deployed on a Vultr instance in Singapore.

The demo runs against the **PayPal Sandbox**: a real product, a real $49/month plan, a real subscription (`I-JJ099CRDKRYV`) approved by a sandbox buyer, real orders, real captures, real re-activation. PayPal Sandbox cannot be told to fail a charge on demand, so the failure event itself is replayed against that real subscription (`POST /replay/subscription/{id}`); everything after the event is live API traffic. A signed webhook delivered by PayPal's own simulator proves the verification path end to end.

## Challenges
- **PayPal will not fail a charge on demand.** No sandbox control makes a valid instrument decline. We built the replay endpoint so the rest of the chain stays real — real plan, real price, real payer, real subscription id.
- **Webhook signature verification** has to run on the raw body and the exact headers; any middleware that re-serialises the JSON breaks it.
- **Idempotency.** PayPal returns 422 `ORDER_ALREADY_CAPTURED` when a payer refreshes the return URL. The capture path treats that as success and reads the existing capture instead of double-charging.

## What's next
Dunning schedules per failure code (retry on day 3, 5, 7), multi-currency, Stripe as a second adapter behind the same case model, and a Slack/email alert for `escalate` cases.

## Built with
python, fastapi, sqlite, paypal-rest-api, docker, caddy
