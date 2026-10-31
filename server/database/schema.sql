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
-- Keep in sync with schema.sqlite.sql and Db::SCHEMA_VERSION (currently 4).
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
