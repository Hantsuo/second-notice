"""
Tests for the decision layer and the demo loop.
"""

from fastapi.testclient import TestClient

from app import engine
from app.main import app

client = TestClient(app)


def test_decide_escalates_large_amounts() -> None:
    decision = engine.decide(failures=1, amount_cents=25000, kind="declined")
    assert decision.strategy == "escalate"
    assert "worth a person" in decision.rationale


def test_expired_card_asks_for_a_new_one() -> None:
    decision = engine.decide(failures=2, amount_cents=4900, kind="expired")
    assert decision.strategy == "update_method"


def test_first_small_failure_retries() -> None:
    decision = engine.decide(failures=1, amount_cents=1900, kind="declined")
    assert decision.strategy == "retry_now"


def test_three_failures_escalates() -> None:
    decision = engine.decide(failures=3, amount_cents=4900, kind="declined")
    assert decision.strategy == "escalate"


def test_demo_loop_opens_and_recovers() -> None:
    created = client.post(
        "/demo/fail",
        json={"subscription_id": "I-DEMO-TEST", "amount": "49.00", "plan": "Pro monthly"},
    ).json()
    case_id = created["case"]

    page = client.get(f"/r/{case_id}")
    assert page.status_code == 200
    assert "didn't go through" in page.text

    pay = client.get(f"/r/{case_id}/pay?kind=full", follow_redirects=False)
    assert pay.status_code == 303
    location = pay.headers["location"]
    assert "/demo-pay" in location

    order = location.split("order=")[-1]
    done = client.get(f"/r/{case_id}/return?token={order}", follow_redirects=False)
    assert done.status_code == 303

    dashboard = client.get("/dashboard")
    assert "Recovered" in dashboard.text


def test_healthz_reports_mode() -> None:
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert "live_paypal" in body
