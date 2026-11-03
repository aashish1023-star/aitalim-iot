<?php
// ============================================================
// API: /api/admin.php
// ============================================================
// DELETE ?action=delete_device&device_id=xxx — Delete a device
// POST   ?action=reset_db                   — Reset entire database
// ============================================================

require_once __DIR__ . '/../db.php';

// All admin actions require authentication
requireAuth();

$db     = getDB();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Parse JSON input to determine action if not passed in query
if ($method === 'POST') {
    $input = getJsonInput();
    if (isset($input['action']) && $input['action'] === 'reset_database') {
        $action = 'reset_db';
    }
}

// ── GET: Read global settings ──
if ($method === 'GET' && $action === 'get_settings') {
    $configPath = __DIR__ . '/../iot_config.json';
    $cfg = json_decode(file_get_contents($configPath), true) ?: [];
    jsonResponse([
        'notification_email' => $cfg['NOTIFICATION_EMAIL'] ?? '',
        'wifi_ssid' => $cfg['WIFI_SSID'] ?? '',
        'wifi_pass' => $cfg['WIFI_PASS'] ?? ''
    ]);
}

// ── POST: Update global settings ──
if ($method === 'POST' && $action === 'update_settings') {
    $configPath = __DIR__ . '/../iot_config.json';
    $cfg = json_decode(file_get_contents($configPath), true) ?: [];
    
    if (isset($input['notification_email'])) {
        $cfg['NOTIFICATION_EMAIL'] = trim($input['notification_email']);
    }
    if (isset($input['wifi_ssid'])) {
        $cfg['WIFI_SSID'] = trim($input['wifi_ssid']);
    }
    if (isset($input['wifi_pass'])) {
        $cfg['WIFI_PASS'] = trim($input['wifi_pass']);
    }
    
    file_put_contents($configPath, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    jsonResponse(['status' => 'ok']);
}

// ── DELETE: Remove a device and its data table ──
if ($method === 'DELETE' && $action === 'delete_device') {
    $deviceId = sanitizeDeviceId($_GET['device_id'] ?? '');
    if (empty($deviceId)) {
        jsonError('Missing device_id');
    }

    // Verify device exists
    $stmt = $db->prepare('SELECT device_id FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);
    if (!$stmt->fetch()) {
        jsonError('Device not found: ' . $deviceId, 404);
    }

    // Drop the per-device data table
    $safe = sanitizeDeviceId($deviceId);
    $db->exec("DROP TABLE IF EXISTS `data_{$safe}`");

    // Delete from devices table
    $stmt = $db->prepare('DELETE FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);

    jsonResponse(['status' => 'ok', 'message' => "Device '{$deviceId}' deleted"]);
}

// ── POST: Reset entire database ──
if ($method === 'POST' && $action === 'reset_db') {
    // Drop all data_* tables
    $tables = $db->query("SHOW TABLES LIKE 'data_%'")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $table) {
        $db->exec("DROP TABLE IF EXISTS `{$table}`");
    }

    // Drop devices table to force schema re-init
    $db->exec("DROP TABLE IF EXISTS devices");

    jsonResponse(['status' => 'ok', 'message' => 'Nuclear reset complete. The system will re-initialize a clean database on next access.']);
}


jsonError('Invalid action or method', 400);
