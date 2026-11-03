<?php
// ============================================================
// API: /api/devices.php
// ============================================================
// GET    — List all devices (optionally filter by device_id)
// POST   — Register a new device (Admin only)
// DELETE — Remove a device and its data table (Admin only)
// ============================================================

require_once __DIR__ . '/../db.php';

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// Default configurations for each device type
$defaultConfigs = [
    'air_quality' => [
        'send_interval' => 2,
        'led' => 'off'
    ],
    'gps_tracker' => [
        'send_interval' => 5,
        'sim_check_interval' => 15
    ],
    'moss_water_tank' => [
        'send_interval' => 5,
        'pump' => 'auto',
        'temp_limit' => 30,
        'low_level' => 20,
        'full_level' => 5
    ]
];

// ── GET: List devices ──
if ($method === 'GET') {
    $deviceId = $_GET['device_id'] ?? null;

    if ($deviceId) {
        $stmt = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $stmt->execute([$deviceId]);
    } else {
        $stmt = $db->query('SELECT * FROM devices ORDER BY created_at DESC');
    }

    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['config'] = json_decode($row['config'] ?? '{}', true);
        $row['config_reported'] = json_decode($row['config_reported'] ?? '{}', true);
    }
    jsonResponse($rows);
}

// ── POST: Register new device ──
if ($method === 'POST') {
    requireAuth();

    $data = getJsonInput();

    $required = ['device_id', 'name'];
    foreach ($required as $field) {
        if (empty($data[$field])) {
            jsonError("Missing required field: {$field}");
        }
    }

    $deviceId   = sanitizeDeviceId($data['device_id']);
    $deviceType = !empty($data['device_type']) ? $data['device_type'] : 'air_quality';
    $name       = $data['name'];
    $location   = $data['location'] ?? '';

    if (empty($deviceId)) {
        jsonError('Invalid device_id (alphanumeric and underscore only)');
    }

    // Check duplicate
    $stmt = $db->prepare('SELECT device_id FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);
    if ($stmt->fetch()) {
        jsonError('Device ID already exists: ' . $deviceId);
    }

    $config = $defaultConfigs[$deviceType] ?? [];
    if ($deviceType === 'gps_tracker') {
        $config['vehicle_category'] = !empty($data['vehicle_category']) ? $data['vehicle_category'] : '4-wheeler';
        $config['vehicle_type'] = !empty($data['vehicle_type']) ? $data['vehicle_type'] : 'car';
        $config['fuel_type'] = !empty($data['fuel_type']) ? $data['fuel_type'] : 'petrol';
        $config['service_date'] = !empty($data['service_date']) ? $data['service_date'] : '';
        $config['service_mileage'] = !empty($data['service_mileage']) ? (int)$data['service_mileage'] : 0;
    } elseif ($deviceType === 'moss_water_tank') {
        $config['temp_limit'] = !empty($data['temp_limit']) ? (float)$data['temp_limit'] : 30.0;
        $config['hum_limit'] = !empty($data['hum_limit']) ? (float)$data['hum_limit'] : 40.0;
        $config['low_level'] = !empty($data['low_level']) ? (int)$data['low_level'] : 20;
        $config['full_level'] = !empty($data['full_level']) ? (int)$data['full_level'] : 5;
    }

    // Insert device
    $stmt = $db->prepare(
        'INSERT INTO devices (device_id, device_type, name, location, config, config_reported) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$deviceId, $deviceType, $name, $location, json_encode($config), json_encode($config)]);

    // Create data table for this device
    ensureDeviceTable($deviceId);

    jsonResponse([
        'status'    => 'ok',
        'device_id' => $deviceId,
        'config'    => $config,
        'message'   => 'Device registered successfully'
    ], 201);
}

// ── DELETE: Remove a device ──
if ($method === 'DELETE') {
    requireAuth();

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

    // Drop data table
    $safe = sanitizeDeviceId($deviceId);
    try {
        $db->exec("DROP TABLE IF EXISTS `data_{$safe}`");
    } catch (Exception $e) {
        // Ignore if table doesn't exist
    }

    // Delete device record
    $stmt = $db->prepare('DELETE FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);

    jsonResponse(['status' => 'ok', 'message' => 'Device deleted: ' . $deviceId]);
}

jsonError('Method not allowed', 405);
