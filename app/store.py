"""
SQLite store for cases, events, offers.

One table per idea, no ORM: the schema is the documentation.
"""

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "second-notice.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
  id            TEXT PRIMARY KEY,
  subscription  TEXT NOT NULL,
  payer_email   TEXT,
  plan          TEXT,
  amount        TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  failures      INTEGER NOT NULL DEFAULT 1,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  strategy      TEXT,
  rationale     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount     TEXT NOT NULL,
  order_id   TEXT,
  status     TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id, id);
"""


def now() -> str:
    """Timestamp in the same shape everywhere."""
    return time.strftime("%Y-%m-%d %H:%M:%S")


def connect(path: Path | str = DB_PATH) -> sqlite3.Connection:
    """Open the database, creating the schema when missing."""
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def add_event(conn: sqlite3.Connection, case_id: str, kind: str, detail: dict | str | None = None) -> None:
    """Append one line to the case timeline."""
    payload = json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else (detail or "")
    conn.execute(
        "INSERT INTO events (case_id, kind, detail, created_at) VALUES (?, ?, ?, ?)",
        (case_id, kind, payload, now()),
    )
    conn.commit()


def events(conn: sqlite3.Connection, case_id: str) -> list[dict]:
    """The full timeline for one case, oldest first."""
    rows = conn.execute(
        "SELECT kind, detail, created_at FROM events WHERE case_id = ? ORDER BY id",
        (case_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def upsert_case(conn: sqlite3.Connection, case: dict) -> None:
    """Insert or update a case row."""
    conn.execute(
        """
        INSERT INTO cases (id, subscription, payer_email, plan, amount, currency,
                           failures, reason, status, strategy, rationale, created_at, updated_at)
        VALUES (:id, :subscription, :payer_email, :plan, :amount, :currency,
                :failures, :reason, :status, :strategy, :rationale, :created_at, :updated_at)
        ON CONFLICT(id) DO UPDATE SET
          failures = excluded.failures,
          status = excluded.status,
          strategy = excluded.strategy,
          rationale = excluded.rationale,
          updated_at = excluded.updated_at
        """,
        case,
    )
    conn.commit()


def get_case(conn: sqlite3.Connection, case_id: str) -> dict | None:
    """One case, or None."""
    row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    return dict(row) if row else None


def list_cases(conn: sqlite3.Connection, status: str | None = None) -> list[dict]:
    """Cases, newest first, optionally filtered by status."""
    if status:
        rows = conn.execute("SELECT * FROM cases WHERE status = ? ORDER BY created_at DESC", (status,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM cases ORDER BY created_at DESC").fetchall()
    return [dict(row) for row in rows]


def add_offer(conn: sqlite3.Connection, offer: dict) -> None:
    """Record an offer (a PayPal order we created for a case)."""
    conn.execute(
        "INSERT INTO offers (id, case_id, kind, amount, order_id, status, created_at) "
        "VALUES (:id, :case_id, :kind, :amount, :order_id, :status, :created_at)",
        offer,
    )
    conn.commit()


def get_offer(conn: sqlite3.Connection, offer_id: str) -> dict | None:
    """One offer, or None."""
    row = conn.execute("SELECT * FROM offers WHERE id = ?", (offer_id,)).fetchone()
    return dict(row) if row else None


def mark_offer_paid(conn: sqlite3.Connection, offer_id: str, order_id: str | None = None) -> None:
    """Flip an offer to paid, optionally storing the captured order id."""
    conn.execute(
        "UPDATE offers SET status = 'paid', order_id = COALESCE(?, order_id) WHERE id = ?",
        (order_id, offer_id),
    )
    conn.commit()


def mark_paid_by_order(conn: sqlite3.Connection, order_id: str) -> None:
    """Flip the offer that holds this order id to paid."""
    conn.execute("UPDATE offers SET status = 'paid' WHERE order_id = ?", (order_id,))
    conn.commit()
