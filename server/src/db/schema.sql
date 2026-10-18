-- Splitwise clone schema (SQLite)
-- Money is always stored as integer paise/cents to avoid float drift.
-- Times are ISO-8601 UTC strings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  upi_vpa       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'INR',
  paid_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_type   TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON expenses(paid_by);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_user ON expense_shares(user_id);

-- A settlement is one "settle up" payment from payer_id to payee_id within a group,
-- backed by one YouPI-PG payment session. status mirrors YouPI-PG's own state machine.
CREATE TABLE IF NOT EXISTS settlements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id           INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payee_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED')),
  youpi_order_id     TEXT NOT NULL UNIQUE,
  youpi_payment_id   TEXT,
  youpi_checkout_url TEXT,
  utr                TEXT,
  method             TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at       TEXT,
  CHECK (payer_id != payee_id)
);
CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_payer ON settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_payee ON settlements(payee_id);

-- Dedupe table for inbound YouPI-PG webhooks (it retries on non-2xx, and delivery
-- can duplicate). Every X-Gateway-Delivery-Id is recorded before it is acted on.
CREATE TABLE IF NOT EXISTS webhook_events (
  delivery_id  TEXT PRIMARY KEY,
  event        TEXT NOT NULL,
  order_id     TEXT,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
