<?php
// ============================================================
// API: /api/auth.php
// ============================================================
// POST   — Login  (username + password)
// GET    — Check  (is user logged in?)
// DELETE — Logout (destroy session)
// ============================================================

require_once __DIR__ . '/../db.php';

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: Check auth status ──
if ($method === 'GET') {
    jsonResponse([
        'logged_in' => isLoggedIn(),
        'role'      => isLoggedIn() ? 'admin' : null
    ]);
}

// ── POST: Login ──
if ($method === 'POST') {
    $data = getJsonInput();
    $username = $data['username'] ?? '';
    $password = $data['password'] ?? '';

    if (empty($username) || empty($password)) {
        jsonError('Username and password are required');
    }

    if ($username === ADMIN_USER && $password === ADMIN_PASS) {
        $_SESSION['logged_in'] = true;
        $_SESSION['role'] = 'admin';
        jsonResponse(['status' => 'ok', 'message' => 'Login successful']);
    }

    jsonError('Invalid username or password', 401);
}

// ── DELETE: Logout ──
if ($method === 'DELETE') {
    session_destroy();
    jsonResponse(['status' => 'ok', 'message' => 'Logged out']);
}

jsonError('Method not allowed', 405);
