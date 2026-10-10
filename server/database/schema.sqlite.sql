-- =============================================================================
-- 전통발효체험관 메타버스 — SQLite schema (default, zero-config)
-- Created automatically by lib/Db.php on first request (data/db-<random>.sqlite, WAL mode).
-- All timestamps are server time in milliseconds (INTEGER).
-- Keep in sync with schema.sql (MySQL/MariaDB) and Db::SCHEMA_VERSION.
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
