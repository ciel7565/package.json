-- =============================================================================
-- 전통발효체험관 메타버스 — MySQL 5.7+ / MariaDB 10.3+ schema
--
-- XAMPP: phpMyAdmin → 가져오기(Import) → 이 파일 선택 → 실행
--        (or: mysql -u root -p < database/schema.sql)
-- Then set 'db' => ['driver' => 'mysql', ...] in config/config.local.php.
-- With db.auto_migrate = true the tables are also created automatically once the
-- database exists (CREATE DATABASE / USE lines are skipped by the auto-installer).
-- All timestamps are server time in milliseconds (BIGINT).
-- Keep in sync with schema.sqlite.sql and Db::SCHEMA_VERSION.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS fermentation_metaverse
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE fermentation_metaverse;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INT NOT NULL PRIMARY KEY,
  applied_at  BIGINT NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip_hash     CHAR(32) NOT NULL,
  account_key CHAR(32) NOT NULL,
  success     TINYINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  KEY ix_login_ip (ip_hash, created_at),
  KEY ix_login_account (account_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     VARCHAR(190) NOT NULL PRIMARY KEY,
  hits       INT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  KEY ix_rate_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (1, UNIX_TIMESTAMP() * 1000, 'initial schema');

-- v2 (kid safety): chat_messages.text_key used to be built from the UNMASKED text, so phone numbers / e-mails that
-- were masked in `text` stayed readable there. Keys are now built from the masked text; older keys are cleared
-- (they only feed the 30-second repeat-spam check). Re-running this file later only touches rows older than v2.
UPDATE chat_messages SET text_key = '' WHERE text_key <> '' AND created_at < COALESCE((SELECT applied_at FROM schema_version WHERE version = 2), 9007199254740991);
INSERT IGNORE INTO schema_version (version, applied_at, note) VALUES (2, UNIX_TIMESTAMP() * 1000, 'chat text_key from masked text');
