-- =============================================================================
-- 전통발효체험관 메타버스 — SQLite schema (default, zero-config)
-- Created automatically by lib/Db.php on first request (data/db-<random>.sqlite, WAL mode).
-- All timestamps are server time in milliseconds (INTEGER).
-- Keep in sync with schema.sql (MySQL/MariaDB) and Db::SCHEMA_VERSION (currently 7).
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

-- v6 (phase 7, CONTRACT §15.8): real-time farm records measured by the server clock (farm_beds), storage mirror
-- (farm_storage), completion confirmations with the admin's memo (crop_reports), operator settings (settings),
-- suspicious-activity log and IP blocks (security_events, ip_blocks), admin 2-step sign-in (admin_totp),
-- Claude API usage (ai_usage), developer handover checklist and inspection history (handover_items, inspection_runs).
CREATE TABLE IF NOT EXISTS settings (
  k          TEXT NOT NULL PRIMARY KEY,
  v          TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  user_id    INTEGER,
  kind       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info', 'warn', 'alert')),
  path       TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_secev_created ON security_events (created_at);
CREATE INDEX IF NOT EXISTS ix_secev_ip ON security_events (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS ix_secev_kind ON security_events (kind, created_at);

CREATE TABLE IF NOT EXISTS ip_blocks (
  ip_hash    TEXT NOT NULL PRIMARY KEY,
  ip         TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  until_at   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  hits       INTEGER NOT NULL DEFAULT 0,
  strikes    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_ipblocks_until ON ip_blocks (until_at);

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id      INTEGER NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc   TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER NOT NULL DEFAULT 0,
  backup_codes TEXT,
  last_step    INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_beds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bed_id        TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'rt' CHECK (kind IN ('rt', 'plot')),
  pid           TEXT NOT NULL,
  crop_id       TEXT NOT NULL,
  tier          INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,               -- server clock when the planting first reached the server
  ready_at      INTEGER NOT NULL DEFAULT 0,     -- server-computed; the only judge of "ready"
  growth        INTEGER NOT NULL DEFAULT 0,     -- percent (quick plots)
  care          INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'growing' CHECK (status IN ('growing', 'ready', 'harvested', 'cleared')),
  harvested_at  INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,
  stars         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_beds_planting ON farm_beds (user_id, bed_id, pid);
CREATE INDEX IF NOT EXISTS ix_beds_status ON farm_beds (status, ready_at);
CREATE INDEX IF NOT EXISTS ix_beds_user ON farm_beds (user_id, updated_at);
CREATE INDEX IF NOT EXISTS ix_beds_pid ON farm_beds (user_id, pid);

CREATE TABLE IF NOT EXISTS farm_storage (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS crop_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'rt' CHECK (kind IN ('rt', 'plot')),
  bed_id       TEXT NOT NULL,
  pid          TEXT NOT NULL,
  crop_id      TEXT NOT NULL,
  stars        INTEGER NOT NULL DEFAULT 0,
  amount       INTEGER NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT '',
  photo        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  memo         TEXT,
  requested_at INTEGER NOT NULL,
  decided_at   INTEGER NOT NULL DEFAULT 0,
  decided_by   INTEGER,
  seen_at      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reports_planting ON crop_reports (user_id, kind, bed_id, pid);
CREATE INDEX IF NOT EXISTS ix_reports_status ON crop_reports (status, requested_at);
CREATE INDEX IF NOT EXISTS ix_reports_user ON crop_reports (user_id, requested_at);

CREATE TABLE IF NOT EXISTS ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    INTEGER NOT NULL,
  user_id       INTEGER,
  scope         TEXT NOT NULL DEFAULT 'kid',
  model         TEXT NOT NULL DEFAULT '',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  stop_reason   TEXT NOT NULL DEFAULT '',
  ok            INTEGER NOT NULL DEFAULT 1,
  ms            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ai_created ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ix_ai_user ON ai_usage (user_id, created_at);

CREATE TABLE IF NOT EXISTS handover_items (
  k          TEXT NOT NULL PRIMARY KEY,
  done       INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  actor_id   INTEGER,
  source     TEXT NOT NULL DEFAULT 'admin',
  status     TEXT NOT NULL DEFAULT 'ok',
  ok_count   INTEGER NOT NULL DEFAULT 0,
  warn_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  summary    TEXT,
  result     TEXT
);
CREATE INDEX IF NOT EXISTS ix_inspect_created ON inspection_runs (created_at);
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (6, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'phase 7: real-time farm, storage, completion reports, settings, security events, ip blocks, admin totp, ai usage, handover, inspections');

-- v7 (phase 8, CONTRACT §16.7): allotment (분양) of 10,000 jars / plots / stores — zones, units, customers, contracts,
-- payments, waiting list, notices (the in-app inbox), care logs, daily statistics, the consent texts a customer agreed
-- to, automation job history (job_runs) and the key-value table of the optional database cache driver (cache_kv, §16.9).
-- No foreign key to users (a deleted account must never erase a contract). live_unit_id = unit_id while a contract is
-- pending / active / overdue, NULL afterwards (the nullable UNIQUE index refuses a second live contract on a unit).
-- Personal data is sealed by lib/Crypto.php; phone_hash is a keyed blind index. The units are rows made by
-- `php cli/tfm.php allot:seed`. Zone / unit codes and contract numbers are stored in upper case.
CREATE TABLE IF NOT EXISTS allot_zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'jar' CHECK (kind IN ('jar', 'plot', 'store')),
  name        TEXT NOT NULL DEFAULT '',
  capacity    INTEGER NOT NULL DEFAULT 0,
  cols        INTEGER NOT NULL DEFAULT 40,
  sort        INTEGER NOT NULL DEFAULT 0,
  price       INTEGER NOT NULL DEFAULT 0,               -- KRW per period (operator setting; seeded values are examples)
  period      TEXT NOT NULL DEFAULT 'year' CHECK (period IN ('once', 'month', 'year')),
  term_months INTEGER NOT NULL DEFAULT 12,              -- length of one contract term (0 = open-ended, month / year only)
  is_open     INTEGER NOT NULL DEFAULT 0,               -- applications accepted
  note        TEXT NOT NULL DEFAULT '',
  ver         INTEGER NOT NULL DEFAULT 1,               -- + 1 on every status change of one of its units (the map version)
  map_ver     INTEGER NOT NULL DEFAULT 0,               -- the ver map_s was built for
  map_s       TEXT,                                     -- cached status string: one character per unit, by seq
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_azones_code ON allot_zones (code);
CREATE INDEX IF NOT EXISTS ix_azones_sort ON allot_zones (sort, id);

CREATE TABLE IF NOT EXISTS allot_units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'jar' CHECK (kind IN ('jar', 'plot', 'store')),
  code        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'leased', 'closed')),
  contract_id INTEGER,                                  -- the live contract (pending / active / overdue), else NULL
  hold_until  INTEGER NOT NULL DEFAULT 0,               -- 0 = a hold without an expiry
  label       TEXT NOT NULL DEFAULT '',                 -- nameplate (cleaned, masked, ≤ 12 characters)
  label_show  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aunits_code ON allot_units (code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aunits_seq ON allot_units (zone_id, seq);
CREATE INDEX IF NOT EXISTS ix_aunits_kind ON allot_units (kind, status, id);
CREATE INDEX IF NOT EXISTS ix_aunits_zone ON allot_units (zone_id, status, id);
CREATE INDEX IF NOT EXISTS ix_aunits_free ON allot_units (zone_id, status, seq);
CREATE INDEX IF NOT EXISTS ix_aunits_hold ON allot_units (status, hold_until);

CREATE TABLE IF NOT EXISTS allot_customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,                                  -- the app account; NULL for customers the operator entered / imported
  name_enc    TEXT NOT NULL DEFAULT '',                 -- sealed
  phone_enc   TEXT NOT NULL DEFAULT '',                 -- sealed (digits only)
  phone_hash  TEXT NOT NULL DEFAULT '',                 -- keyed blind index of the digits
  phone_tail  TEXT NOT NULL DEFAULT '',                 -- last 4 digits (masked lists)
  name_hash   TEXT NOT NULL DEFAULT '',                 -- keyed blind index of the name (exact look-up)
  addr_enc    TEXT,                                     -- sealed
  memo        TEXT,                                     -- sealed (the operator's note about the customer)
  consent_at  INTEGER NOT NULL DEFAULT 0,
  consent_ver TEXT NOT NULL DEFAULT '',
  guardian    INTEGER NOT NULL DEFAULT 0,
  purged_at   INTEGER NOT NULL DEFAULT 0,               -- personal data erased by the retention job
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_acust_user ON allot_customers (user_id);
CREATE INDEX IF NOT EXISTS ix_acust_phone ON allot_customers (phone_hash);
CREATE INDEX IF NOT EXISTS ix_acust_name ON allot_customers (name_hash);
CREATE INDEX IF NOT EXISTS ix_acust_purged ON allot_customers (purged_at, id);

CREATE TABLE IF NOT EXISTS allot_contracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no   TEXT NOT NULL,
  unit_id       INTEGER NOT NULL,
  live_unit_id  INTEGER,
  customer_id   INTEGER NOT NULL,
  user_id       INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'overdue', 'ended', 'canceled')),
  period        TEXT NOT NULL DEFAULT 'year' CHECK (period IN ('once', 'month', 'year')),
  price         INTEGER NOT NULL DEFAULT 0,
  term_months   INTEGER NOT NULL DEFAULT 12,
  starts_at     INTEGER NOT NULL DEFAULT 0,
  ends_at       INTEGER NOT NULL DEFAULT 0,             -- 0 = open-ended
  paid_until    INTEGER NOT NULL DEFAULT 0,             -- paid up to this moment (= starts_at while nothing is paid; 0 while pending)
  paid_total    INTEGER NOT NULL DEFAULT 0,
  auto_renew    INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'admin', 'import')),
  memo          TEXT,                                   -- the operator's working note (never shown to the customer)
  created_by    INTEGER,
  decided_by    INTEGER,
  decided_at    INTEGER NOT NULL DEFAULT 0,
  cancel_req_at INTEGER NOT NULL DEFAULT 0,             -- the customer asked to end an active contract
  due_stage     INTEGER NOT NULL DEFAULT 999,           -- smallest notice_days stage already sent for the current paid_until
  end_stage     INTEGER NOT NULL DEFAULT 999,           -- the same for the current ends_at
  ended_at      INTEGER NOT NULL DEFAULT 0,
  end_reason    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_acon_no ON allot_contracts (contract_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_acon_live ON allot_contracts (live_unit_id);
CREATE INDEX IF NOT EXISTS ix_acon_unit ON allot_contracts (unit_id, id);
CREATE INDEX IF NOT EXISTS ix_acon_customer ON allot_contracts (customer_id, id);
CREATE INDEX IF NOT EXISTS ix_acon_user ON allot_contracts (user_id, status);
CREATE INDEX IF NOT EXISTS ix_acon_due ON allot_contracts (status, paid_until);
CREATE INDEX IF NOT EXISTS ix_acon_ends ON allot_contracts (status, ends_at);

CREATE TABLE IF NOT EXISTS allot_payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     INTEGER NOT NULL,
  customer_id     INTEGER NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('first', 'renewal', 'manual', 'refund')),
  method          TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('toss', 'bank', 'cash', 'cms', 'etc')),
  amount          INTEGER NOT NULL DEFAULT 0,           -- KRW, always positive (a refund is kind = 'refund')
  periods         INTEGER NOT NULL DEFAULT 0,           -- how many periods this payment covers
  order_id        TEXT,                                 -- 토스 order id (random); NULL for manual payments
  payment_key_enc TEXT NOT NULL DEFAULT '',             -- sealed 토스 paymentKey
  claim           TEXT NOT NULL DEFAULT '',             -- keyed hash of the paymentKey that claimed the confirmation
  claimed_at      INTEGER NOT NULL DEFAULT 0,
  idem            TEXT,                                 -- idempotency key of a manual payment
  status          TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'canceled', 'refunded')),
  toss_status     TEXT NOT NULL DEFAULT '',
  paid_at         INTEGER NOT NULL DEFAULT 0,
  period_from     INTEGER NOT NULL DEFAULT 0,
  period_to       INTEGER NOT NULL DEFAULT 0,
  memo            TEXT NOT NULL DEFAULT '',
  created_by      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_apay_order ON allot_payments (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_apay_idem ON allot_payments (idem);
CREATE INDEX IF NOT EXISTS ix_apay_contract ON allot_payments (contract_id, id);
CREATE INDEX IF NOT EXISTS ix_apay_status ON allot_payments (status, created_at);

CREATE TABLE IF NOT EXISTS allot_waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'jar' CHECK (kind IN ('jar', 'plot', 'store')),
  zone_id     INTEGER NOT NULL DEFAULT 0,               -- 0 = any zone of the kind
  customer_id INTEGER NOT NULL,
  user_id     INTEGER,
  live_key    TEXT,                                     -- "<customer>:<kind>:<zone>" while waiting / offered, else NULL
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'converted', 'expired', 'canceled')),
  unit_id     INTEGER,
  offer_until INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_await_live ON allot_waitlist (live_key);
CREATE INDEX IF NOT EXISTS ix_await_queue ON allot_waitlist (kind, zone_id, status, id);
CREATE INDEX IF NOT EXISTS ix_await_user ON allot_waitlist (user_id, id);
CREATE INDEX IF NOT EXISTS ix_await_offer ON allot_waitlist (status, offer_until);

CREATE TABLE IF NOT EXISTS allot_notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER,
  customer_id INTEGER,
  user_id     INTEGER,                                  -- NULL: a customer without an app account (the operator calls)
  kind        TEXT NOT NULL DEFAULT 'info',
  dedupe_key  TEXT,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'seen', 'canceled')),
  send_at     INTEGER NOT NULL DEFAULT 0,
  sent_at     INTEGER NOT NULL DEFAULT 0,
  seen_at     INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_anot_dedupe ON allot_notices (dedupe_key);
CREATE INDEX IF NOT EXISTS ix_anot_user ON allot_notices (user_id, id);
CREATE INDEX IF NOT EXISTS ix_anot_queue ON allot_notices (status, send_at);
CREATE INDEX IF NOT EXISTS ix_anot_contract ON allot_notices (contract_id, id);

CREATE TABLE IF NOT EXISTS allot_care_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id    INTEGER NOT NULL DEFAULT 0,                -- 0 with unit_id 0 = every zone
  unit_id    INTEGER NOT NULL DEFAULT 0,                -- 0 = the whole zone
  kind       TEXT NOT NULL DEFAULT 'care',
  text       TEXT NOT NULL DEFAULT '',
  visible    INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_acare_unit ON allot_care_logs (unit_id, id);
CREATE INDEX IF NOT EXISTS ix_acare_zone ON allot_care_logs (zone_id, unit_id, id);

CREATE TABLE IF NOT EXISTS allot_stats_daily (
  day        TEXT NOT NULL,                             -- YYYY-MM-DD (server time zone)
  zone_id    INTEGER NOT NULL DEFAULT 0,                -- 0 = all zones
  n_open     INTEGER NOT NULL DEFAULT 0,
  n_held     INTEGER NOT NULL DEFAULT 0,
  n_leased   INTEGER NOT NULL DEFAULT 0,
  n_closed   INTEGER NOT NULL DEFAULT 0,
  n_pending  INTEGER NOT NULL DEFAULT 0,
  n_active   INTEGER NOT NULL DEFAULT 0,
  n_overdue  INTEGER NOT NULL DEFAULT 0,
  n_ended    INTEGER NOT NULL DEFAULT 0,
  revenue    INTEGER NOT NULL DEFAULT 0,                -- payments of that day minus refunds (KRW)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, zone_id)
);

CREATE TABLE IF NOT EXISTS allot_terms (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ver          TEXT NOT NULL,                           -- the consent version customers agreed to (allot_customers.consent_ver)
  privacy_text TEXT,
  terms_text   TEXT,
  refund_text  TEXT,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aterms_ver ON allot_terms (ver);

CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('cli', 'lazy', 'admin')),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 0,
  summary     TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_job ON job_runs (job, id);

CREATE TABLE IF NOT EXISTS cache_kv (
  k          TEXT NOT NULL PRIMARY KEY,
  v          TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_cache_expires ON cache_kv (expires_at);
INSERT OR IGNORE INTO schema_version (version, applied_at, note) VALUES (7, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'phase 8: allotment (zones, units, customers, contracts, payments, waiting list, notices, care logs, daily statistics, consent texts), job runs, cache table');
