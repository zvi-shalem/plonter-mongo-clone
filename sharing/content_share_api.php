<?php
/**
 * Content Share API — GENERIC sharing layer above ALL Plonter content types.
 * MongoDB-backed (Phase 5b). Writes the FULL content_shares schema
 * (content_id, content_type, owner_user_id, target_type, target_id, role, token,
 * created, expires_at, revoked_at) so the readers stay consistent:
 *   - content_org_api.php  open_share        (resolves a token → recipient row)
 *   - content_api.php      apiShareGrants    (view/edit permission checks)
 * Data access via ContentOrgStore (content_shares + content) + AuthStore (users).
 *
 * Contracts byte-identical EXCEPT ids are ObjectId strings (int→ObjectId decision).
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/ContentOrgStore.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

const SHARE_TTL_MAX_SECONDS = 7776000;            // 90 days hard cap
const EMAIL_SHARE_DEFAULT_TTL_SECONDS = 2592000;  // 30 days default for email invites
const ALLOWED_ROLES = ['practice', 'view', 'edit'];
const ALLOWED_TARGET_TYPES = ['link', 'user', 'group', 'email'];

function respond($success, $errorOrData = '', $data = []) {
    if ($success) {
        echo json_encode(array_merge(['success' => true], is_array($errorOrData) ? $errorOrData : $data), JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode(['success' => false, 'error' => is_string($errorOrData) ? $errorOrData : ''], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

function getToken() {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
    $raw = file_get_contents('php://input');
    $body = $raw ? (json_decode($raw, true) ?: []) : [];
    return $body['token'] ?? $_GET['token'] ?? '';
}

function getUserFromToken($token) {
    if (!$token) return null;
    $me = AuthStore::findUserBySessionToken((string)$token);
    return $me ? $me['id'] : null;
}

function requireAuth() {
    $uid = getUserFromToken(getToken());
    if (!$uid) respond(false, 'נדרשת התחברות');
    return $uid;
}

function readJsonBody() {
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?: []) : [];
}

function genToken() { return bin2hex(random_bytes(16)); }

function emailForUid($uid) {
    if (!$uid) return '';
    $u = AuthStore::getUserById((string)$uid);
    return $u ? strtolower(trim((string)($u['email'] ?? ''))) : '';
}

function currentCallerEmail() { return emailForUid(getUserFromToken(getToken())); }

/** Fetch a content row owned by $uid, or respond(false) and exit. */
function ownedContentRow($contentId, $uid) {
    $row = ContentOrgStore::apiGetAnyById((string)$contentId);
    if (!$row) respond(false, 'תוכן לא נמצא');
    if ((string)$row['user_id'] !== (string)$uid) respond(false, 'אין הרשאה לתוכן הזה');
    return $row;
}

function shareActive($row) {
    if (!empty($row['revoked_at'])) return false;
    if (!empty($row['expires_at']) && strtotime((string)$row['expires_at']) < time()) return false;
    return true;
}

// ---- create_share -----------------------------------------------------------
function action_create_share() {
    $uid  = requireAuth();
    $body = readJsonBody();

    $contentId = (string)($body['content_id'] ?? '');
    if ($contentId === '') respond(false, 'חסר content_id');

    $content = ownedContentRow($contentId, $uid);

    $targetType = (string)($body['target_type'] ?? 'link');
    if (!in_array($targetType, ALLOWED_TARGET_TYPES, true)) respond(false, 'target_type לא חוקי');

    $targetId = isset($body['target_id']) ? (string)$body['target_id'] : null;
    if ($targetType === 'link') {
        $targetId = null;
    } elseif ($targetType === 'email') {
        $targetId = strtolower(trim((string)$targetId));
        if ($targetId === '' || !filter_var($targetId, FILTER_VALIDATE_EMAIL)) {
            respond(false, 'כתובת אימייל לא תקינה');
        }
    } elseif ($targetId === null || $targetId === '') {
        respond(false, 'חסר target_id עבור שיתוף ממוקד');
    }

    $role = (string)($body['role'] ?? 'practice');
    if (!in_array($role, ALLOWED_ROLES, true)) respond(false, 'role לא חוקי');

    $expiresAt = null;
    if (isset($body['ttl_hours']) && $body['ttl_hours'] !== '' && $body['ttl_hours'] !== null) {
        $ttlSecs = (int)round(((float)$body['ttl_hours']) * 3600);
        if ($ttlSecs < 0) respond(false, 'ttl_hours לא חוקי');
        if ($ttlSecs > SHARE_TTL_MAX_SECONDS) respond(false, 'ttl_hours חורג מהמקסימום (90 ימים)');
        if ($ttlSecs > 0) $expiresAt = gmdate('Y-m-d H:i:s', time() + $ttlSecs);
    } elseif ($targetType === 'email') {
        $expiresAt = gmdate('Y-m-d H:i:s', time() + EMAIL_SHARE_DEFAULT_TTL_SECONDS);
    }

    $token = genToken();
    $id = ContentOrgStore::apiCreateContentShare(
        (string)$uid, $contentId, (string)$content['content_type'],
        $targetType, $targetId, $role, $token, $expiresAt
    );

    respond(true, [
        'id'           => $id,
        'token'        => $token,
        'url'          => '/plonter/clone/share.html?t=' . $token,
        'content_id'   => $contentId,
        'content_type' => $content['content_type'],
        'role'         => $role,
        'target_type'  => $targetType,
        'expires_at'   => $expiresAt,
    ]);
}

// ---- list_shares ------------------------------------------------------------
function action_list_shares() {
    $uid = requireAuth();
    $contentId = (string)($_GET['content_id'] ?? $_POST['content_id'] ?? '');
    if ($contentId === '') {
        $body = readJsonBody();
        $contentId = (string)($body['content_id'] ?? '');
    }
    if ($contentId === '') respond(false, 'חסר content_id');

    ownedContentRow($contentId, $uid);

    $out = [];
    foreach (ContentOrgStore::apiListContentSharesFull((string)$uid, $contentId) as $r) {
        $r['active'] = shareActive($r);
        $out[] = $r;
    }
    respond(true, ['shares' => $out, 'count' => count($out)]);
}

// ---- revoke_share -----------------------------------------------------------
function action_revoke_share() {
    $uid  = requireAuth();
    $body = readJsonBody();
    $id   = (string)($body['id'] ?? $_GET['id'] ?? '');
    if ($id === '') respond(false, 'חסר id');

    $changed = ContentOrgStore::apiRevokeContentShare((string)$uid, $id);
    if ($changed === 0) respond(false, 'שיתוף לא נמצא או לא בבעלותך');
    respond(true, ['revoked' => true, 'id' => $id]);
}

// ---- resolve_link -----------------------------------------------------------
function action_resolve_link() {
    $token = (string)($_GET['t'] ?? $_GET['token'] ?? $_POST['t'] ?? $_POST['token'] ?? '');
    if ($token === '') respond(false, 'חסר token');

    $share = ContentOrgStore::apiResolveShareByToken($token);
    if (!$share) respond(false, 'קישור לא קיים');
    if (!shareActive($share)) respond(false, 'הקישור בוטל או פג תוקף');

    if (($share['target_type'] ?? '') === 'email') {
        $invite = strtolower(trim((string)$share['target_id']));
        $callerEmail = currentCallerEmail();
        $metaRow = ContentOrgStore::apiGetAnyById((string)$share['content_id']);
        $meta = $metaRow ? ['content_type' => $metaRow['content_type'], 'title' => $metaRow['title']] : [];

        if ($callerEmail === '') {
            respond(true, [
                'valid'        => false,
                'need_login'   => true,
                'invite_email' => $invite,
                'content_type' => $meta['content_type'] ?? null,
                'title'        => $meta['title'] ?? null,
            ]);
        }
        if ($callerEmail !== $invite) {
            respond(true, [
                'valid'        => false,
                'mismatch'     => true,
                'invite_email' => $invite,
                'message'      => 'ההזמנה מיועדת ל-' . $invite . ', התחבר עם אותה כתובת',
            ]);
        }
    }

    $contentRow = ContentOrgStore::apiGetAnyById((string)$share['content_id']);
    if (!$contentRow) respond(false, 'התוכן המשותף אינו זמין');
    // Match the original SELECT: no user_id leaked.
    $content = [
        'id'           => $contentRow['id'],
        'content_type' => $contentRow['content_type'],
        'title'        => $contentRow['title'],
        'data'         => $contentRow['data'],
        'color'        => $contentRow['color'],
        'source_id'    => $contentRow['source_id'],
        'created'      => $contentRow['created'],
        'updated'      => $contentRow['updated'],
    ];

    respond(true, [
        'valid'      => true,
        'role'       => $share['role'],
        'content'    => $content,
        'expires_at' => $share['expires_at'],
    ]);
}

// ---- shared_with_me ---------------------------------------------------------
function action_shared_with_me() {
    $uid = requireAuth();
    $email = emailForUid($uid);
    $items = ContentOrgStore::apiSharedWithMe((string)$uid, $email);
    respond(true, ['items' => $items, 'count' => count($items)]);
}

// ---- email_has_account ------------------------------------------------------
function action_email_has_account() {
    requireAuth();
    $email = (string)($_GET['email'] ?? $_POST['email'] ?? '');
    if ($email === '') {
        $body  = readJsonBody();
        $email = (string)($body['email'] ?? '');
    }
    $email = strtolower(trim($email));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(false, 'כתובת אימייל לא תקינה');
    }
    $exists = AuthStore::findUserByEmail($email) !== null;
    respond(true, ['has_account' => $exists]);
}

// ===== Router =====
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'create_share':      action_create_share(); break;
    case 'list_shares':       action_list_shares(); break;
    case 'revoke_share':      action_revoke_share(); break;
    case 'resolve_link':      action_resolve_link(); break;
    case 'shared_with_me':    action_shared_with_me(); break;
    case 'email_has_account': action_email_has_account(); break;
    case 'ping':              respond(true, ['message' => 'content_share_api alive', 'time' => date('Y-m-d H:i:s')]); break;
    default:                  respond(false, 'פעולה לא מוכרת: ' . $action);
}
