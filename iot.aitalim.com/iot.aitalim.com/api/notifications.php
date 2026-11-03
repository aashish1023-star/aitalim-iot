<?php
// ============================================================
// API: /api/notifications.php
// ============================================================
// GET — Dashboard reads notification history
// ============================================================

require_once __DIR__ . '/../db.php';

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Create notifications table if it doesn't exist
    $db->exec("CREATE TABLE IF NOT EXISTS `notifications` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(64) NOT NULL,
        alert_type VARCHAR(64) NOT NULL,
        message TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_alert (device_id, alert_type, sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $deviceId = sanitizeDeviceId($_GET['device_id'] ?? '');
    $limit = min((int)($_GET['limit'] ?? 20), 100);

    if (!empty($deviceId)) {
        $stmt = $db->prepare('SELECT * FROM notifications WHERE device_id = ? ORDER BY sent_at DESC LIMIT ' . (int)$limit);
        $stmt->execute([$deviceId]);
    } else {
        $stmt = $db->query('SELECT * FROM notifications ORDER BY sent_at DESC LIMIT ' . (int)$limit);
    }

    jsonResponse($stmt->fetchAll());
}

jsonError('Method not allowed', 405);
