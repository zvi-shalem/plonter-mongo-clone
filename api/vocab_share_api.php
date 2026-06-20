<?php
/**
 * Vocab Share API — per-category share tokens for third-party recording.
 * MongoDB-backed (Phase 5b). Token + recording data via VocabShareStore
 * (collection prefix '' → vocab_share_tokens / vocab_audio); auth + JSON via the
 * shared Mongo auth_common.php shim. Audio BLOBS stay on disk under
 * __DIR__/vocab_audio_blobs (preserved; paths stored relative, read via __DIR__).
 *
 * Contracts byte-identical EXCEPT owner ids are ObjectId strings (int→ObjectId).
 * 12 actions: create_token, create_group_token, info, upload, play,
 * delete_recording, list_tokens, list_tokens_for_category, list_group_tokens,
 * revoke, refresh_tokens_words, delete_category_tokens, ping.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

const MAX_BLOB_BYTES = 1048576;
const BLOB_DIR       = 'vocab_audio_blobs';
const MIME_WHITELIST = [
    'audio/webm' => 'webm', 'video/webm' => 'webm', 'audio/ogg' => 'ogg', 'video/ogg' => 'ogg',
    'audio/mpeg' => 'mp3', 'audio/mp4' => 'm4a', 'video/mp4' => 'm4a', 'audio/wav' => 'wav', 'audio/x-wav' => 'wav',
];
const TTL_MIN_SECONDS = 3600;
const TTL_MAX_SECONDS = 7776000; // 90 days

require_once __DIR__ . '/auth_common.php';
require_once __DIR__ . '/../mongo_adapter/VocabShareStore.php';
VocabShareStore::$prefix = '';   // primary vocab-share datastore

// ---- builtin-category role gates ----
function isBuiltinCategory($cat_name) {
    static $list = null;
    if ($list === null) {
        $f = __DIR__ . '/builtin_categories.json';
        $arr = is_file($f) ? (json_decode(file_get_contents($f), true) ?: []) : [];
        $list = array_flip($arr);
    }
    return isset($list[$cat_name]);
}
function isAmitaiUser($uid) { return authUserEmail($uid) === 'amitai.shalem@gmail.com'; }
function isDragonUser($uid) {
    $role = authUserRole($uid);
    return $role === "\xF0\x9F\x90\x89 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F" ||
           $role === "\xF0\x9F\x90\xB2 \xD7\x93\xD7\xA8\xD7\xA7\xD7\x95\xD7\x9F"; // 🐉 / 🐲 דרקון
}
function isKingUser($uid) {
    $role = authUserRole($uid);
    return $role === "\xF0\x9F\x8E\xA7 DJ" || $role === "\xF0\x9F\x8F\xB0 \xD7\x9E\xD7\x9C\xD7\x9A"; // 🎧 DJ / 🏰 מלך
}
function requireAuthForCategory($cat_name) {
    $uid = requireAuth();
    if (isBuiltinCategory($cat_name) && !isAmitaiUser($uid) && !isDragonUser($uid) && !isKingUser($uid)) {
        respond(false, 'קישורי הקלטה לקטגוריות מובנות זמינים לאמתי או לבעלי תפקיד 🐉 דרקון או 🎧 DJ');
    }
    return $uid;
}

function readJsonBody() {
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?: []) : [];
}
function genShareToken() { return bin2hex(random_bytes(16)); }
function ensureBlobDir() {
    $dir = __DIR__ . '/' . BLOB_DIR;
    if (!is_dir($dir)) { if (!@mkdir($dir, 0755, true) && !is_dir($dir)) respond(false, 'לא ניתן ליצור תיקיית מדיה'); }
    return $dir;
}
function uuidv4() {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}
function loadShareToken($token) { return VocabShareStore::loadToken((string)$token); }
function validateShareToken($row) {
    if (!$row) return 'טוקן לא קיים';
    if (intval($row['revoked']) === 1) return 'הטוקן בוטל';
    if (intval($row['expires_at']) < time()) return 'הטוקן פג תוקף';
    return null;
}
function requireGroupCategory($row, $catName) {
    $cats = $row['categories_json'] ? (json_decode($row['categories_json'], true) ?: []) : [];
    foreach ($cats as $c) {
        if (is_array($c) && trim((string)($c['name'] ?? '')) === $catName) return $catName;
    }
    respond(false, 'קטגוריה לא בטוקן');
}

// ===== Actions =====

function action_create_token() {
    $body = readJsonBody();
    $category = trim($body['category'] ?? '');
    $ttlHours = floatval($body['ttl_hours'] ?? 24);
    $words    = isset($body['words']) && is_array($body['words']) ? $body['words'] : [];
    if ($category === '') respond(false, 'חסרה קטגוריה');
    $uid = requireAuthForCategory($category);
    $ttlSecs = intval(round($ttlHours * 3600));
    if ($ttlSecs < TTL_MIN_SECONDS) respond(false, 'TTL קצר מדי (מינימום שעה)');
    if ($ttlSecs > TTL_MAX_SECONDS) respond(false, 'TTL ארוך מדי (מקסימום 90 ימים)');

    $clean = [];
    foreach ($words as $w) {
        if (!is_array($w)) continue;
        $clean[] = ['arabic' => (string)($w['arabic'] ?? ''), 'form' => (string)($w['form'] ?? ''), 'hebrew' => (string)($w['hebrew'] ?? '')];
    }
    $wordsJson = json_encode($clean, JSON_UNESCAPED_UNICODE);
    $token = genShareToken(); $now = time(); $exp = $now + $ttlSecs;
    VocabShareStore::insertToken([
        'token' => $token, 'owner_user_id' => $uid, 'category' => $category,
        'created_at' => $now, 'expires_at' => $exp, 'revoked' => 0, 'last_used_at' => null,
        'words_json' => $wordsJson, 'is_group' => 0, 'group_name' => null, 'categories_json' => null,
    ]);
    respond(true, ['token' => $token, 'url' => 'share.html?t=' . $token, 'category' => $category,
        'expires_at' => $exp, 'ttl_hours' => $ttlHours, 'word_count' => count($clean)]);
}

function action_create_group_token() {
    $body = readJsonBody();
    $groupName = trim($body['group_name'] ?? '');
    $cats = isset($body['categories']) && is_array($body['categories']) ? $body['categories'] : [];
    $ttlHours = floatval($body['ttl_hours'] ?? 24);
    if ($groupName === '') respond(false, 'חסר שם קבוצה');
    if (!$cats) respond(false, 'חסרות קטגוריות');
    $uid = requireAuth();
    $authorizedForBuiltins = isAmitaiUser($uid) || isDragonUser($uid) || isKingUser($uid);
    $ttlSecs = intval(round($ttlHours * 3600));
    if ($ttlSecs < TTL_MIN_SECONDS) respond(false, 'TTL קצר מדי (מינימום שעה)');
    if ($ttlSecs > TTL_MAX_SECONDS) respond(false, 'TTL ארוך מדי (מקסימום 90 ימים)');

    $cleanCats = []; $seenNames = [];
    foreach ($cats as $cat) {
        if (!is_array($cat)) continue;
        $name = trim((string)($cat['name'] ?? ''));
        if ($name === '') respond(false, 'שם קטגוריה חסר באחד הפריטים');
        if (isset($seenNames[$name])) respond(false, 'קטגוריה כפולה: ' . $name);
        $seenNames[$name] = true;
        if (isBuiltinCategory($name) && !$authorizedForBuiltins) {
            respond(false, 'קישורי הקלטה לקטגוריות מובנות זמינים לאמתי או לבעלי תפקיד 🐉 דרקון או 🎧 DJ (קטגוריה: ' . $name . ')');
        }
        $words = isset($cat['words']) && is_array($cat['words']) ? $cat['words'] : [];
        $cleanWords = [];
        foreach ($words as $w) {
            if (!is_array($w)) continue;
            $cleanWords[] = ['arabic' => (string)($w['arabic'] ?? ''), 'form' => (string)($w['form'] ?? ''), 'hebrew' => (string)($w['hebrew'] ?? '')];
        }
        $cleanCats[] = ['name' => $name, 'words' => $cleanWords];
    }
    if (!$cleanCats) respond(false, 'אין קטגוריות חוקיות');
    $token = genShareToken(); $now = time(); $exp = $now + $ttlSecs;
    $catsJson = json_encode($cleanCats, JSON_UNESCAPED_UNICODE);
    VocabShareStore::insertToken([
        'token' => $token, 'owner_user_id' => $uid, 'category' => $groupName,
        'created_at' => $now, 'expires_at' => $exp, 'revoked' => 0, 'last_used_at' => null,
        'words_json' => null, 'is_group' => 1, 'group_name' => $groupName, 'categories_json' => $catsJson,
    ]);
    respond(true, ['token' => $token, 'url' => 'share.html?t=' . $token, 'group_name' => $groupName,
        'is_group' => true, 'expires_at' => $exp, 'ttl_hours' => $ttlHours, 'category_count' => count($cleanCats)]);
}

function action_info() {
    $token = (string)($_GET['t'] ?? $_GET['share_token'] ?? '');
    $row = loadShareToken($token);
    $err = validateShareToken($row);
    if ($err !== null) respond(false, $err);

    if (intval($row['is_group'] ?? 0) === 1) {
        $cats = $row['categories_json'] ? (json_decode($row['categories_json'], true) ?: []) : [];
        $catsOut = [];
        foreach ($cats as $cat) {
            if (!is_array($cat)) continue;
            $name = trim((string)($cat['name'] ?? ''));
            if ($name === '') continue;
            $words = isset($cat['words']) && is_array($cat['words']) ? $cat['words'] : [];
            $existing = VocabShareStore::existingFor($row['owner_user_id'], $name);
            $byLang = $existing['keys'];
            $catsOut[] = ['name' => $name, 'words' => $words, 'existing_keys' => $byLang['ar'],
                'existing_by_lang' => $byLang, 'existing_names_by_lang' => $existing['names']];
        }
        respond(true, ['group' => true, 'is_group' => true,
            'group_name' => (string)($row['group_name'] ?? $row['category']), 'categories' => $catsOut,
            'expires_at' => intval($row['expires_at']), 'remaining_seconds' => max(0, intval($row['expires_at']) - time())]);
    }

    $existing = VocabShareStore::existingFor($row['owner_user_id'], $row['category']);
    $existingByLang = $existing['keys'];
    $words = $row['words_json'] ? (json_decode($row['words_json'], true) ?: []) : [];
    respond(true, ['category' => $row['category'], 'expires_at' => intval($row['expires_at']),
        'remaining_seconds' => max(0, intval($row['expires_at']) - time()), 'words' => $words,
        'existing_keys' => $existingByLang['ar'], 'existing_by_lang' => $existingByLang,
        'existing_names_by_lang' => $existing['names'], 'group' => false, 'is_group' => false]);
}

function action_delete_recording() {
    $token = (string)($_GET['t'] ?? $_POST['share_token'] ?? '');
    $row = loadShareToken($token);
    $err = validateShareToken($row);
    if ($err !== null) respond(false, $err);
    $wordKey = (string)($_POST['word_key'] ?? '');
    if ($wordKey === '') respond(false, 'חסר word_key');
    if (intval($row['is_group'] ?? 0) === 1) {
        $catName = trim((string)($_POST['category'] ?? $_GET['category'] ?? ''));
        if ($catName === '') respond(false, 'חסר category לטוקן קבוצתי');
        requireGroupCategory($row, $catName);
    } else { $catName = (string)$row['category']; }

    $recs = VocabShareStore::recordingsFor($row['owner_user_id'], $catName, $wordKey);
    $ids = [];
    foreach ($recs as $r) {
        $ids[] = $r['id'];
        $abs = __DIR__ . '/' . $r['path'];
        if (is_file($abs)) @unlink($abs);
    }
    VocabShareStore::deleteAudioByIds($ids);
    VocabShareStore::touchToken($token, time());
    respond(true, ['deleted' => count($ids)]);
}

function action_play() {
    $token = (string)($_GET['t'] ?? $_GET['share_token'] ?? '');
    $row = loadShareToken($token);
    $err = validateShareToken($row);
    if ($err !== null) respond(false, $err);
    $wordKey = (string)($_GET['word_key'] ?? '');
    if ($wordKey === '') respond(false, 'חסר word_key');
    $pipe = strpos($wordKey, '|'); if ($pipe !== false) $wordKey = substr($wordKey, 0, $pipe);
    $lang = strtolower((string)($_GET['lang'] ?? 'ar'));
    if (!in_array($lang, ['ar', 'he'], true)) $lang = 'ar';
    if (intval($row['is_group'] ?? 0) === 1) {
        $catName = trim((string)($_GET['category'] ?? ''));
        if ($catName === '') respond(false, 'חסר category לטוקן קבוצתי');
        requireGroupCategory($row, $catName);
    } else { $catName = (string)$row['category']; }

    $rec = VocabShareStore::latestRecording($row['owner_user_id'], $catName, $wordKey, $lang);
    if (!$rec) respond(false, 'אין הקלטה');
    $abs = __DIR__ . '/' . $rec['path'];
    if (!is_file($abs)) respond(false, 'קובץ חסר על הדיסק');
    header_remove('Content-Type');
    header('Content-Type: ' . $rec['mime']);
    header('Content-Length: ' . filesize($abs));
    header('Cache-Control: private, max-age=300');
    readfile($abs);
    exit;
}

function action_upload() {
    $shareToken = trim($_POST['share_token'] ?? '');
    $row = loadShareToken($shareToken);
    $err = validateShareToken($row);
    if ($err !== null) respond(false, $err);
    $wordKey = trim($_POST['word_key'] ?? '');
    if ($wordKey === '') respond(false, 'חסר word_key');
    $pipe = strpos($wordKey, '|'); if ($pipe !== false) $wordKey = substr($wordKey, 0, $pipe);
    if (intval($row['is_group'] ?? 0) === 1) {
        $catName = trim((string)($_POST['category'] ?? ''));
        if ($catName === '') respond(false, 'חסר category לטוקן קבוצתי');
        requireGroupCategory($row, $catName);
    } else { $catName = (string)$row['category']; }

    if (!isset($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) respond(false, 'קובץ audio חסר או שגוי');
    $file = $_FILES['audio'];
    $size = intval($file['size']);
    if ($size <= 0) respond(false, 'קובץ ריק');
    if ($size > MAX_BLOB_BYTES) respond(false, 'הקובץ חורג מ-1MB (' . $size . ' bytes)');

    $mime = '';
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) { $mime = finfo_file($finfo, $file['tmp_name']) ?: ''; finfo_close($finfo); }
    }
    if (!$mime) $mime = $file['type'] ?? '';
    $mime = strtolower($mime);
    if (!isset(MIME_WHITELIST[$mime])) respond(false, 'סוג קובץ לא מורשה: ' . $mime);
    $ext = MIME_WHITELIST[$mime];
    if (strpos($mime, 'video/') === 0) $mime = 'audio/' . substr($mime, 6);

    $id = uuidv4();
    $relPath = BLOB_DIR . '/' . $id . '.' . $ext;
    $absPath = ensureBlobDir() . '/' . $id . '.' . $ext;
    if (!@move_uploaded_file($file['tmp_name'], $absPath)) respond(false, 'כשל בשמירת קובץ');
    @chmod($absPath, 0644);

    $lang = strtolower(trim($_POST['lang'] ?? 'ar'));
    if (!in_array($lang, ['ar', 'he'], true)) $lang = 'ar';

    // Replace mode: delete existing (owner, word_key, cat, lang) recording + its blob.
    $old = VocabShareStore::recordingsForLang($row['owner_user_id'], $wordKey, $catName, $lang);
    $oldIds = [];
    foreach ($old as $o) {
        $oldIds[] = $o['id'];
        $oldAbs = __DIR__ . '/' . $o['path'];
        if (is_file($oldAbs)) @unlink($oldAbs);
    }
    VocabShareStore::deleteAudioByIds($oldIds);

    $recorderName = trim($_POST['recorder_name'] ?? '');
    if ($recorderName === '') $recorderName = null;
    if ($recorderName !== null && mb_strlen($recorderName) > 60) $recorderName = mb_substr($recorderName, 0, 60);

    VocabShareStore::insertAudio([
        'id' => $id, 'user_id' => $row['owner_user_id'], 'word_key' => $wordKey, 'cat_name' => $catName,
        'mime' => $mime, 'path' => $relPath, 'size_bytes' => $size, 'recorder_name' => $recorderName,
        'lang' => $lang, 'is_hidden' => 0, 'created_at' => time(),
    ]);
    VocabShareStore::touchToken($shareToken, time());
    respond(true, ['id' => $id, 'word_key' => $wordKey, 'size_bytes' => $size, 'mime' => $mime]);
}

function action_list_tokens() {
    $uid = requireAuth();
    $items = [];
    foreach (VocabShareStore::listTokens($uid) as $row) {
        $items[] = ['token' => $row['token'], 'category' => $row['category'],
            'created_at' => intval($row['created_at']), 'expires_at' => intval($row['expires_at']),
            'revoked' => intval($row['revoked']) === 1, 'expired' => intval($row['expires_at']) < time(),
            'last_used_at' => $row['last_used_at'] !== null ? intval($row['last_used_at']) : null,
            'url' => 'share.html?t=' . $row['token'], 'remaining_seconds' => max(0, intval($row['expires_at']) - time())];
    }
    respond(true, ['items' => $items, 'count' => count($items)]);
}

function action_list_tokens_for_category() {
    $uid = requireAuth();
    $body = readJsonBody();
    $category = trim($body['category'] ?? '');
    if ($category === '') respond(false, 'חסרה קטגוריה');
    $isBuiltin = isBuiltinCategory($category);
    $authorized = $isBuiltin && (isAmitaiUser($uid) || isDragonUser($uid) || isKingUser($uid));
    $scope = $authorized ? 'all_owners' : 'mine';
    $ownerById = authAllUsers();
    $rows = VocabShareStore::tokensByCategory($category, $scope === 'all_owners' ? null : $uid);
    $items = [];
    foreach ($rows as $row) {
        $oid = (string)$row['owner_user_id'];
        $items[] = ['token' => $row['token'], 'category' => $row['category'], 'owner_user_id' => $oid,
            'owner_name' => $ownerById[$oid] ?? ('user#' . $oid), 'is_mine' => $oid === $uid,
            'created_at' => intval($row['created_at']), 'expires_at' => intval($row['expires_at']),
            'revoked' => intval($row['revoked']) === 1, 'expired' => intval($row['expires_at']) < time(),
            'last_used_at' => $row['last_used_at'] !== null ? intval($row['last_used_at']) : null,
            'url' => 'share.html?t=' . $row['token'], 'remaining_seconds' => max(0, intval($row['expires_at']) - time())];
    }
    respond(true, ['items' => $items, 'count' => count($items), 'scope' => $scope, 'category' => $category]);
}

function action_list_group_tokens() {
    $uid = requireAuth();
    $body = readJsonBody();
    $groupName = trim($body['group_name'] ?? '');
    if ($groupName === '') respond(false, 'חסר שם קבוצה');
    $authorized = isAmitaiUser($uid) || isDragonUser($uid) || isKingUser($uid);
    $scope = $authorized ? 'all_owners' : 'mine';
    $ownerById = authAllUsers();
    $rows = VocabShareStore::groupTokensByName($groupName, $scope === 'all_owners' ? null : $uid);
    $items = [];
    foreach ($rows as $row) {
        $oid = (string)$row['owner_user_id'];
        $cats = $row['categories_json'] ? (json_decode($row['categories_json'], true) ?: []) : [];
        $items[] = ['token' => $row['token'], 'group_name' => $row['group_name'], 'owner_user_id' => $oid,
            'owner_name' => $ownerById[$oid] ?? ('user#' . $oid), 'is_mine' => $oid === $uid,
            'created_at' => intval($row['created_at']), 'expires_at' => intval($row['expires_at']),
            'revoked' => intval($row['revoked']) === 1, 'expired' => intval($row['expires_at']) < time(),
            'last_used_at' => $row['last_used_at'] !== null ? intval($row['last_used_at']) : null,
            'url' => 'share.html?t=' . $row['token'], 'remaining_seconds' => max(0, intval($row['expires_at']) - time()),
            'category_count' => count($cats)];
    }
    respond(true, ['items' => $items, 'count' => count($items), 'scope' => $scope, 'group_name' => $groupName]);
}

function action_revoke() {
    $uid = requireAuth();
    $body = readJsonBody();
    $token = trim($body['token'] ?? '');
    if ($token === '') respond(false, 'חסר טוקן');
    $changed = VocabShareStore::revokeToken($token, $uid);
    respond(true, ['revoked' => $changed]);
}

function action_refresh_tokens_words() {
    $body = readJsonBody();
    $tokenArg = trim((string)($body['token'] ?? ''));
    if ($tokenArg !== '' && isset($body['categories']) && is_array($body['categories'])) {
        $uid = requireAuth();
        $row = loadShareToken($tokenArg);
        if (!$row) respond(false, 'טוקן לא קיים');
        if ((string)$row['owner_user_id'] !== (string)$uid) respond(false, 'הטוקן אינו שלך');
        if (intval($row['is_group'] ?? 0) !== 1) respond(false, 'הטוקן אינו טוקן קבוצתי');
        if (intval($row['revoked']) === 1) respond(false, 'הטוקן בוטל');
        if (intval($row['expires_at']) < time()) respond(false, 'הטוקן פג תוקף');
        $cleanCats = [];
        foreach ($body['categories'] as $cat) {
            if (!is_array($cat)) continue;
            $name = trim((string)($cat['name'] ?? ''));
            if ($name === '') continue;
            $words = isset($cat['words']) && is_array($cat['words']) ? $cat['words'] : [];
            $cleanWords = [];
            foreach ($words as $w) {
                if (!is_array($w)) continue;
                $cleanWords[] = ['arabic' => (string)($w['arabic'] ?? ''), 'form' => (string)($w['form'] ?? ''), 'hebrew' => (string)($w['hebrew'] ?? '')];
            }
            $cleanCats[] = ['name' => $name, 'words' => $cleanWords];
        }
        if (!$cleanCats) respond(false, 'אין קטגוריות חוקיות');
        $newGroupName = trim((string)($body['group_name'] ?? $row['group_name'] ?? $row['category']));
        if ($newGroupName === '') $newGroupName = (string)($row['group_name'] ?? $row['category']);
        $catsJson = json_encode($cleanCats, JSON_UNESCAPED_UNICODE);
        $changed = VocabShareStore::refreshGroup($tokenArg, $uid, $catsJson, $newGroupName);
        respond(true, ['updated' => $changed, 'token' => $tokenArg, 'group_name' => $newGroupName,
            'category_count' => count($cleanCats), 'is_group' => true]);
    }

    $category = trim($body['category'] ?? '');
    $words = isset($body['words']) && is_array($body['words']) ? $body['words'] : [];
    if ($category === '') respond(false, 'חסרה קטגוריה');
    $uid = requireAuthForCategory($category);
    $clean = [];
    foreach ($words as $w) {
        if (!is_array($w)) continue;
        $clean[] = ['arabic' => (string)($w['arabic'] ?? ''), 'form' => (string)($w['form'] ?? ''), 'hebrew' => (string)($w['hebrew'] ?? '')];
    }
    $wordsJson = json_encode($clean, JSON_UNESCAPED_UNICODE);
    $changed = VocabShareStore::refreshWords($uid, $category, $wordsJson, time());
    respond(true, ['updated' => $changed, 'category' => $category, 'word_count' => count($clean)]);
}

function action_delete_category_tokens() {
    $body = readJsonBody();
    $category = trim($body['category'] ?? ($body['cat_name'] ?? ''));
    if ($category === '') respond(false, 'חסרה קטגוריה');
    $uid = requireAuthForCategory($category);
    $changed = VocabShareStore::revokeCategoryTokens($uid, $category);
    respond(true, ['revoked' => $changed, 'category' => $category]);
}

// ===== Router =====
$action = $_GET['action'] ?? '';
switch ($action) {
    case 'create_token':             action_create_token(); break;
    case 'create_group_token':       action_create_group_token(); break;
    case 'info':                     action_info(); break;
    case 'upload':                   action_upload(); break;
    case 'play':                     action_play(); break;
    case 'delete_recording':         action_delete_recording(); break;
    case 'list_tokens':              action_list_tokens(); break;
    case 'list_tokens_for_category': action_list_tokens_for_category(); break;
    case 'list_group_tokens':        action_list_group_tokens(); break;
    case 'revoke':                   action_revoke(); break;
    case 'refresh_tokens_words':     action_refresh_tokens_words(); break;
    case 'delete_category_tokens':   action_delete_category_tokens(); break;
    case 'ping':                     respond(true, ['message' => 'vocab_share_api alive', 'time' => date('Y-m-d H:i:s')]); break;
    default:                         respond(false, 'פעולה לא מוכרת: ' . $action);
}
