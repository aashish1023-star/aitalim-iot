<?php
// ============================================================
// API: /config/{device_id}  (rewritten from /api/device-config.php)
// ============================================================
// GET  — ESP32 polls its config (control signals)
// POST — Dashboard updates config (light on/off, desired_temp, etc)
// ============================================================

require_once __DIR__ . '/../db.php';

$deviceId = sanitizeDeviceId($_GET['device_id'] ?? '');
if (empty($deviceId)) {
    jsonError('Missing device_id');
}

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// ── GET: ESP32 or Dashboard reads config ──
if ($method === 'GET') {
    $stmt = $db->prepare('SELECT config, config_reported, config_version, config_updated_at, device_type FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonError('Device not found: ' . $deviceId, 404);
    }

    $desired = json_decode($row['config'] ?? '{}', true) ?: [];
    $reported = json_decode($row['config_reported'] ?? '{}', true) ?: [];

    // Update last_seen
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $stmt = $db->prepare('UPDATE devices SET last_seen = NOW(), ip_address = ? WHERE device_id = ?');
    $stmt->execute([$ip, $deviceId]);

    jsonResponse([
        'desired' => $desired,
        'reported' => $reported,
        'version' => $row['config_version'],
        'updated_at' => $row['config_updated_at']
    ]);
}

// ── POST: Dashboard or Device updates config ──
if ($method === 'POST') {
    $data = getJsonInput();
    if (empty($data)) {
        jsonError('Empty config payload');
    }

    $isDevice = ($_GET['role'] ?? '') === 'device';

    // Verify device exists
    $stmt = $db->prepare('SELECT config, config_reported, config_version FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonError('Device not found: ' . $deviceId, 404);
    }

    if ($isDevice) {
        // ── Case A: Device Acknowledgment (Updates Reported State) ──
        $existing = json_decode($row['config_reported'] ?? '{}', true) ?: [];
        $merged = array_merge($existing, $data);
        $stmt = $db->prepare('UPDATE devices SET config_reported = ? WHERE device_id = ?');
        $stmt->execute([json_encode($merged), $deviceId]);
        jsonResponse(['status' => 'ok', 'role' => 'device', 'reported' => $merged]);
    } else {
        // ── Case B: Dashboard Update (Updates Desired State) ──
        $existing = json_decode($row['config'] ?? '{}', true) ?: [];
        $merged = array_merge($existing, $data);
        $stmt = $db->prepare('UPDATE devices SET config = ?, config_version = config_version + 1, config_updated_at = NOW() WHERE device_id = ?');
        $stmt->execute([json_encode($merged), $deviceId]);
        jsonResponse(['status' => 'ok', 'role' => 'user', 'desired' => $merged, 'version' => $row['config_version'] + 1]);
    }
}


jsonError('Method not allowed', 405);
