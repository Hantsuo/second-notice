"""
PayPal sandbox client.

Live mode uses the merchant's client id and secret from the environment.
Demo mode (no credentials) fabricates order ids so the whole loop can be
demonstrated without a PayPal app.
"""

import base64
import json
import os
import secrets
import urllib.parse
import urllib.request

LIVE_BASE = "https://api-m.sandbox.paypal.com"


def configured() -> bool:
    """True when sandbox credentials are present."""
    return bool(os.environ.get("PAYPAL_CLIENT_ID") and os.environ.get("PAYPAL_CLIENT_SECRET"))


def _token() -> str:
    """Client-credentials OAuth token."""
    cid = os.environ["PAYPAL_CLIENT_ID"]
    secret = os.environ["PAYPAL_CLIENT_SECRET"]
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    req = urllib.request.Request(
        LIVE_BASE + "/v1/oauth2/token",
        data=b"grant_type=client_credentials",
        headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)["access_token"]


def _call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        LIVE_BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + _token(), "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def create_order(amount: str, currency: str, reference: str, description: str) -> dict:
    """Create a PayPal order and return {id, approve_url}."""
    if not configured():
        order_id = "DEMO-" + secrets.token_hex(6).upper()
        return {"id": order_id, "approve_url": f"/r/{reference}/demo-pay?order={order_id}", "demo": True}

    order = _call(
        "POST",
        "/v2/checkout/orders",
        {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": reference,
                    "description": description[:127],
                    "amount": {"currency_code": currency, "value": amount},
                }
            ],
            "application_context": {"brand_name": "Second Notice", "user_action": "PAY_NOW"},
        },
    )
    approve = next((link["href"] for link in order.get("links", []) if link["rel"] in ("approve", "payer-action")), "")
    return {"id": order["id"], "approve_url": approve, "demo": False}


def capture_order(order_id: str) -> dict:
    """Capture an approved order."""
    if order_id.startswith("DEMO-"):
        return {"id": order_id, "status": "COMPLETED", "demo": True}
    return _call("POST", f"/v2/checkout/orders/{order_id}/capture", {})


def reactivate_subscription(subscription_id: str, reason: str) -> dict:
    """Ask PayPal to re-activate a suspended subscription."""
    if not configured() or subscription_id.startswith("I-DEMO"):
        return {"ok": True, "demo": True}
    return _call(
        "POST",
        f"/v1/billing/subscriptions/{urllib.parse.quote(subscription_id)}/activate",
        {"reason": reason[:128]},
    )


def verify_webhook(headers: dict, body: dict) -> bool:
    """
    Ask PayPal whether this webhook is genuine.

    Demo mode trusts the caller; live mode always verifies.
    """
    if not configured():
        return True
    payload = {
        "auth_algo": headers.get("paypal-auth-algo", ""),
        "cert_url": headers.get("paypal-cert-url", ""),
        "transmission_id": headers.get("paypal-transmission-id", ""),
        "transmission_sig": headers.get("paypal-transmission-sig", ""),
        "transmission_time": headers.get("paypal-transmission-time", ""),
        "webhook_id": os.environ.get("PAYPAL_WEBHOOK_ID", ""),
        "webhook_event": body,
    }
    result = _call("POST", "/v1/notifications/verify-webhook-signature", payload)
    return result.get("verification_status") == "SUCCESS"
