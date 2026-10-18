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

-- 'group' = a normal named group (Dashboard lists these).
-- 'friend' = an implicit 2-person group auto-created the first time two
-- people share an expense directly (not inside a named group), so Friends
-- balances and direct expenses have somewhere to live without inventing a
-- separate expense/balance code path. Never shown in the Dashboard's group list.
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT,
  kind        TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'friend')),
  currency    TEXT NOT NULL DEFAULT 'INR',
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
  category     TEXT NOT NULL DEFAULT 'general',
  paid_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_type   TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'exact', 'percentage', 'shares')),
  -- The inputs the split was computed from (percentages, share ratios, or
  -- exact amounts as entered), kept purely so the edit form can repopulate
  -- itself faithfully. expense_shares.share_cents is always the source of
  -- truth for balances, independent of this.
  split_meta   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT
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

CREATE TABLE IF NOT EXISTS expense_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_expense ON expense_comments(expense_id);

-- One row per notable thing that happened in a group, for the activity feed.
-- payload is small JSON for the UI to render without extra joins.
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'expense_added', 'expense_updated', 'expense_deleted',
                'member_joined', 'member_left',
                'settlement_started', 'settlement_succeeded', 'settlement_failed',
                'comment_added'
              )),
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_group_created ON activity_log(group_id, created_at DESC);

-- A settlement is one "settle up" payment from payer_id to payee_id within a
-- group. source = 'youpi' is backed by one YouPI-PG payment session and
-- mirrors its state machine; source = 'cash' is a manual "mark as paid"
-- record (e.g. handed over cash) and is SUCCESS the moment it's created,
-- same as Splitwise's own "record a payment" feature.
CREATE TABLE IF NOT EXISTS settlements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id           INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payee_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  source             TEXT NOT NULL DEFAULT 'youpi' CHECK (source IN ('youpi', 'cash')),
  status             TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED')),
  note               TEXT,
  youpi_order_id     TEXT UNIQUE,
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

-- A photo or PDF attached to an expense. Stored on local disk
-- (server/data/uploads/<uuid>.<ext>); this row is the only public record of
-- it, served through an authenticated, group-membership-checked route —
-- never a world-readable static folder.
CREATE TABLE IF NOT EXISTS expense_receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_expense ON expense_receipts(expense_id);

-- A template the scheduler (services/scheduler.js) replays into a real
-- expense on each due date. split_config holds whatever resolveSplit() in
-- routes/expenses.js needs for the chosen split_type (participantIds,
-- exactShares, percentages or shareWeights) so a recurring charge goes
-- through the exact same validated split logic as a one-off expense.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  category      TEXT NOT NULL DEFAULT 'general',
  paid_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_type    TEXT NOT NULL CHECK (split_type IN ('equal', 'exact', 'percentage', 'shares')),
  split_config  TEXT NOT NULL,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  next_run_at   TEXT NOT NULL,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_recurring_group ON recurring_expenses(group_id);

-- One row per browser the user has granted Web Push permission in. No
-- external push service account is involved — the Push API's VAPID scheme
-- lets any server send a user's own browser a notification with just a
-- self-generated keypair (services/webPush.js), the same keypair every
-- subscription on this server is signed with.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
