<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

try {
    $db = getDB();
    echo "=== DATABASE CONNECTION SUCCESSFUL ===\n";
    
    echo "\n=== TABLES ===\n";
    $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $t) {
        echo "- $t\n";
    }
    
    echo "\n=== DEVICES ===\n";
    $devices = $db->query("SELECT device_id, device_type, name, last_seen FROM devices")->fetchAll();
    foreach ($devices as $d) {
        echo "ID: {$d['device_id']} | Type: {$d['device_type']} | Name: {$d['name']} | Last Seen: {$d['last_seen']}\n";
        
        // Show count of data rows
        $safe = sanitizeDeviceId($d['device_id']);
        try {
            $count = $db->query("SELECT COUNT(*) FROM `data_{$safe}`")->fetchColumn();
            echo "  -> Data rows: $count\n";
            if ($count > 0) {
                $latest = $db->query("SELECT recorded_at, data FROM `data_{$safe}` ORDER BY recorded_at DESC LIMIT 1")->fetch();
                echo "  -> Latest: {$latest['recorded_at']} | Data: {$latest['data']}\n";
            }
        } catch (Exception $e) {
            echo "  -> Error reading table data_{$safe}: " . $e->getMessage() . "\n";
        }
    }
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}
