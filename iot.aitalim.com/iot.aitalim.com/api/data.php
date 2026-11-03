<?php
// ============================================================
// API: /data/{device_id}  (rewritten from /api/data.php)
// ============================================================
// POST — ESP32 pushes sensor data (JSON) → stored in per-device table
// GET  — Dashboard reads data (?limit=N, ?start=YYYY-MM-DD, ?end=YYYY-MM-DD)
// ============================================================

require_once __DIR__ . '/../db.php';

$deviceId = sanitizeDeviceId($_GET['device_id'] ?? '');
if (empty($deviceId)) {
    jsonError('Missing device_id');
}

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// ── POST: ESP32 sends sensor data ──
if ($method === 'POST') {
    $data = getJsonInput();
    if (empty($data)) {
        jsonError('Empty data payload');
    }

    // Verify device exists and get type/config (auto-register if missing)
    $stmt = $db->prepare('SELECT device_id, device_type, config FROM devices WHERE device_id = ?');
    $stmt->execute([$deviceId]);
    $device = $stmt->fetch();
    if (!$device) {
        $defaultCfg = json_encode(['temp_limit' => 30.0, 'hum_limit' => 40.0, 'pump' => 'auto']);
        $stmtIns = $db->prepare('INSERT INTO devices (device_id, device_type, name, location, config, config_reported) VALUES (?, ?, ?, ?, ?, ?)');
        $stmtIns->execute([$deviceId, 'moss_water_tank', $deviceId, 'Auto-Registered', $defaultCfg, $defaultCfg]);
        $device = [
            'device_id' => $deviceId,
            'device_type' => 'moss_water_tank',
            'config' => $defaultCfg
        ];
    }
    $deviceType = $device['device_type'];

    // Ensure data table exists
    ensureDeviceTable($deviceId);

    // Insert data row
    $safe = sanitizeDeviceId($deviceId);
    $stmt = $db->prepare("INSERT INTO `data_{$safe}` (data) VALUES (?)");
    $stmt->execute([json_encode($data)]);

    // Update last_seen
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $stmt = $db->prepare('UPDATE devices SET last_seen = NOW(), ip_address = ? WHERE device_id = ?');
    $stmt->execute([$ip, $deviceId]);

    // Check for Low Water Level email trigger (Moss Water Tank)
    if ($deviceType === 'moss_water_tank' && isset($data['water_level'])) {
        $waterLevel = (float)$data['water_level'];
        $cfgDecoded = json_decode($device['config'] ?? '{}', true) ?: [];
        $lowThreshold = isset($cfgDecoded['low_level']) ? (float)$cfgDecoded['low_level'] : 20.0;
        
        // If distance to water is greater than threshold, water is low
        if ($waterLevel >= $lowThreshold) {
            // Use database-based throttle (ESP32 doesn't carry PHP sessions)
            // Create notifications table if it doesn't exist
            $db->exec("CREATE TABLE IF NOT EXISTS `notifications` (
                id INT AUTO_INCREMENT PRIMARY KEY,
                device_id VARCHAR(64) NOT NULL,
                alert_type VARCHAR(64) NOT NULL,
                message TEXT,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_device_alert (device_id, alert_type, sent_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

            // Check last notification time for this device
            $chkStmt = $db->prepare(
                "SELECT sent_at FROM notifications WHERE device_id = ? AND alert_type = 'low_water' ORDER BY sent_at DESC LIMIT 1"
            );
            $chkStmt->execute([$deviceId]);
            $lastNotify = $chkStmt->fetchColumn();
            
            $shouldSend = true;
            if ($lastNotify) {
                $lastTime = strtotime($lastNotify);
                if (time() - $lastTime < 3600) { // 1 hour throttle
                    $shouldSend = false;
                }
            }
            
            if ($shouldSend) {
                $to = $cfg['NOTIFICATION_EMAIL'] ?? 'admin@swachhyabasti.com';
                $subject = "⚠️ ALERT: Low Water Level in Moss Tank [{$deviceId}]";
                $msgBody = "Dear Operator,\r\n\r\n" .
                           "Moss Water Tank device '{$deviceId}' has reported a low water level!\r\n" .
                           "Current Sensor Distance: {$waterLevel} cm (Threshold: {$lowThreshold} cm)\r\n" .
                           "Please check and refill the water tank.\r\n\r\n" .
                           "Regards,\r\n" .
                           "swachhyabasti IoT Platform";
                $headers = "From: no-reply@swachhyabasti.com\r\n" .
                           "Reply-To: no-reply@swachhyabasti.com\r\n" .
                           "X-Mailer: PHP/" . phpversion();
                $mailSent = @mail($to, $subject, $msgBody, $headers);
                
                // Log the notification attempt in database
                $logStmt = $db->prepare(
                    "INSERT INTO notifications (device_id, alert_type, message) VALUES (?, 'low_water', ?)"
                );
                $logMsg = "Water level alert sent to {$to}. Distance: {$waterLevel}cm, Threshold: {$lowThreshold}cm. Mail result: " . ($mailSent ? 'OK' : 'FAILED');
                $logStmt->execute([$deviceId, $logMsg]);
            }
        }
    }

    jsonResponse(['status' => 'ok', 'id' => (int)$db->lastInsertId()]);
}

// ── GET: Dashboard reads sensor data ──
if ($method === 'GET') {
    $perPage = min((int)($_GET['per_page'] ?? 50), 1000);
    $page = max((int)($_GET['page'] ?? 1), 1);
    $offset = ($page - 1) * $perPage;
    
    $safe = sanitizeDeviceId($deviceId);
    $startDate = $_GET['start'] ?? '';
    $endDate = $_GET['end'] ?? '';

    // Check if table exists
    $tables = $db->query("SHOW TABLES LIKE 'data_{$safe}'")->fetchAll();
    if (empty($tables)) {
        jsonResponse(['data' => [], 'meta' => ['total' => 0, 'page' => 1, 'per_page' => $perPage]]);
    }

    // Filters for both Count and Data queries
    $where = " WHERE 1=1";
    $params = [];
    if (!empty($startDate)) {
        $where .= " AND DATE(recorded_at) >= ?";
        $params[] = $startDate;
    }
    if (!empty($endDate)) {
        $where .= " AND DATE(recorded_at) <= ?";
        $params[] = $endDate;
    }

    // 1. Get Total Count for Pagination
    $countQuery = "SELECT COUNT(*) FROM `data_{$safe}`" . $where;
    $cntStmt = $db->prepare($countQuery);
    $cntStmt->execute($params);
    $total = (int)$cntStmt->fetchColumn();

    // 2. Get Paginated Data
    $query = "SELECT id, recorded_at, data FROM `data_{$safe}`" . $where;
    $query .= " ORDER BY recorded_at DESC LIMIT " . (int)$perPage . " OFFSET " . (int)$offset;

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Decode JSON data column safely
    foreach ($rows as &$row) {
        if (is_string($row['data'])) {
            $row['data'] = json_decode($row['data'], true) ?: [];
        }
    }

    jsonResponse([
        'data' => $rows,
        'meta' => [
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'last_page' => ceil($total / $perPage)
        ]
    ]);
}


jsonError('Method not allowed', 405);
