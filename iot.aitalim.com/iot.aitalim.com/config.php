<?php
// ============================================================
// IoT Farm — Configuration
// ============================================================

// Session security
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
session_start();

// Set Nepal timezone (GMT+5:45)
date_default_timezone_set('Asia/Kathmandu');

// Load dynamic configuration
$configPath = __DIR__ . '/iot_config.json';
if (!file_exists($configPath)) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['error' => 'CRITICAL: Configuration file not found at ' . $configPath]);
    exit;
}
$cfg = json_decode(file_get_contents($configPath), true);
if (!$cfg) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['error' => 'CRITICAL: Invalid JSON in iot_config.json']);
    exit;
}

// System Constants
define('SERVER_URL', $cfg['SERVER_URL'] ?? 'http://localhost');
define('WIFI_SSID',  $cfg['WIFI_SSID']  ?? '');
define('WIFI_PASS',  $cfg['WIFI_PASS']  ?? '');


// Database Credentials
define('DB_HOST',   $cfg['DB_HOST']   ?? 'localhost');
define('DB_NAME',   $cfg['DB_NAME']   ?? 'iot_farm');
define('DB_USER',   $cfg['DB_USER']   ?? 'root');
define('DB_PASS',   $cfg['DB_PASS']   ?? '');

// Admin credentials
define('ADMIN_USER', $cfg['ADMIN_USER'] ?? 'admin');
define('ADMIN_PASS', $cfg['ADMIN_PASS'] ?? '@dmin#123');

// Global error handler for API
set_exception_handler(function($e) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    $msg = $e->getMessage();
    // Catch common "table not found" error to help user debug
    if ($e instanceof PDOException && strpos($msg, 'Base table or view not found') !== false) {
        $msg .= " — CRITICAL FIX: The database tables do not exist! You MUST import 'server/schema.sql' into your 'aitalimc_iot' database via phpMyAdmin.";
    }
    echo json_encode(['status' => 'error', 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
});

// Configure CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// --- Helpers ---
function jsonResponse($data, $code = 200) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError($msg, $code = 400) {
    jsonResponse(['error' => $msg], $code);
}

function getJsonInput() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Invalid JSON body');
    }
    return $data ?: [];
}

function sanitizeDeviceId($id) {
    return preg_replace('/[^a-zA-Z0-9_]/', '', $id);
}

// --- Auth Helpers ---
function isLoggedIn() {
    return isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true;
}

function requireAuth() {
    if (!isLoggedIn()) {
        jsonError('Authentication required', 401);
    }
}
