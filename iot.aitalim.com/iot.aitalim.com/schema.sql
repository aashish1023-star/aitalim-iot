-- ============================================================
-- IoT Farm — Database Schema
-- ============================================================
-- Database: aitalimc_iot
-- Run: mysql -u aitalimc_admin -p aitalimc_iot < schema.sql
-- Or import via phpMyAdmin on cPanel
-- NOTE: db.php auto-creates this table on first run.
--       This file exists as a reference / manual fallback.
-- ============================================================

CREATE TABLE IF NOT EXISTS devices (
    device_id   VARCHAR(64) PRIMARY KEY,
    device_type VARCHAR(64) NOT NULL,
    name        VARCHAR(128) NOT NULL,
    location    VARCHAR(128),
    config      JSON DEFAULT ('{}'),
    last_seen   DATETIME NULL,
    ip_address  VARCHAR(45) NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
