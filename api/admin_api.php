<?php
// Admin API — dragon-only user management for Plonter.  MongoDB-backed (Phase 5b).
// Data access goes through AuthStore (MongoDB) instead of raw SQLite3.
//
// CONTRACT NOTE (documented in MONGO_PORT_PROGRESS.md): SQLite integer PKs have
// no clean Mongo equivalent — user `id` is now a 24-hex ObjectId STRING instead
// of an integer. The frontend already treats id as an opaque token it passes
// back (update/delete/set_role), so the round-trip is preserved; only the id's
// JSON type changed (string vs int). Every other response key/shape is identical.
//
// Endpoints:
//   get_my_role      → returns the caller's role (any authenticated user)
//   list_users       → all users + id/email/names/role (dragon only)
//   update_user      → edit first_name / last_name / email (dragon only)
//   set_role         → assign a role (dragon only, can't demote/remove dragon)
//   delete_user      → permanent (dragon only, can't delete dragon)
//   create_user      → regular email user or simple username+password user; verified=1 (dragon only, can't create dragon)

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$DRAGON = "\xF0\x9F\x90\x89 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F"; // 🐉 דרקון
$LEGACY_DRAGON = "\xF0\x9F\x90\xB2 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F"; // 🐲 דרקון
$DRAGON_EMAIL = 'amitai.shalem@gmail.com';
$SIMPLE_USER_DOMAIN = 'plonter.local';
$VALID_ROLES = [
    "\xF0\x9F\x90\x89 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F",       // 🐉 דרקון
    "\xF0\x9F\x8E\xA7 DJ",                                               // 🎧 DJ
    "\xD7\x91\xD7\xA7\xD7\xA8\xD7\xAA \xD7\x90\xD7\x95\xD7\xA6\xD7\x9D", // בקרת אוצם
    "\xF0\x9F\xA7\xA0 \xD7\x9E\xD7\x91\xD7\x99\xD7\x9F \xD7\xA2\xD7\xA0\xD7\x99\xD7\x99\xD7\x9F", // 🧠 מבין עניין
    "\xF0\x9F\x9B\xA1\xEF\xB8\x8F \xD7\x90\xD7\x91\xD7\x99\xD7\xA8",   // 🛡️ אביר
    "\xF0\x9F\x8F\xB9 \xD7\x97\xD7\x99\xD7\x99\xD7\x9C",               // 🏹 חייל
    "\xF0\x9F\x91\xA4 \xD7\xA4\xD7\xA9\xD7\x95\xD7\x98 \xD7\xA2\xD7\x9D", // 👤 פשוט עם
];

function respond($ok, $data = null, $err = null) {
    $out = ['ok' => $ok];
    if ($data !== null) $out = array_merge($out, is_array($data) ? $data : ['data' => $data]);
    if ($err !== null) $out['error'] = $err;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

function isDragonRole($role) {
    global $DRAGON, $LEGACY_DRAGON;
    return $role === $DRAGON || $role === $LEGACY_DRAGON;
}

function normalizeSimpleUsername($username) {
    $username = trim((string)$username);
    $username = preg_replace('/\s+/', '_', $username);
    $username = preg_replace('/[^\p{L}\p{N}_.-]/u', '', $username);
    return strtolower(trim($username, '._-'));
}

function simpleUserEmail($username) {
    global $SIMPLE_USER_DOMAIN;
    return normalizeSimpleUsername($username) . '@' . $SIMPLE_USER_DOMAIN;
}

function getTokenFromRequest() {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true) ?: [];
    return $input['token'] ?? $_GET['token'] ?? '';
}

$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?: [];

$me = AuthStore::findUserBySessionToken(getTokenFromRequest());
if (!$me) respond(false, null, 'נדרשת התחברות');

// Any authenticated user can check their own role (needed by the client to
// decide whether to show the admin button at all).
if ($action === 'get_my_role') {
    respond(true, ['role' => $me['role'], 'email' => $me['email'], 'id' => $me['id']]);
}

// Everything else is dragon-only.
if (!isDragonRole($me['role'])) respond(false, null, 'גישה רק לדרקון');

if ($action === 'list_users') {
    global $SIMPLE_USER_DOMAIN;
    $users = [];
    $suffix = '@' . $SIMPLE_USER_DOMAIN;
    foreach (AuthStore::listFullUsers() as $row) {
        $email = (string)($row['email'] ?? '');
        if (substr($email, -strlen($suffix)) === $suffix) {
            $row['is_simple_user'] = 1;
            $row['username'] = substr($email, 0, -strlen($suffix));
        } else {
            $row['is_simple_user'] = 0;
            $row['username'] = '';
        }
        $users[] = $row;
    }
    respond(true, ['users' => $users, 'count' => count($users)]);
}

if ($action === 'update_user') {
    $id = (string)($input['id'] ?? '');
    if ($id === '') respond(false, null, 'חסר id');
    $fields = [];
    if (isset($input['first_name'])) { $fields['first_name'] = $input['first_name']; }
    if (isset($input['last_name']))  { $fields['last_name']  = $input['last_name']; }
    if (isset($input['email']))      { $fields['email']      = $input['email']; }
    if (!$fields) respond(false, null, 'אין שדות לעדכון');
    $changed = AuthStore::updateUserProfile($id, $fields);
    respond(true, ['updated' => $changed]);
}

if ($action === 'set_role') {
    global $VALID_ROLES, $DRAGON, $DRAGON_EMAIL;
    $id = (string)($input['id'] ?? '');
    $role = $input['role'] ?? '';
    if ($id === '' || !$role) respond(false, null, 'חסרים id/role');
    if (!in_array($role, $VALID_ROLES, true)) respond(false, null, 'תפקיד לא מוכר');
    $target = AuthStore::getUserById($id);
    // Can't promote anyone else to dragon (locked to amitai.shalem@gmail.com).
    if ($role === $DRAGON) {
        if (!$target || $target['email'] !== $DRAGON_EMAIL) respond(false, null, 'דרקון נעול לאמתי בלבד');
    }
    // Can't demote the dragon email off of dragon.
    if ($target && $target['email'] === $DRAGON_EMAIL && !isDragonRole($role)) {
        respond(false, null, 'לא ניתן להוריד את הדרקון');
    }
    $changed = AuthStore::setUserRole($id, $role);
    respond(true, ['updated' => $changed]);
}

if ($action === 'delete_user') {
    global $DRAGON_EMAIL;
    $id = (string)($input['id'] ?? '');
    if ($id === '') respond(false, null, 'חסר id');
    $row = AuthStore::getUserById($id);
    if (!$row) respond(false, null, 'משתמש לא נמצא');
    if ($row['email'] === $DRAGON_EMAIL) respond(false, null, 'לא ניתן למחוק את הדרקון');
    // Also nuke their sessions so a lingering token can't resurrect them.
    AuthStore::deleteSessionsForUser($id);
    $deleted = AuthStore::deleteUserById($id);
    respond(true, ['deleted' => $deleted]);
}

if ($action === 'roles') {
    global $VALID_ROLES;
    respond(true, ['roles' => $VALID_ROLES]);
}

if ($action === 'create_user') {
    global $VALID_ROLES, $DRAGON;
    $first = trim($input['first_name'] ?? '');
    $last  = trim($input['last_name']  ?? '');
    $email = trim(strtolower($input['email'] ?? ''));
    $pass  = (string)($input['password'] ?? '');
    $role  = $input['role'] ?? '';
    $simple = !empty($input['simple_user']);
    $username = normalizeSimpleUsername($input['username'] ?? $first);

    if ($simple) {
        if (!$username) respond(false, null, 'שם משתמש חובה');
        if (strlen($username) < 2) respond(false, null, 'שם משתמש קצר מדי');
        $first = $username;
        $last = '';
        $email = simpleUserEmail($username);
    } else {
        if (!$first) respond(false, null, 'שם פרטי חובה');
        if (!$email) respond(false, null, 'מייל חובה');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(false, null, 'מייל לא תקין');
    }
    if (!$pass)  respond(false, null, 'סיסמה חובה');
    if (strlen($pass) < 4) respond(false, null, 'סיסמה קצרה מדי (לפחות 4 תווים)');
    if ($role && !in_array($role, $VALID_ROLES, true)) respond(false, null, 'תפקיד לא מוכר');
    if (isDragonRole($role)) respond(false, null, 'אי אפשר ליצור דרקון נוסף');

    if (AuthStore::findUserByEmail($email)) respond(false, null, 'מייל כבר קיים במערכת');

    $newId = AuthStore::createFullUser($first, $last, $email, password_hash($pass, PASSWORD_DEFAULT), $role, true);
    respond(true, ['id' => $newId, 'email' => $email, 'username' => $simple ? $username : '', 'is_simple_user' => $simple ? 1 : 0, 'first_name' => $first, 'last_name' => $last, 'role' => $role, 'verified' => 1]);
}

respond(false, null, 'action לא מוכר: ' . $action);
