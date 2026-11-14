-- =============================================================================
-- 전통발효체험관 메타버스 — MySQL 5.7+ / MariaDB 10.3+ schema (nothing newer than MariaDB 10.3:
-- no RETURNING, no JSON functions; utf8mb4_unicode_ci; indexed VARCHAR ≤ 191; ROW_FORMAT=DYNAMIC)
--
-- XAMPP / phpMyAdmin: 새 데이터베이스 fermentation_metaverse (utf8mb4_unicode_ci) 를 만들고 선택한 뒤
--        가져오기(Import) → 이 파일 선택 → 실행.   (or: mysql -u root -p fermentation_metaverse < database/schema.sql)
--        install.php 를 쓰면 이 과정이 자동이에요 (데이터베이스 생성 + 이 파일 적용 + 첫 관리자).
-- Then set 'db' => ['driver' => 'mysql', ...] in config/config.local.php (install.php writes it).
-- With db.auto_migrate = true the tables are also created / upgraded automatically once the database exists
-- (CREATE DATABASE / USE lines are skipped by the auto-installer). Re-running this file is safe (IF NOT EXISTS).
-- All timestamps are server time in milliseconds (BIGINT).
-- Keep in sync with schema.sqlite.sql and Db::SCHEMA_VERSION (currently 7).
-- =============================================================================

-- 데이터베이스를 아직 만들지 않았다면 아래 두 줄의 주석(--)을 풀고 서버 전체(데이터베이스 선택 없이)에서 가져오세요:
-- CREATE DATABASE IF NOT EXISTS fermentation_metaverse DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci;
-- USE fermentation_metaverse;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INT NOT NULL PRIMARY KEY,
  applied_at  BIGINT NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email               VARCHAR(190) NOT NULL,
  nickname            VARCHAR(40) NOT NULL,
  nickname_key        VARCHAR(40) NOT NULL,
  password_hash       VARCHAR(255) NOT NULL,
  role                ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  status              ENUM('active', 'banned') NOT NULL DEFAULT 'active',
  muted_until         BIGINT NOT NULL DEFAULT 0,
  session_epoch       INT NOT NULL DEFAULT 0,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL,
  last_login_at       BIGINT NOT NULL DEFAULT 0,
  last_login_ip       VARCHAR(64) NOT NULL DEFAULT '',
  password_changed_at BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY ux_users_email (email),
  UNIQUE KEY ux_users_nickname (nickname_key),
  KEY ix_users_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  level          INT NOT NULL DEFAULT 1,
  exp_total      BIGINT NOT NULL DEFAULT 0,
  coin           BIGINT NOT NULL DEFAULT 0,
  edu            INT NOT NULL DEFAULT 0,
  title          VARCHAR(60) NOT NULL DEFAULT '',
  avatar         TEXT,
  quests_claimed INT NOT NULL DEFAULT 0,
  achievements   INT NOT NULL DEFAULT 0,
  harvests       INT NOT NULL DEFAULT 0,
  ferments       INT NOT NULL DEFAULT 0,
  journals       INT NOT NULL DEFAULT 0,
  play_time      BIGINT NOT NULL DEFAULT 0,
  zone_id        VARCHAR(40) NOT NULL DEFAULT '',
  updated_at     BIGINT NOT NULL,
  KEY ix_profiles_rank (level, exp_total),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS player_saves (
  user_id         BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  version         INT NOT NULL DEFAULT 1,
  revision        INT NOT NULL DEFAULT 0,
  data            MEDIUMTEXT NOT NULL,
  checksum        VARCHAR(32) NOT NULL DEFAULT '',
  size_bytes      INT NOT NULL DEFAULT 0,
  meta            MEDIUMTEXT NOT NULL,
  backup_data     MEDIUMTEXT,
  backup_saved_at BIGINT NOT NULL DEFAULT 0,
  saved_at        BIGINT NOT NULL,
  created_at      BIGINT NOT NULL,
  rejects         INT NOT NULL DEFAULT 0,
  last_reject_at  BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_saves_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip_hash     CHAR(32) NOT NULL,
  account_key CHAR(32) NOT NULL,
  success     TINYINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  KEY ix_login_ip (ip_hash, created_at),
  KEY ix_login_account (account_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     VARCHAR(190) NOT NULL PRIMARY KEY,
  hits       INT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  KEY ix_rate_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  nickname   VARCHAR(40) NOT NULL,
  channel    ENUM('all', 'local', 'system') NOT NULL DEFAULT 'all',
  text       VARCHAR(600) NOT NULL,
  text_key   VARCHAR(600) NOT NULL DEFAULT '',
  x          DOUBLE NULL,
  z          DOUBLE NULL,
  hidden     TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  KEY ix_chat_created (created_at),
  KEY ix_chat_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS chat_reports (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reporter_id    BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  target_name    VARCHAR(40) NOT NULL,
  message_id     BIGINT UNSIGNED NULL,
  message_text   VARCHAR(600) NOT NULL DEFAULT '',
  reason         VARCHAR(20) NOT NULL,
  memo           VARCHAR(800) NOT NULL DEFAULT '',
  status         ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at     BIGINT NOT NULL,
  resolved_at    BIGINT NOT NULL DEFAULT 0,
  resolved_by    BIGINT UNSIGNED NULL,
  KEY ix_reports_status (status, created_at),
  KEY ix_reports_reporter (reporter_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS presence (
  user_id    BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  nickname   VARCHAR(40) NOT NULL,
  x          DOUBLE NOT NULL DEFAULT 0,
  y          DOUBLE NOT NULL DEFAULT 0,
  z          DOUBLE NOT NULL DEFAULT 0,
  rot_y      DOUBLE NOT NULL DEFAULT 0,
  anim       VARCHAR(20) NULL,
  speed      DOUBLE NOT NULL DEFAULT 0,
  zone_id    VARCHAR(40) NULL,
  emote      VARCHAR(40) NULL,
  emote_at   BIGINT NOT NULL DEFAULT 0,
  appearance TEXT NULL,
  updated_at BIGINT NOT NULL,
  KEY ix_presence_updated (updated_at),
  CONSTRAINT fk_presence_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS journal_uploads (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  path       VARCHAR(255) NOT NULL,
  mime       VARCHAR(40) NOT NULL,
  size_bytes INT NOT NULL,
  width      INT NOT NULL,
  height     INT NOT NULL,
  sha256     CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  KEY ix_uploads_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  user_id    BIGINT UNSIGNED NULL,
  actor_id   BIGINT UNSIGNED NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  event      VARCHAR(60) NOT NULL,
  severity   ENUM('info', 'warn', 'alert') NOT NULL DEFAULT 'info',
  detail     TEXT NOT NULL,
  KEY ix_audit_created (created_at),
  KEY ix_audit_event (event, created_at),
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (1, UNIX_TIMESTAMP() * 1000, 'initial schema');

-- v2 (kid safety): chat_messages.text_key used to be built from the UNMASKED text, so phone numbers / e-mails that
-- were masked in `text` stayed readable there. Keys are now built from the masked text; older keys are cleared
-- (they only feed the 30-second repeat-spam check). Re-running this file later only touches rows older than v2.
UPDATE chat_messages SET text_key = '' WHERE text_key <> '' AND created_at < COALESCE((SELECT applied_at FROM schema_version WHERE version = 2), 9007199254740991);
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (2, UNIX_TIMESTAMP() * 1000, 'chat text_key from masked text');

-- v3 (moderation reaches players who are online): a hidden message or a banned sender is "taken back" from every
-- open game, not only filtered out of new chat/list.php results. Each row retracts one message (hide, 3 reports) or
-- every message of one account (ban); chat/list.php hands them out after the client's retraction cursor (rafter).
CREATE TABLE IF NOT EXISTS chat_retractions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NULL,
  user_id    BIGINT UNSIGNED NULL,
  upto_id    BIGINT UNSIGNED NULL,
  created_at BIGINT NOT NULL,
  KEY ix_retractions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
-- v3 also: a report without a message id used to keep the text the REPORTER typed as message_text, which admin.php
-- shows as the target's words; it moves into the memo, marked as unverified (MySQL assigns left to right: memo first)
UPDATE chat_reports SET memo = CONCAT('신고자가 적은 내용(확인 안 됨): “', message_text, '”', IF(memo <> '', CONCAT(' · ', memo), '')), message_text = '' WHERE message_id IS NULL AND message_text <> '';
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (3, UNIX_TIMESTAMP() * 1000, 'chat retractions');

-- v4 (phase 6, CONTRACT §14.6): progression-speed subscription tiers (2× · 3× · 4×) paid through 토스페이먼츠.
-- subscriptions = one row per account (the effective tier the server enforces), orders = every payment attempt
-- (first · renewal · manual grant), payment_events = webhook deliveries (idempotent per order/event/status).
-- All amounts are integer KRW. billing_key / customer_key never leave the server.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  tier          TINYINT NOT NULL DEFAULT 1,
  status        ENUM('none', 'active', 'past_due', 'canceled') NOT NULL DEFAULT 'none',
  started_at    BIGINT NOT NULL DEFAULT 0,
  expires_at    BIGINT NOT NULL DEFAULT 0,
  auto_renew    TINYINT NOT NULL DEFAULT 0,
  billing_key   VARCHAR(255) NOT NULL DEFAULT '',
  customer_key  VARCHAR(64) NOT NULL DEFAULT '',
  last_order_id VARCHAR(64) NOT NULL DEFAULT '',
  checked_at    BIGINT NOT NULL DEFAULT 0,
  updated_at    BIGINT NOT NULL,
  KEY ix_sub_status (status, expires_at),
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS orders (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id     VARCHAR(64) NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  tier         TINYINT NOT NULL,
  amount       INT NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'KRW',
  kind         ENUM('first', 'renewal', 'manual') NOT NULL DEFAULT 'first',
  status       ENUM('created', 'confirmed', 'failed', 'canceled', 'refunded') NOT NULL DEFAULT 'created',
  payment_key  VARCHAR(200) NOT NULL DEFAULT '',
  method       VARCHAR(40) NOT NULL DEFAULT '',
  receipt_url  VARCHAR(500) NOT NULL DEFAULT '',
  toss_status  VARCHAR(40) NOT NULL DEFAULT '',
  raw          MEDIUMTEXT,
  requested_at BIGINT NOT NULL,
  approved_at  BIGINT NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  UNIQUE KEY ux_orders_order (order_id),
  KEY ix_orders_user (user_id, created_at),
  KEY ix_orders_status (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS payment_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id   VARCHAR(64) NOT NULL,
  event      VARCHAR(60) NOT NULL,
  status     VARCHAR(40) NOT NULL DEFAULT '',
  payload    MEDIUMTEXT,
  created_at BIGINT NOT NULL,
  KEY ix_pevents_order (order_id, event, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (4, UNIX_TIMESTAMP() * 1000, 'subscriptions (speed tiers, 토스페이먼츠 orders, payment events)');

-- v5 (phase 6): a ban's retraction carries a watermark — the highest chat_messages.id at ban time (upto_id) — so a
-- game that polls only after a ban AND an unban takes back the old lines and keeps the ones posted after the unban.
-- New installs get the column from CREATE TABLE above; an existing table gets it here. MySQL has no
-- "ADD COLUMN IF NOT EXISTS", so the ALTER runs only when information_schema does not list the column yet
-- (safe to re-run: phpMyAdmin import, mysql < schema.sql, and the automatic upgrade all take this path).
SET @tfm_has_upto = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_retractions' AND COLUMN_NAME = 'upto_id');
SET @tfm_sql = IF(@tfm_has_upto = 0, 'ALTER TABLE chat_retractions ADD COLUMN upto_id BIGINT UNSIGNED NULL AFTER user_id', 'DO 0');
PREPARE tfm_stmt FROM @tfm_sql;
EXECUTE tfm_stmt;
DEALLOCATE PREPARE tfm_stmt;
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (5, UNIX_TIMESTAMP() * 1000, 'chat retraction watermark (upto_id)');

-- v6 (phase 7, CONTRACT §15.8): real-time farm records measured by the server clock (farm_beds), storage mirror
-- (farm_storage), completion confirmations with the admin's memo (crop_reports), operator settings (settings),
-- suspicious-activity log and IP blocks (security_events, ip_blocks), admin 2-step sign-in (admin_totp),
-- Claude API usage (ai_usage), developer handover checklist and inspection history (handover_items, inspection_runs).
-- Secrets inside rows (admin_totp.secret_enc, subscriptions.billing_key) are sealed by lib/Crypto.php ("enc:v1:").
CREATE TABLE IF NOT EXISTS settings (
  k          VARCHAR(64) NOT NULL PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS security_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  ip_hash    VARCHAR(32) NOT NULL DEFAULT '',
  user_id    BIGINT UNSIGNED NULL,
  kind       VARCHAR(40) NOT NULL,
  severity   ENUM('info', 'warn', 'alert') NOT NULL DEFAULT 'warn',
  path       VARCHAR(190) NOT NULL DEFAULT '',
  detail     TEXT NOT NULL,
  KEY ix_secev_created (created_at),
  KEY ix_secev_ip (ip_hash, created_at),
  KEY ix_secev_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS ip_blocks (
  ip_hash    VARCHAR(32) NOT NULL PRIMARY KEY,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  reason     VARCHAR(120) NOT NULL DEFAULT '',
  until_at   BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  hits       INT NOT NULL DEFAULT 0,
  strikes    INT NOT NULL DEFAULT 1,
  KEY ix_ipblocks_until (until_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  secret_enc   VARCHAR(255) NOT NULL DEFAULT '',
  enabled      TINYINT NOT NULL DEFAULT 0,
  confirmed_at BIGINT NOT NULL DEFAULT 0,
  backup_codes TEXT NULL,
  last_step    BIGINT NOT NULL DEFAULT 0,
  updated_at   BIGINT NOT NULL,
  CONSTRAINT fk_totp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS farm_beds (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  bed_id        VARCHAR(16) NOT NULL,
  kind          ENUM('rt', 'plot') NOT NULL DEFAULT 'rt',
  pid           VARCHAR(32) NOT NULL,
  crop_id       VARCHAR(40) NOT NULL,
  tier          TINYINT NOT NULL DEFAULT 1,
  first_seen_at BIGINT NOT NULL,
  ready_at      BIGINT NOT NULL DEFAULT 0,
  growth        INT NOT NULL DEFAULT 0,
  care          INT NOT NULL DEFAULT 0,
  status        ENUM('growing', 'ready', 'harvested', 'cleared') NOT NULL DEFAULT 'growing',
  harvested_at  BIGINT NOT NULL DEFAULT 0,
  amount        INT NOT NULL DEFAULT 0,
  stars         TINYINT NOT NULL DEFAULT 0,
  updated_at    BIGINT NOT NULL,
  UNIQUE KEY ux_beds_planting (user_id, bed_id, pid),
  KEY ix_beds_status (status, ready_at),
  KEY ix_beds_user (user_id, updated_at),
  KEY ix_beds_pid (user_id, pid),
  CONSTRAINT fk_beds_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS farm_storage (
  user_id    BIGINT UNSIGNED NOT NULL,
  item_id    VARCHAR(40) NOT NULL,
  qty        INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT fk_storage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS crop_reports (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         ENUM('rt', 'plot') NOT NULL DEFAULT 'rt',
  bed_id       VARCHAR(16) NOT NULL,
  pid          VARCHAR(32) NOT NULL,
  crop_id      VARCHAR(40) NOT NULL,
  stars        TINYINT NOT NULL DEFAULT 0,
  amount       INT NOT NULL DEFAULT 0,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  photo        VARCHAR(190) NOT NULL DEFAULT '',
  status       ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  memo         TEXT NULL,
  requested_at BIGINT NOT NULL,
  decided_at   BIGINT NOT NULL DEFAULT 0,
  decided_by   BIGINT UNSIGNED NULL,
  seen_at      BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY ux_reports_planting (user_id, kind, bed_id, pid),
  KEY ix_reports_status (status, requested_at),
  KEY ix_reports_user (user_id, requested_at),
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS ai_usage (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at    BIGINT NOT NULL,
  user_id       BIGINT UNSIGNED NULL,
  scope         VARCHAR(20) NOT NULL DEFAULT 'kid',
  model         VARCHAR(60) NOT NULL DEFAULT '',
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  stop_reason   VARCHAR(30) NOT NULL DEFAULT '',
  ok            TINYINT NOT NULL DEFAULT 1,
  ms            INT NOT NULL DEFAULT 0,
  KEY ix_ai_created (created_at),
  KEY ix_ai_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS handover_items (
  k          VARCHAR(64) NOT NULL PRIMARY KEY,
  done       TINYINT NOT NULL DEFAULT 0,
  note       TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS inspection_runs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  actor_id   BIGINT UNSIGNED NULL,
  source     VARCHAR(10) NOT NULL DEFAULT 'admin',
  status     VARCHAR(10) NOT NULL DEFAULT 'ok',
  ok_count   INT NOT NULL DEFAULT 0,
  warn_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  summary    TEXT NULL,
  result     MEDIUMTEXT NULL,
  KEY ix_inspect_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (6, UNIX_TIMESTAMP() * 1000, 'phase 7: real-time farm, storage, completion reports, settings, security events, ip blocks, admin totp, ai usage, handover, inspections');

-- v7 (phase 8, CONTRACT §16.7): allotment (분양) of 10,000 jars / plots / stores — zones, units, customers, contracts,
-- payments, waiting list, notices (the in-app inbox), care logs, daily statistics, the consent texts a customer agreed
-- to, automation job history (job_runs) and the key-value table of the optional database cache driver (cache_kv, §16.9).
-- * No foreign key to users: a deleted account must never erase a contract or a payment record.
-- * allot_contracts.live_unit_id = unit_id while a contract is pending / active / overdue and NULL afterwards: the
--   nullable UNIQUE key is the last line against two live contracts on one unit (SQLSTATE 23000 → 409 UNIT_TAKEN).
-- * Personal data (allot_customers.name_enc / phone_enc / addr_enc / memo, allot_payments.payment_key_enc) is sealed by
--   lib/Crypto.php ("enc:v1:"); phone_hash is a keyed blind index for look-ups, phone_tail the last 4 digits for lists.
-- * The units themselves are rows made by `php cli/tfm.php allot:seed`, never by this file.
-- * Zone / unit codes and contract numbers are stored in upper case (this collation ignores case, SQLite does not).
CREATE TABLE IF NOT EXISTS allot_zones (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(16) NOT NULL,
  kind        ENUM('jar', 'plot', 'store') NOT NULL DEFAULT 'jar',
  name        VARCHAR(60) NOT NULL DEFAULT '',
  capacity    INT NOT NULL DEFAULT 0,
  cols        INT NOT NULL DEFAULT 40,
  sort        INT NOT NULL DEFAULT 0,
  price       INT NOT NULL DEFAULT 0,
  period      ENUM('once', 'month', 'year') NOT NULL DEFAULT 'year',
  term_months INT NOT NULL DEFAULT 12,
  is_open     TINYINT NOT NULL DEFAULT 0,
  note        VARCHAR(200) NOT NULL DEFAULT '',
  ver         INT NOT NULL DEFAULT 1,
  map_ver     INT NOT NULL DEFAULT 0,
  map_s       MEDIUMTEXT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE KEY ux_azones_code (code),
  KEY ix_azones_sort (sort, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_units (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zone_id     BIGINT UNSIGNED NOT NULL,
  kind        ENUM('jar', 'plot', 'store') NOT NULL DEFAULT 'jar',
  code        VARCHAR(24) NOT NULL,
  seq         INT NOT NULL,
  status      ENUM('open', 'held', 'leased', 'closed') NOT NULL DEFAULT 'open',
  contract_id BIGINT UNSIGNED NULL,
  hold_until  BIGINT NOT NULL DEFAULT 0,
  label       VARCHAR(40) NOT NULL DEFAULT '',
  label_show  TINYINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE KEY ux_aunits_code (code),
  UNIQUE KEY ux_aunits_seq (zone_id, seq),
  KEY ix_aunits_kind (kind, status, id),
  KEY ix_aunits_zone (zone_id, status, id),
  KEY ix_aunits_free (zone_id, status, seq),
  KEY ix_aunits_hold (status, hold_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_customers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NULL,
  name_enc    VARCHAR(255) NOT NULL DEFAULT '',
  phone_enc   VARCHAR(255) NOT NULL DEFAULT '',
  phone_hash  VARCHAR(32) NOT NULL DEFAULT '',
  phone_tail  VARCHAR(4) NOT NULL DEFAULT '',
  addr_enc    TEXT NULL,
  memo        TEXT NULL,
  consent_at  BIGINT NOT NULL DEFAULT 0,
  consent_ver VARCHAR(40) NOT NULL DEFAULT '',
  guardian    TINYINT NOT NULL DEFAULT 0,
  purged_at   BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE KEY ux_acust_user (user_id),
  KEY ix_acust_phone (phone_hash),
  KEY ix_acust_purged (purged_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_contracts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_no   VARCHAR(24) NOT NULL,
  unit_id       BIGINT UNSIGNED NOT NULL,
  live_unit_id  BIGINT UNSIGNED NULL,
  customer_id   BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NULL,
  status        ENUM('pending', 'active', 'overdue', 'ended', 'canceled') NOT NULL DEFAULT 'pending',
  period        ENUM('once', 'month', 'year') NOT NULL DEFAULT 'year',
  price         INT NOT NULL DEFAULT 0,
  term_months   INT NOT NULL DEFAULT 12,
  starts_at     BIGINT NOT NULL DEFAULT 0,
  ends_at       BIGINT NOT NULL DEFAULT 0,
  paid_until    BIGINT NOT NULL DEFAULT 0,
  paid_total    BIGINT NOT NULL DEFAULT 0,
  auto_renew    TINYINT NOT NULL DEFAULT 0,
  source        ENUM('app', 'admin', 'import') NOT NULL DEFAULT 'app',
  memo          TEXT NULL,
  created_by    BIGINT UNSIGNED NULL,
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    BIGINT NOT NULL DEFAULT 0,
  cancel_req_at BIGINT NOT NULL DEFAULT 0,
  ended_at      BIGINT NOT NULL DEFAULT 0,
  end_reason    VARCHAR(40) NOT NULL DEFAULT '',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  UNIQUE KEY ux_acon_no (contract_no),
  UNIQUE KEY ux_acon_live (live_unit_id),
  KEY ix_acon_unit (unit_id, id),
  KEY ix_acon_customer (customer_id, id),
  KEY ix_acon_user (user_id, status),
  KEY ix_acon_due (status, paid_until),
  KEY ix_acon_ends (status, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_id     BIGINT UNSIGNED NOT NULL,
  customer_id     BIGINT UNSIGNED NOT NULL,
  kind            ENUM('first', 'renewal', 'manual', 'refund') NOT NULL DEFAULT 'manual',
  method          ENUM('toss', 'bank', 'cash', 'cms', 'etc') NOT NULL DEFAULT 'bank',
  amount          INT NOT NULL DEFAULT 0,
  periods         INT NOT NULL DEFAULT 0,
  order_id        VARCHAR(64) NULL,
  payment_key_enc VARCHAR(500) NOT NULL DEFAULT '',
  claim           VARCHAR(64) NOT NULL DEFAULT '',
  claimed_at      BIGINT NOT NULL DEFAULT 0,
  idem            VARCHAR(64) NULL,
  status          ENUM('created', 'paid', 'failed', 'canceled', 'refunded') NOT NULL DEFAULT 'created',
  toss_status     VARCHAR(40) NOT NULL DEFAULT '',
  paid_at         BIGINT NOT NULL DEFAULT 0,
  period_from     BIGINT NOT NULL DEFAULT 0,
  period_to       BIGINT NOT NULL DEFAULT 0,
  memo            VARCHAR(200) NOT NULL DEFAULT '',
  created_by      BIGINT UNSIGNED NULL,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE KEY ux_apay_order (order_id),
  UNIQUE KEY ux_apay_idem (idem),
  KEY ix_apay_contract (contract_id, id),
  KEY ix_apay_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_waitlist (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind        ENUM('jar', 'plot', 'store') NOT NULL DEFAULT 'jar',
  zone_id     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  customer_id BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  live_key    VARCHAR(64) NULL,
  status      ENUM('waiting', 'offered', 'converted', 'expired', 'canceled') NOT NULL DEFAULT 'waiting',
  unit_id     BIGINT UNSIGNED NULL,
  offer_until BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE KEY ux_await_live (live_key),
  KEY ix_await_queue (kind, zone_id, status, id),
  KEY ix_await_user (user_id, id),
  KEY ix_await_offer (status, offer_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_notices (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  user_id     BIGINT UNSIGNED NULL,
  kind        VARCHAR(24) NOT NULL DEFAULT 'info',
  dedupe_key  VARCHAR(80) NULL,
  title       VARCHAR(80) NOT NULL DEFAULT '',
  body        VARCHAR(400) NOT NULL DEFAULT '',
  status      ENUM('queued', 'sent', 'seen', 'canceled') NOT NULL DEFAULT 'queued',
  send_at     BIGINT NOT NULL DEFAULT 0,
  sent_at     BIGINT NOT NULL DEFAULT 0,
  seen_at     BIGINT NOT NULL DEFAULT 0,
  created_by  BIGINT UNSIGNED NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE KEY ux_anot_dedupe (dedupe_key),
  KEY ix_anot_user (user_id, id),
  KEY ix_anot_queue (status, send_at),
  KEY ix_anot_contract (contract_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_care_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zone_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  unit_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  kind       VARCHAR(24) NOT NULL DEFAULT 'care',
  text       VARCHAR(400) NOT NULL DEFAULT '',
  visible    TINYINT NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at BIGINT NOT NULL,
  KEY ix_acare_unit (unit_id, id),
  KEY ix_acare_zone (zone_id, unit_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_stats_daily (
  day        CHAR(10) NOT NULL,
  zone_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  n_open     INT NOT NULL DEFAULT 0,
  n_held     INT NOT NULL DEFAULT 0,
  n_leased   INT NOT NULL DEFAULT 0,
  n_closed   INT NOT NULL DEFAULT 0,
  n_pending  INT NOT NULL DEFAULT 0,
  n_active   INT NOT NULL DEFAULT 0,
  n_overdue  INT NOT NULL DEFAULT 0,
  n_ended    INT NOT NULL DEFAULT 0,
  revenue    BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (day, zone_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS allot_terms (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ver          VARCHAR(40) NOT NULL,
  privacy_text MEDIUMTEXT NULL,
  terms_text   MEDIUMTEXT NULL,
  refund_text  MEDIUMTEXT NULL,
  created_at   BIGINT NOT NULL,
  UNIQUE KEY ux_aterms_ver (ver)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job         VARCHAR(40) NOT NULL,
  source      ENUM('cli', 'lazy', 'admin') NOT NULL DEFAULT 'cli',
  started_at  BIGINT NOT NULL,
  finished_at BIGINT NOT NULL DEFAULT 0,
  ok          TINYINT NOT NULL DEFAULT 0,
  summary     TEXT NULL,
  KEY ix_jobs_job (job, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS cache_kv (
  k          VARCHAR(191) NOT NULL PRIMARY KEY,
  v          MEDIUMTEXT NULL,
  expires_at BIGINT NOT NULL DEFAULT 0,
  KEY ix_cache_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (7, UNIX_TIMESTAMP() * 1000, 'phase 8: allotment (zones, units, customers, contracts, payments, waiting list, notices, care logs, daily statistics, consent texts), job runs, cache table');
