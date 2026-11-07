# Devpost submission — Second Notice

**Video:** https://youtu.be/_-fUHzj8WGs
**Live:** https://second-notice.phosphor-bbs.duckdns.org/dashboard
**Code:** https://github.com/Hantsuo/second-notice

## Elevator pitch
PayPal subscription charges fail silently. Second Notice catches the failure webhook, hands the case to an AI desk that decides how to save the customer and writes the message they read, takes the payment through PayPal, and re-activates the subscription.

## Inspiration
Every subscription business loses 5–10% of monthly revenue to failed cards: expired cards, bank declines, insufficient funds. Stripe shops have Churnkey and Baremetrics Recover. PayPal shops get a webhook and a spreadsheet. We searched GitHub for "paypal dunning" and "paypal subscription retry": zero repositories. That gap is the product.

## What it does
1. **Listens.** `POST /webhook/paypal` verifies every event against `/v1/notifications/verify-webhook-signature` before it is allowed to create anything. Handles `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `BILLING.SUBSCRIPTION.SUSPENDED`.
2. **Opens a case.** Subscription, plan name and price resolved from the PayPal API, payer, failure code, amount at risk — in milliseconds, so PayPal gets its 200 immediately.
3. **Decides with AI.** The case goes to a model over an OpenAI-compatible endpoint: failure code, plan, amount, payer, attempt count. It returns one JSON decision — `retry_now`, `wait_48h`, `split`, `update_method` or `escalate` — plus the one or two sentences the customer will read, and a one-line reason for the merchant.
4. **Guardrails, not vibes.** `engine.enforce()` checks the model's answer against hard policy: never retry a restricted account, never keep retrying after three failures, never automate a high-value case. A model that is slow or down leaves the case on the deterministic rules; a dead model never blocks a recovery.
5. **Asks.** A hosted recovery page per case: what failed, what to do, and a PayPal button. No login, no dunning email chain.
6. **Collects and re-activates.** A real PayPal order per case, approved by the payer, captured server-side, then `POST /v1/billing/subscriptions/{id}/activate`. The case flips to `recovered` and the dashboard moves the money from *at risk* to *recovered MRR*.

## How we built it
Python 3.12, FastAPI, SQLite, no ORM, no queue, no front-end framework — four modules, ~1,000 lines. PayPal Orders v2 and Subscriptions v1 over REST with a cached client-credentials token. The AI call runs on a background thread and lands in the case timeline as its own event, so the webhook stays fast. Docker Compose behind Caddy with Let's Encrypt on a Vultr instance in Singapore.

The demo runs on the **PayPal Sandbox**: a real product, a real $49/month plan, a real subscription (`I-JJ099CRDKRYV`) approved by a sandbox buyer, real orders, real captures, real re-activation. PayPal Sandbox cannot be told to fail a charge on demand, so the failure event itself is replayed against that real subscription (`POST /replay/subscription/{id}`); everything after the event is live API traffic. A signed webhook delivered by PayPal's own simulator proves the verification path end to end.

## Challenges
- **PayPal will not fail a charge on demand.** No sandbox control makes a valid instrument decline. We built the replay endpoint so the rest of the chain stays real — real plan, real price, real payer, real subscription id.
- **Signature verification** has to run on the raw request body and the exact headers; any middleware that re-serialises the JSON breaks it.
- **Idempotency.** PayPal answers 422 `ORDER_ALREADY_CAPTURED` when a payer refreshes the return URL. The capture path treats that as success and reads the existing capture instead of double-charging.
- **Keeping AI out of the critical path.** A payment webhook cannot wait ten seconds for a model. Rules answer first, the AI overrides with its own event when it lands.

## What's next
Dunning schedules per failure code over several days, multi-currency, Stripe as a second adapter behind the same case model, and a Slack alert for `escalate` cases.

## Built with
python, fastapi, sqlite, paypal-rest-api, llm, openai-compatible, docker, caddy
