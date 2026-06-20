<?php
/**
 * Content API — Plonter.  MongoDB-backed (Phase 5b).
 * Basic CRUD for user content (analyses, texts, lessons, vocabulary, engineering)
 * + additive collaborative-share read/write auth. Data access goes through
 * ContentOrgStore (MongoDB) instead of raw SQLite3; auth via AuthStore sessions.
 *
 * Response contracts are kept byte-identical EXCEPT content `id` is now an
 * ObjectId STRING (SQLite AUTOINCREMENT has no Mongo equivalent — documented in
 * MONGO_PORT_PROGRESS.md). The frontend treats id as opaque, so the round-trip
 * holds; ids are therefore handled as strings here (no intval()).
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/ContentOrgStore.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// --- Auth ---

function getUserFromToken($token) {
    if (!$token) return null;
    $me = AuthStore::findUserBySessionToken((string)$token);
    if (!$me) return null;
    // content_api uses $user['user_id'] (the session's user id).
    return [
        'user_id'    => $me['id'],
        'first_name' => $me['first_name'] ?? '',
        'last_name'  => $me['last_name'] ?? '',
        'email'      => $me['email'] ?? '',
        'role'       => $me['role'] ?? '',
    ];
}

function getTokenFromRequest() {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) {
        return substr($auth, 7);
    }
    $input = getInput();
    return $input['token'] ?? '';
}

function requireAuth() {
    $token = getTokenFromRequest();
    $user = getUserFromToken($token);
    if (!$user) {
        respond(false, 'נדרשת התחברות');
    }
    return $user;
}

// --- Helpers ---

function respond($success, $errorOrData = '', $data = []) {
    if ($success) {
        echo json_encode(array_merge(['success' => true], is_array($errorOrData) ? $errorOrData : $data), JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode(['success' => false, 'error' => is_string($errorOrData) ? $errorOrData : ''], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

function getInput() {
    static $cached = null;
    if ($cached !== null) return $cached;
    $raw = file_get_contents('php://input');
    $cached = json_decode($raw, true) ?: [];
    return $cached;
}

// --- Collaborative-share auth (additive) ---
// Generic across ALL content types: a non-owner may READ a shared item, and
// WRITE only with an ACTIVE edit-share. Owner behavior unchanged (owner check
// first; content_shares consulted only when the user is NOT the owner).

function userIsOwner($id, $userId) {
    return ContentOrgStore::userOwnsItem((string)$userId, (string)$id, 'content');
}

function userCanEditContent($id, $userId, $input, $userEmail = null) {
    if (userIsOwner($id, $userId)) return true;
    $shareToken = (string)($input['share_token'] ?? '');
    return ContentOrgStore::apiShareGrants((string)$id, true, $shareToken, (string)$userId, (string)($userEmail ?? ''));
}

function userCanViewContent($id, $userId, $input, $userEmail = null) {
    if (userIsOwner($id, $userId)) return true;
    $shareToken = (string)($input['share_token'] ?? '');
    return ContentOrgStore::apiShareGrants((string)$id, false, $shareToken, (string)$userId, (string)($userEmail ?? ''));
}

// --- Actions ---

function action_list() {
    $user = requireAuth();
    $input = getInput();
    $type = $input['content_type'] ?? '';
    $sid = $input['source_id'] ?? null;  // nullable filter
    $items = ContentOrgStore::apiListContent($user['user_id'], $type !== '' ? $type : null, $sid);
    respond(true, ['items' => $items, 'count' => count($items)]);
}

function action_get() {
    $user = requireAuth();
    $input = getInput();
    $gid = (string)($input['id'] ?? $_GET['id'] ?? '');
    if ($gid === '') respond(false, 'חסר מזהה פריט');

    // Owner path
    $owned = ContentOrgStore::apiGetOwned($user['user_id'], $gid);
    if ($owned !== null) {
        respond(true, ['item' => $owned]);
    }
    // Share-aware read: active share (view/edit) may load the item.
    if (userCanViewContent($gid, $user['user_id'], $input, $user['email'] ?? null)) {
        $row = ContentOrgStore::apiGetAnyById($gid);
        if ($row === null) respond(false, 'פריט לא נמצא');
        respond(true, ['item' => $row, 'shared' => true]);
    }
    respond(false, 'פריט לא נמצא');
}

function action_create() {
    $user = requireAuth();
    $input = getInput();

    $type = trim($input['content_type'] ?? '');
    $title = trim($input['title'] ?? '');
    $data = $input['data'] ?? [];
    $color = $input['color'] ?? '#0d9488';
    $sid = $input['source_id'] ?? null;

    if (!$title) respond(false, 'נדרשת כותרת');
    if (!$type) respond(false, 'נדרש סוג תוכן');

    $newId = ContentOrgStore::apiCreateContent($user['user_id'], $type, $title, $data, $color, $sid);
    respond(true, ['id' => $newId, 'message' => 'נוצר בהצלחה']);
}

function action_update() {
    $user = requireAuth();
    $input = getInput();
    $id = (string)($input['id'] ?? '');
    if ($id === '') respond(false, 'חסר מזהה פריט');

    // Ownership OR an active edit-share (additive collaborative edit).
    if (!userCanEditContent($id, $user['user_id'], $input, $user['email'] ?? null)) {
        respond(false, 'פריט לא נמצא או אין הרשאה');
    }

    $fields = [];
    if (isset($input['title']))             { $fields['title'] = trim($input['title']); }
    if (isset($input['data']))              { $fields['data'] = $input['data']; }
    if (isset($input['color']))             { $fields['color'] = $input['color']; }
    if (isset($input['content_type']))      { $fields['content_type'] = $input['content_type']; }
    if (array_key_exists('source_id', $input)) { $fields['source_id'] = $input['source_id']; }

    $changed = ContentOrgStore::apiUpdateContent($id, $fields);
    respond(true, ['updated' => $changed]);
}

function action_delete() {
    $user = requireAuth();
    $input = getInput();
    $id = (string)($input['id'] ?? '');
    if ($id === '') respond(false, 'חסר מזהה פריט');

    $deleted = ContentOrgStore::apiDeleteOwned($user['user_id'], $id);
    respond(true, ['deleted' => $deleted]);
}

function action_rename_source() {
    // Bulk rename source_id for all rows matching (user_id, content_type, old_source_id).
    $user = requireAuth();
    $input = getInput();
    $type = trim($input['content_type'] ?? '');
    $old = $input['old_source_id'] ?? '';
    $new = $input['new_source_id'] ?? '';
    if (!$type) respond(false, 'נדרש סוג תוכן');
    if ($old === '' || $new === '') respond(false, 'נדרשים old_source_id ו-new_source_id');

    $renamed = ContentOrgStore::apiRenameSource($user['user_id'], $type, (string)$old, (string)$new);
    respond(true, ['renamed' => $renamed]);
}

function action_stats() {
    $user = requireAuth();
    $stats = ContentOrgStore::apiStats($user['user_id']);
    respond(true, ['total' => $stats['total'], 'by_type' => $stats['by_type']]);
}

// --- Router ---

$action = $_GET['action'] ?? getInput()['action'] ?? '';

switch ($action) {
    case 'list': action_list(); break;
    case 'get': action_get(); break;
    case 'create': action_create(); break;
    case 'update': action_update(); break;
    case 'delete': action_delete(); break;
    case 'stats': action_stats(); break;
    case 'rename_source': action_rename_source(); break;
    case 'ping': respond(true, ['message' => 'Content API is alive', 'time' => date('Y-m-d H:i:s')]); break;
    default: respond(false, 'פעולה לא מוכרת: ' . $action);
}
