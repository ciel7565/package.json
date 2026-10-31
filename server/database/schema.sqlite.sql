-- =============================================================================
-- 전통발효체험관 메타버스 — SQLite schema (default, zero-config)
-- Created automatically by lib/Db.php on first request (data/db-<random>.sqlite, WAL mode).
-- All timestamps are server time in milliseconds (INTEGER).
-- Keep in sync with schema.sql (MySQL/MariaDB) and Db::SCHEMA_VERSION (currently 5).
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER NOT NULL PRIMARY KEY,
  applied_at  INTEGER NOT NULL,
  note        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL,                       -- lower-case
  nickname            TEXT NOT NULL,
  nickname_key        TEXT NOT NULL,                       -- lower-case, for case-insensitive uniqueness
  password_hash       TEXT NOT NULL,                       -- password_hash() (argon2id or bcrypt)
  role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  muted_until         INTEGER NOT NULL DEFAULT 0,
  session_epoch       INTEGER NOT NULL DEFAULT 0,          -- bump to sign the user out everywhere
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_login_at       INTEGER NOT NULL DEFAULT 0,
  last_login_ip       TEXT NOT NULL DEFAULT '',
  password_changed_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_nickname ON users (nickname_key);
CREATE INDEX IF NOT EXISTS ix_users_created ON users (created_at);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        INTEGER NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  level          INTEGER NOT NULL DEFAULT 1,
  exp_total      INTEGER NOT NULL DEFAULT 0,
  coin           INTEGER NOT NULL DEFAULT 0,
  edu            INTEGER NOT NULL DEFAULT 0,
  title          TEXT NOT NULL DEFAULT '',
  avatar         TEXT,
  quests_claimed INTEGER NOT NULL DEFAULT 0,
  achievements   INTEGER NOT NULL DEFAULT 0,
  harvests       INTEGER NOT NULL DEFAULT 0,
  ferments       INTEGER NOT NULL DEFAULT 0,
  journals       INTEGER NOT NULL DEFAULT 0,
  play_time      INTEGER NOT NULL DEFAULT 0,
  zone_id        TEXT NOT NULL DEFAULT '',
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_profiles_rank ON user_profiles (level DESC, exp_total DESC);

CREATE TABLE IF NOT EXISTS player_saves (
  user_id         INTEGER NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  revision        INTEGER NOT NULL DEFAULT 0,
  data            TEXT NOT NULL,                 -- JSON (validated game state)
  checksum        TEXT NOT NULL DEFAULT '',
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  meta            TEXT NOT NULL DEFAULT '{}',    -- server-side ledger (rewards already paid, observed timings, budgets)
  backup_data     TEXT,                          -- previous accepted save (one-step restore)
  backup_saved_at INTEGER NOT NULL DEFAULT 0,
  saved_at        INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  rejects         INTEGER NOT NULL DEFAULT 0,
  last_reject_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash     TEXT NOT NULL,                     -- HMAC(ip) — throttling works without storing raw IPs
  account_key TEXT NOT NULL,                     -- lower-case login (email or nickname), hashed
  success     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_ip ON login_attempts (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS ix_login_account ON login_attempts (account_key, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT NOT NULL PRIMARY KEY,          -- name|identity|window
  hits       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rate_expires ON rate_limits (expires_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  nickname   TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'all' CHECK (channel IN ('all', 'local', 'system')),
  text       TEXT NOT NULL,
  text_key   TEXT NOT NULL DEFAULT '',           -- normalized text for repeat-spam detection
  x          REAL,
  z          REAL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chat_created ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS ix_chat_user ON chat_messages (user_id, created_at);

CREATE TABLE IF NOT EXISTS chat_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id    INTEGER NOT NULL,
  target_user_id INTEGER,
  target_name    TEXT NOT NULL,
  message_id     INTEGER,
  message_text   TEXT NOT NULL DEFAULT '',
  reason         TEXT NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER NOT NULL DEFAULT 0,
  resolved_by    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_reports_status ON chat_reports (status, created_at);
CREATE INDEX IF NOT EXISTS ix_reports_reporter ON chat_reports (reporter_id, created_at);

CREATE TABLE IF NOT EXISTS presence (
  user_id    INTEGER NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  nickname   TEXT NOT NULL,
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  z          REAL NOT NULL DEFAULT 0,
  rot_y      REAL NOT NULL DEFAULT 0,
  anim       TEXT,
  speed      REAL NOT NULL DEFAULT 0,
  zone_id    TEXT,
  emote      TEXT,
  emote_at   INTEGER NOT NULL DEFAULT 0,
  appearance TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_presence_updated ON presence (updated_at);

CREATE TABLE IF NOT EXISTS journal_uploads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  path       TEXT NOT NULL,                      -- relative URL, e.g. uploads/journal/2026/10/<hex>.jpg
  mime       TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_uploads_user ON journal_uploads (user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  user_id    INTEGER,                            -- subject
  actor_id   INTEGER,                            -- who did it (admin actions)
  ip         TEXT NOT NULL DEFAULT '',
  event      TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'alert')),
  detail     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS ix_audit_event ON audit_log (event, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_log (user_id, created_at);

INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'initial schema');

-- v2 (kid safety): chat_messages.text_key used to be built from the UNMASKED text, so phone numbers / e-mails that
-- were masked in `text` stayed readable there. Keys are now built from the masked text; older keys are cleared
-- (they only feed the 30-second repeat-spam check). Re-running this file later only touches rows older than v2.
UPDATE chat_messages SET text_key = '' WHERE text_key <> '' AND created_at < COALESCE((SELECT applied_at FROM schema_version WHERE version = 2), 9007199254740991);
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (2, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'chat text_key from masked text');

-- v3 (moderation reaches players who are online): a hidden message or a banned sender is "taken back" from every
-- open game, not only filtered out of new chat/list.php results. Each row retracts one message (hide, 3 reports) or
-- every message of one account (ban); chat/list.php hands them out after the client's retraction cursor (rafter).
CREATE TABLE IF NOT EXISTS chat_retractions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER,
  user_id    INTEGER,
  upto_id    INTEGER,                              -- v5: ban watermark (highest chat_messages.id at ban time)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_retractions_created ON chat_retractions (created_at);
-- v3 also: a report without a message id used to keep the text the REPORTER typed as message_text, which admin.php
-- shows as the target's words; it moves into the memo, marked as unverified (chat/report.php stores it that way now)
UPDATE chat_reports SET memo = '신고자가 적은 내용(확인 안 됨): “' || message_text || '”' || CASE WHEN memo <> '' THEN ' · ' || memo ELSE '' END, message_text = '' WHERE message_id IS NULL AND message_text <> '';
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (3, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'chat retractions');

-- v4 (phase 6, CONTRACT §14.6): progression-speed subscription tiers (2× · 3× · 4×) paid through 토스페이먼츠.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id       INTEGER NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  tier          INTEGER NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 4),
  status        TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'active', 'past_due', 'canceled')),
  started_at    INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL DEFAULT 0,
  auto_renew    INTEGER NOT NULL DEFAULT 0,
  billing_key   TEXT NOT NULL DEFAULT '',
  customer_key  TEXT NOT NULL DEFAULT '',
  last_order_id TEXT NOT NULL DEFAULT '',
  checked_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sub_status ON subscriptions (status, expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  tier         INTEGER NOT NULL,
  amount       INTEGER NOT NULL,                 -- integer KRW
  currency     TEXT NOT NULL DEFAULT 'KRW',
  kind         TEXT NOT NULL DEFAULT 'first' CHECK (kind IN ('first', 'renewal', 'manual')),
  status       TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'confirmed', 'failed', 'canceled', 'refunded')),
  payment_key  TEXT NOT NULL DEFAULT '',
  method       TEXT NOT NULL DEFAULT '',
  receipt_url  TEXT NOT NULL DEFAULT '',
  toss_status  TEXT NOT NULL DEFAULT '',
  raw          TEXT,
  requested_at INTEGER NOT NULL,
  approved_at  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_order ON orders (order_id);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders (status, requested_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL,
  event      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT '',
  payload    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pevents_order ON payment_events (order_id, event, status);
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (4, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'subscriptions (speed tiers, 토스페이먼츠 orders, payment events)');

-- v5 (phase 6): a ban's retraction carries a watermark (chat_retractions.upto_id = the highest chat_messages.id at ban
-- time), so a game that polls only after a ban AND an unban keeps the lines posted after the unban. New databases get
-- the column from CREATE TABLE above; SQLite has no conditional ADD COLUMN, so lib/Db.php adds it to an existing
-- table (Db::ensureColumns, same transaction as this file).
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (5, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'chat retraction watermark (upto_id)');
