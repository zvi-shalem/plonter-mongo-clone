<?php
/**
 * auth_email.php — email/username login endpoint for the Plonter clone (MongoDB-backed).
 *
 * This file never existed in the clone (it only lived on the live server), so the SPA's
 * POST /plonter/api/auth_email.php calls 404'd. This is the Mongo port of that endpoint,
 * matching the exact request/response contract the SPA expects (clone/js/auth_widget.js):
 *
 *   action=login    body {email,password}                  -> {ok:true, token:<64hex>, user:{...}}
 *                                                             | {ok:false, error, need_verify?, email?}
 *   action=register body {first_name,last_name,email,password,phone}
 *                                                          -> {ok:true, token:<64hex>, user:{...}}
 *   action=ping                                            -> {ok:true, pong:true, ...}
 *
 * `user` shape (read by the SPA): {id, first_name, last_name, email, phone, role, is_admin}.
 *
 * Auth model (consistent with admin_api.php + auth_common.php):
 *   - Passwords are bcrypt hashes (password_hash/PASSWORD_DEFAULT) in users.password.
 *     AuthStore deliberately strips `password` on hydrate, so we read the raw doc once
 *     here to verify; everything else (session create) goes through AuthStore.
 *   - A 64-hex session token is stored in the `sessions` collection (TTL-indexed).
 *     getUserFromToken()/findUserBySessionToken() in the other APIs resolve it -> uid.
 *
 * Require paths match the other api/*.php files.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/MongoStore.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// Dragon role = admin. Both the current (🐉) and legacy (🐲) glyphs count.
const DRAGON_CURRENT = "\xF0\x9F\x90\x89 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F"; // 🐉 דרקון
const DRAGON_LEGACY  = "\xF0\x9F\x90\xB2 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F"; // 🐲 דרקון

const SESSION_TTL_SECONDS = 31536000; // 365 days

function ae_respond(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function ae_is_admin(string $role): bool
{
    return $role === DRAGON_CURRENT || $role === DRAGON_LEGACY;
}

/** Build the SPA `user` object from a raw users doc. */
function ae_user_obj(array $doc): array
{
    $role = (string)($doc['role'] ?? '');
    return [
        'id'         => (string)($doc['_id'] ?? ''),
        'first_name' => (string)($doc['first_name'] ?? ''),
        'last_name'  => (string)($doc['last_name'] ?? ''),
        'email'      => (string)($doc['email'] ?? ''),
        'phone'      => (string)($doc['phone'] ?? ''),
        'role'       => $role,
        'is_admin'   => ae_is_admin($role),
    ];
}

/** Issue a fresh session token for a user id and return the 64-hex token. */
function ae_issue_session(string $userId): string
{
    $token = bin2hex(random_bytes(32)); // 64 hex chars
    AuthStore::createSession($userId, $token, time() + SESSION_TTL_SECONDS);
    return $token;
}

$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? $input['action'] ?? '';

$usersCol = MongoStore::getInstance()->getCollection('users');

if ($action === 'ping') {
    ae_respond(['ok' => true, 'pong' => true, 'message' => 'auth_email alive', 'time' => date('Y-m-d H:i:s')]);
}

if ($action === 'login') {
    $email = trim(strtolower((string)($input['email'] ?? '')));
    $pass  = (string)($input['password'] ?? '');
    if ($email === '' || $pass === '') {
        ae_respond(['ok' => false, 'error' => 'נדרשים מייל וסיסמה']);
    }

    $doc = $usersCol->findOne(['email' => $email]);
    // 'משתמש לא נמצא' is the exact string the widget keys on for its quick-login retry.
    if (!$doc) {
        ae_respond(['ok' => false, 'error' => 'משתמש לא נמצא']);
    }

    $hash = (string)($doc['password'] ?? $doc['password_hash'] ?? '');
    if ($hash === '' || !password_verify($pass, $hash)) {
        ae_respond(['ok' => false, 'error' => 'סיסמה שגויה']);
    }

    // verified gate: only block when an explicit verified flag is present and falsy.
    if (array_key_exists('verified', (array)$doc) && !((int)$doc['verified'])) {
        ae_respond(['ok' => false, 'need_verify' => true, 'email' => $email, 'error' => 'נדרש אימות מייל']);
    }

    $token = ae_issue_session((string)$doc['_id']);
    ae_respond(['ok' => true, 'token' => $token, 'user' => ae_user_obj((array)$doc)]);
}

if ($action === 'register') {
    $first = trim((string)($input['first_name'] ?? ''));
    $last  = trim((string)($input['last_name'] ?? ''));
    $email = trim(strtolower((string)($input['email'] ?? '')));
    $pass  = (string)($input['password'] ?? '');
    $phone = trim((string)($input['phone'] ?? ''));

    if ($first === '') ae_respond(['ok' => false, 'error' => 'שם פרטי חובה']);
    if ($email === '') ae_respond(['ok' => false, 'error' => 'מייל חובה']);
    if ($pass === '' || strlen($pass) < 4) ae_respond(['ok' => false, 'error' => 'סיסמה קצרה מדי (לפחות 4 תווים)']);

    if ($usersCol->findOne(['email' => $email])) {
        ae_respond(['ok' => false, 'error' => 'מייל כבר קיים במערכת']);
    }

    // Self-serve registration creates a regular (non-dragon), verified user and logs in
    // immediately — matching the SPA's no-email quick-register flow ({ok,token,user}).
    $newId = AuthStore::createFullUser($first, $last, $email, password_hash($pass, PASSWORD_DEFAULT), '', true);
    if ($phone !== '') {
        $usersCol->updateOne(['_id' => new MongoDB\BSON\ObjectId($newId)], ['$set' => ['phone' => $phone]]);
    }
    $doc = $usersCol->findOne(['_id' => new MongoDB\BSON\ObjectId($newId)]);
    $token = ae_issue_session($newId);
    ae_respond(['ok' => true, 'token' => $token, 'user' => ae_user_obj((array)$doc)]);
}

ae_respond(['ok' => false, 'error' => 'פעולה לא מוכרת: ' . $action]);
