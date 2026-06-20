<?php
/**
 * AI Dictionary Cache API  — MongoDB-backed (Phase 5b).
 *
 * Data access goes through AiDictStore (MongoDB). The HTTP request/response
 * contracts are kept BYTE-IDENTICAL to the original SQLite version so the
 * frontend needs zero changes. The store returns likes as an array
 * [{meaning_key, count}]; this file reshapes them back into the original
 * {entry:<int>, meanings:{key:int,...}} response shape.
 *
 * Actions (GET or POST 'action' param):
 *   lookup       — GET  term, stage(default 'primary')     → {found, result, likes}
 *   save         — POST term, stage, result_json            → {ok}
 *   save_related — POST term, result_json                   → {ok} (insert-only, skips if primary already exists)
 *   suggest      — GET  prefix, limit(default 10)           → {terms:[...]}
 *   like         — GET/POST term, stage, meaning_key, delta → {ok, likes:<new count>}
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/AiDictStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function cacheRespond($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Convert the store's likes array [{meaning_key, count}] into the original
 * API shape {entry:<int>, meanings:{key:int,...}}. The empty meaning_key ('')
 * is the entry-level like count.
 */
function shapeLikes(array $likesArr) {
    $out = ['entry' => 0, 'meanings' => (object)[]];
    foreach ($likesArr as $l) {
        $key   = $l['meaning_key'] ?? '';
        $count = (int)($l['count'] ?? 0);
        if ($key === '') {
            $out['entry'] = $count;
        } else {
            $out['meanings']->{$key} = $count;
        }
    }
    return $out;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {

    case 'lookup': {
        $term  = trim($_GET['term']  ?? '');
        $stage = trim($_GET['stage'] ?? 'primary');
        if ($term === '') { cacheRespond(['found' => false]); }
        $res = AiDictStore::lookup($term, $stage);     // increments hit_count
        if (empty($res['found'])) { cacheRespond(['found' => false]); }
        cacheRespond([
            'found'  => true,
            'result' => $res['result'],
            'likes'  => shapeLikes($res['likes'] ?? []),
        ]);
    }

    case 'save': {
        $raw  = file_get_contents('php://input');
        $body = ($raw && $raw[0] === '{') ? (json_decode($raw, true) ?: []) : [];
        $term       = trim($body['term']        ?? $_POST['term']        ?? '');
        $stage      = trim($body['stage']       ?? $_POST['stage']       ?? 'primary');
        $resultJson = $body['result_json']       ?? $_POST['result_json'] ?? '';
        if ($term === '' || $resultJson === '') {
            cacheRespond(['ok' => false, 'error' => 'missing params']);
        }
        AiDictStore::save($term, $stage, $resultJson);
        cacheRespond(['ok' => true]);
    }

    case 'save_related': {
        // Insert a mini-primary entry for a related word ONLY if no primary entry exists yet.
        $raw  = file_get_contents('php://input');
        $body = ($raw && $raw[0] === '{') ? (json_decode($raw, true) ?: []) : [];
        $term       = trim($body['term']        ?? $_POST['term']        ?? '');
        $resultJson = $body['result_json']       ?? $_POST['result_json'] ?? '';
        if ($term === '' || $resultJson === '') {
            cacheRespond(['ok' => false, 'error' => 'missing params']);
        }
        AiDictStore::saveRelated($term, $resultJson);
        cacheRespond(['ok' => true]);
    }

    case 'like': {
        $raw  = file_get_contents('php://input');
        $body = ($raw && $raw[0] === '{') ? (json_decode($raw, true) ?: []) : [];
        $term       = trim($body['term']        ?? $_GET['term']        ?? $_POST['term']        ?? '');
        $stage      = trim($body['stage']       ?? $_GET['stage']       ?? $_POST['stage']       ?? 'primary');
        $meaningKey = $body['meaning_key']       ?? $_GET['meaning_key'] ?? $_POST['meaning_key'] ?? '';
        $meaningKey = trim((string)$meaningKey);
        $delta      = intval($body['delta']      ?? $_GET['delta']       ?? $_POST['delta']       ?? 1);
        if ($delta !== 1 && $delta !== -1) $delta = 1;
        if ($term === '') { cacheRespond(['ok' => false, 'error' => 'missing term']); }

        // NOTE (documented in MONGO_PORT_PROGRESS.md): the Mongo design embeds
        // likes INSIDE the cache doc, so a like requires the term to be cached.
        // In the real UI flow a like always follows a lookup (which caches the
        // term), so this is equivalent to the original in practice. For the
        // edge case of a like on a never-cached term we do NOT fabricate a
        // phantom cache entry (that would pollute lookup/suggest); we return the
        // same {ok,likes} shape with the count the store computed.
        $res = AiDictStore::like($term, $stage, $meaningKey, $delta);
        cacheRespond(['ok' => true, 'likes' => (int)($res['likes'] ?? 0)]);
    }

    case 'suggest': {
        $prefix = trim($_GET['prefix'] ?? '');
        $limit  = max(1, min(50, intval($_GET['limit'] ?? 10)));
        if (strlen($prefix) < 1) { cacheRespond(['terms' => []]); }
        $terms = AiDictStore::suggest($prefix, $limit, 'primary');
        cacheRespond(['terms' => $terms]);
    }

    default:
        cacheRespond(['ok' => false, 'error' => 'unknown action: ' . htmlspecialchars($action)]);
}
