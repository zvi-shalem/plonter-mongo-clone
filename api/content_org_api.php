<?php
// content_org_api.php — Plonter content ORGANIZATION engine.  MongoDB-backed (Phase 5b, Option B).
//
// Data access goes through ContentOrgJunctionStore (MongoDB) instead of raw SQLite3.
// The store uses REAL junction collections (content_folders / content_org /
// content_tags / folder_shares / share_recipients) that mirror the original
// relational tables, so every action's behavior + response shape is BYTE-IDENTICAL
// to the SQLite version (store dimension, home/shortcut one-home rule, the
// deduped/moved/reparented_children/unfiled response keys, cross-store search,
// share open/detach). The embed-model ContentOrgStore is NOT used here.
//
// CONTRACT NOTE: SQLite integer PKs have no clean Mongo equivalent — every id
// (folder/tag/content/share id) is now a 24-hex ObjectId STRING instead of an
// int. The frontend treats ids as opaque tokens it passes back, so round-trips
// are preserved; only the JSON type changed. ids are handled as strings here.
//
// In Mongo the content + media collections share ONE database, so the original
// "media DB unavailable" error path is unreachable (media is always queryable).

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/ContentOrgJunctionStore.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function respond($ok, $data = null, $err = null) {
    $out = ['ok' => $ok];
    if ($data !== null) $out = array_merge($out, is_array($data) ? $data : ['data' => $data]);
    if ($err !== null) $out['error'] = $err;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

function getTokenFromRequest() {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true) ?: [];
    return $input['token'] ?? $_GET['token'] ?? '';
}

function requireAuth() {
    $me = AuthStore::findUserBySessionToken(getTokenFromRequest());
    if (!$me) respond(false, null, 'נדרשת התחברות');
    return $me;
}

// CLI library mode (kept for parity with the original test-harness hook).
if (php_sapi_name() === 'cli' && getenv('CONTENT_ORG_LIB') === '1') {
    return;
}

$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?: [];
if (!$action && isset($input['action'])) $action = $input['action'];

switch ($action) {

    case 'ping':
        respond(true, ['pong' => true]);
        break;

    case 'init': {
        requireAuth();
        ContentOrgJunctionStore::ensureIndexes();
        respond(true, ['tables' => ['folders', 'content_folders', 'content_org', 'tags', 'content_tags', 'folder_shares', 'share_recipients']]);
        break;
    }

    case 'create_tag': {
        $me = requireAuth();
        $r = ContentOrgJunctionStore::createTag($me['id'], $input['name'] ?? '', $input['namespace'] ?? '');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'list_tags': {
        $me = requireAuth();
        $ns = isset($input['namespace']) ? trim((string)$input['namespace']) : '';
        respond(true, ['tags' => ContentOrgJunctionStore::listTags($me['id'], $ns ?: null)]);
        break;
    }
    case 'tag_item': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? '');
        $tid = (string)($input['tag_id'] ?? '');
        if ($cid === '' || $tid === '') respond(false, null, 'content_id ו-tag_id חובה');
        $r = ContentOrgJunctionStore::tagItem($me['id'], $cid, $tid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'untag_item': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? '');
        $tid = (string)($input['tag_id'] ?? '');
        if ($cid === '' || $tid === '') respond(false, null, 'content_id ו-tag_id חובה');
        $r = ContentOrgJunctionStore::untagItem($me['id'], $cid, $tid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'search_content': {
        $me = requireAuth();
        $rows = ContentOrgJunctionStore::searchContent($me['id'], $input);
        respond(true, ['results' => $rows, 'count' => count($rows)]);
        break;
    }

    case 'create_folder': {
        $me = requireAuth();
        $r = ContentOrgJunctionStore::createFolder($me['id'], $input['name'] ?? '', $input['parent_id'] ?? null);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'list_folders': {
        $me = requireAuth();
        respond(true, ['folders' => ContentOrgJunctionStore::listFolders($me['id'])]);
        break;
    }
    case 'rename_folder': {
        $me = requireAuth();
        $id = (string)($input['id'] ?? '');
        if ($id === '') respond(false, null, 'id חובה');
        $r = ContentOrgJunctionStore::renameFolder($me['id'], $id, $input['name'] ?? '');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'move_folder': {
        $me = requireAuth();
        $id = (string)($input['id'] ?? '');
        if ($id === '') respond(false, null, 'id חובה');
        $r = ContentOrgJunctionStore::moveFolder($me['id'], $id, $input['parent_id'] ?? null);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'delete_folder': {
        $me = requireAuth();
        $id = (string)($input['id'] ?? '');
        if ($id === '') respond(false, null, 'id חובה');
        $r = ContentOrgJunctionStore::deleteFolder($me['id'], $id);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'add_to_folder': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? ''); $fid = (string)($input['folder_id'] ?? '');
        if ($cid === '' || $fid === '') respond(false, null, 'content_id ו-folder_id חובה');
        $r = ContentOrgJunctionStore::addToFolder($me['id'], $cid, $fid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'add_shortcut': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? ''); $fid = (string)($input['folder_id'] ?? '');
        if ($cid === '' || $fid === '') respond(false, null, 'content_id ו-folder_id חובה');
        $r = ContentOrgJunctionStore::addShortcut($me['id'], $cid, $fid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'remove_from_folder': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? ''); $fid = (string)($input['folder_id'] ?? '');
        if ($cid === '' || $fid === '') respond(false, null, 'content_id ו-folder_id חובה');
        $r = ContentOrgJunctionStore::removeFromFolder($me['id'], $cid, $fid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'list_folder_items': {
        $me = requireAuth();
        $fid = (string)($input['folder_id'] ?? '');
        if ($fid === '') respond(false, null, 'folder_id חובה');
        $r = ContentOrgJunctionStore::listFolderItems($me['id'], $fid, !empty($input['include_archived']));
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'archive_item': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? '');
        if ($cid === '') respond(false, null, 'content_id חובה');
        $r = ContentOrgJunctionStore::archiveItem($me['id'], $cid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'restore_item': {
        $me = requireAuth();
        $cid = (string)($input['content_id'] ?? '');
        if ($cid === '') respond(false, null, 'content_id חובה');
        $r = ContentOrgJunctionStore::restoreItem($me['id'], $cid, $input['store'] ?? 'content');
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }

    case 'create_folder_share': {
        $me = requireAuth();
        $fid = (string)($input['folder_id'] ?? '');
        if ($fid === '') respond(false, null, 'folder_id חובה');
        $ttl = null;
        if (isset($input['ttl_hours']) && $input['ttl_hours'] !== '' && $input['ttl_hours'] !== null) {
            $ttl = (int)round(((float)$input['ttl_hours']) * 3600);
        }
        $r = ContentOrgJunctionStore::createFolderShare($me['id'], $fid,
            $input['target_type'] ?? 'link', $input['target_id'] ?? null, $input['role'] ?? 'view', $ttl);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'list_folder_shares': {
        $me = requireAuth();
        $fid = (string)($input['folder_id'] ?? '');
        if ($fid === '') respond(false, null, 'folder_id חובה');
        $r = ContentOrgJunctionStore::listFolderShares($me['id'], $fid);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'revoke_folder_share': {
        $me = requireAuth();
        $id = (string)($input['id'] ?? '');
        if ($id === '') respond(false, null, 'id חובה');
        $r = ContentOrgJunctionStore::revokeFolderShare($me['id'], $id);
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'folders_shared_with_me': {
        $me = requireAuth();
        respond(true, ContentOrgJunctionStore::foldersSharedWithMe($me));
        break;
    }

    case 'open_share': {
        $me = requireAuth();
        $r = ContentOrgJunctionStore::openShare($me['id'], $input['token'] ?? ($_GET['token'] ?? ''));
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'detach_share': {
        $me = requireAuth();
        $r = ContentOrgJunctionStore::detachShare($me['id'], $input['token'] ?? ($_GET['token'] ?? ''));
        if (isset($r['error'])) respond(false, null, $r['error']);
        respond(true, $r);
        break;
    }
    case 'my_shared_items': {
        $me = requireAuth();
        respond(true, ContentOrgJunctionStore::mySharedItems($me['id']));
        break;
    }

    default:
        respond(false, null, 'action לא מוכר: ' . $action);
}
