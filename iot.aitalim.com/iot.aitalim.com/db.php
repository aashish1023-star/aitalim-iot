<?php
// ============================================================
// IoT Farm — Database Connection
// ============================================================

require_once __DIR__ . '/config.php';

function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);

            // Set session timezone to Nepal time (GMT+5:45)
            $pdo->exec("SET time_zone = '+05:45'");

            // Auto-initialize the schema if it doesn't exist
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS devices (
                    device_id VARCHAR(64) PRIMARY KEY,
                    device_type VARCHAR(64) NOT NULL,
                    name VARCHAR(128) NOT NULL,
                    location VARCHAR(128),
                    config JSON DEFAULT ('{}'),
                    config_reported JSON DEFAULT ('{}'),
                    config_version INT DEFAULT 1,
                    config_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    last_seen DATETIME NULL,
                    ip_address VARCHAR(45) NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");

            // Migration: Add config_reported if missing
            try {
                $pdo->query("SELECT config_reported FROM devices LIMIT 1");
            } catch (Exception $e) {
                $pdo->exec("ALTER TABLE devices ADD COLUMN config_reported JSON DEFAULT ('{}') AFTER config");
                $pdo->exec("ALTER TABLE devices ADD COLUMN config_version INT DEFAULT 1 AFTER config_reported");
                $pdo->exec("ALTER TABLE devices ADD COLUMN config_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER config_version");
            }


        } catch (PDOException $e) {
            jsonError('Database connection failed: ' . $e->getMessage(), 500);
        }
    }
    return $pdo;
}

// Create per-device data table if it doesn't exist
function ensureDeviceTable($deviceId) {
    $db = getDB();
    $safe = sanitizeDeviceId($deviceId);
    if (empty($safe)) return false;

    $db->exec("
        CREATE TABLE IF NOT EXISTS `data_{$safe}` (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            data        LONGTEXT NOT NULL,
            INDEX idx_time (recorded_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    return true;
}
