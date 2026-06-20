<?php
// Public vocab categories API.
// Lets users publish custom vocabulary categories, search by creator/category,
// open a live shared category, and preserve viewer access after owner deletion
// so the viewer can clone the last snapshot instead of losing it.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond($ok, $data = null, $err = null) {
    $out = ['success' => $ok, 'ok' => $ok];
    if ($data !== null) $out = array_merge($out, is_array($data) ? $data : ['data' => $data]);
    if ($err !== null) $out['error'] = $err;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

function authDb() {
    $p = __DIR__ . '/plonter_auth.db';
    if (!file_exists($p)) respond(false, null, 'auth db missing');
    $db = new SQLite3($p);
    $db->busyTimeout(5000);
    return $db;
}

function publicDb() {
    $p = __DIR__ . '/plonter_public_vocab.db';
    $db = new SQLite3($p);
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS public_vocab_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        owner_name TEXT NOT NULL,
        owner_email TEXT,
        source_cat_name TEXT NOT NULL,
        title TEXT NOT NULL,
        words_json TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        is_public INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL,
        UNIQUE(owner_user_id, source_cat_name)
    )');
    $db->exec('CREATE TABLE IF NOT EXISTS public_vocab_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_snapshot_json TEXT NOT NULL,
        UNIQUE(public_id, user_id)
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_public_vocab_search ON public_vocab_categories(title, owner_name)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_public_vocab_access_user ON public_vocab_access(user_id)');
    return $db;
}

function inputJson() {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?: [];
}

function tokenFromRequest($input) {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
    return $input['token'] ?? $_GET['token'] ?? '';
}

function userFromToken($token) {
    if (!$token) return null;
    $db = authDb();
    $stmt = $db->prepare("SELECT u.id, u.email, u.first_name, u.last_name, u.role
                          FROM sessions s JOIN users u ON s.user_id = u.id
                          WHERE s.token = :t AND s.expires_at > datetime('now')");
    $stmt->bindValue(':t', $token, SQLITE3_TEXT);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return $row ?: null;
}

function requireUser($input) {
    $u = userFromToken(tokenFromRequest($input));
    if (!$u) respond(false, null, 'נדרשת התחברות');
    return $u;
}

function optionalUser($input) {
    return userFromToken(tokenFromRequest($input));
}

function displayName($u) {
    $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
    return $name ?: ($u['email'] ?? 'משתמש');
}

function cleanWords($words) {
    $out = [];
    if (!is_array($words)) return $out;
    foreach ($words as $w) {
        if (!is_array($w)) continue;
        $arabic = trim((string)($w['arabic'] ?? ''));
        $hebrew = trim((string)($w['hebrew'] ?? ''));
        $form = trim((string)($w['form'] ?? ''));
        if ($arabic === '' && $hebrew === '') continue;
        $out[] = ['arabic' => $arabic, 'form' => $form, 'hebrew' => $hebrew];
    }
    return $out;
}

function rowToClient($row, $includeWords = false, $snapshotJson = null) {
    $out = [
        'id' => intval($row['id']),
        'title' => $row['title'],
        'owner_name' => $row['owner_name'],
        'owner_user_id' => intval($row['owner_user_id']),
        'source_cat_name' => $row['source_cat_name'],
        'word_count' => intval($row['word_count']),
        'updated_at' => $row['updated_at'],
        'deleted_at' => $row['deleted_at'],
        'is_deleted' => !empty($row['deleted_at'])
    ];
    if ($includeWords) {
        $json = $snapshotJson !== null ? $snapshotJson : ($row['words_json'] ?? '[]');
        $out['words'] = json_decode($json, true) ?: [];
    }
    return $out;
}

$action = $_GET['action'] ?? '';
$input = inputJson();
$db = publicDb();

if ($action === 'ping') respond(true, ['message' => 'vocab_public_api alive']);

if ($action === 'search') {
    $q = trim((string)($input['q'] ?? $_GET['q'] ?? ''));
    $owner = trim((string)($input['owner_name'] ?? $_GET['owner_name'] ?? ''));
    $like = '%' . $q . '%';
    $stmt = $db->prepare("SELECT * FROM public_vocab_categories
                          WHERE is_public = 1 AND deleted_at IS NULL
                            AND (:owner = '' OR owner_name = :owner)
                            AND (:q = '' OR title LIKE :like OR owner_name LIKE :like)
                          ORDER BY updated_at DESC
                          LIMIT 50");
    $stmt->bindValue(':owner', $owner, SQLITE3_TEXT);
    $stmt->bindValue(':q', $q, SQLITE3_TEXT);
    $stmt->bindValue(':like', $like, SQLITE3_TEXT);
    $res = $stmt->execute();
    $items = [];
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) $items[] = rowToClient($row);
    respond(true, ['items' => $items]);
}

if ($action === 'publish') {
    $me = requireUser($input);
    $title = trim((string)($input['title'] ?? ''));
    $source = trim((string)($input['source_cat_name'] ?? $title));
    $words = cleanWords($input['words'] ?? []);
    if ($title === '') respond(false, null, 'חסר שם קטגוריה');
    if (!$words) respond(false, null, 'אין מילים לפרסום');
    $wordsJson = json_encode($words, JSON_UNESCAPED_UNICODE);
    $ownerName = displayName($me);

    $stmt = $db->prepare("INSERT INTO public_vocab_categories
        (owner_user_id, owner_name, owner_email, source_cat_name, title, words_json, word_count, is_public, created_at, updated_at, deleted_at)
        VALUES (:uid, :oname, :email, :source, :title, :words, :cnt, 1, datetime('now'), datetime('now'), NULL)
        ON CONFLICT(owner_user_id, source_cat_name) DO UPDATE SET
            owner_name = excluded.owner_name,
            owner_email = excluded.owner_email,
            title = excluded.title,
            words_json = excluded.words_json,
            word_count = excluded.word_count,
            is_public = 1,
            updated_at = datetime('now'),
            deleted_at = NULL");
    $stmt->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
    $stmt->bindValue(':oname', $ownerName, SQLITE3_TEXT);
    $stmt->bindValue(':email', $me['email'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':source', $source, SQLITE3_TEXT);
    $stmt->bindValue(':title', $title, SQLITE3_TEXT);
    $stmt->bindValue(':words', $wordsJson, SQLITE3_TEXT);
    $stmt->bindValue(':cnt', count($words), SQLITE3_INTEGER);
    $stmt->execute();

    $stmt = $db->prepare('SELECT * FROM public_vocab_categories WHERE owner_user_id = :uid AND source_cat_name = :source');
    $stmt->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
    $stmt->bindValue(':source', $source, SQLITE3_TEXT);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    respond(true, ['category' => rowToClient($row, true)]);
}

if ($action === 'mark_deleted') {
    $me = requireUser($input);
    $source = trim((string)($input['source_cat_name'] ?? $input['title'] ?? ''));
    if ($source === '') respond(false, null, 'חסר שם קטגוריה');
    $stmt = $db->prepare("UPDATE public_vocab_categories
                          SET deleted_at = COALESCE(deleted_at, datetime('now')), updated_at = datetime('now')
                          WHERE owner_user_id = :uid AND source_cat_name = :source AND deleted_at IS NULL");
    $stmt->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
    $stmt->bindValue(':source', $source, SQLITE3_TEXT);
    $stmt->execute();
    respond(true, ['updated' => $db->changes()]);
}

if ($action === 'open') {
    $me = optionalUser($input);
    $id = intval($input['id'] ?? $_GET['id'] ?? 0);
    if (!$id) respond(false, null, 'חסר id');
    $stmt = $db->prepare('SELECT * FROM public_vocab_categories WHERE id = :id');
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    if (!$row) respond(false, null, 'קטגוריה לא נמצאה');

    $snapshotJson = $row['words_json'] ?? '[]';
    if ($me) {
        $stmt = $db->prepare("INSERT INTO public_vocab_access (public_id, user_id, first_seen_at, last_seen_at, last_snapshot_json)
                              VALUES (:pid, :uid, datetime('now'), datetime('now'), :snap)
                              ON CONFLICT(public_id, user_id) DO UPDATE SET
                                  last_seen_at = datetime('now'),
                                  last_snapshot_json = CASE
                                      WHEN :deleted IS NULL THEN excluded.last_snapshot_json
                                      ELSE public_vocab_access.last_snapshot_json
                                  END");
        $stmt->bindValue(':pid', intval($row['id']), SQLITE3_INTEGER);
        $stmt->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
        $stmt->bindValue(':snap', $snapshotJson, SQLITE3_TEXT);
        if ($row['deleted_at'] === null || $row['deleted_at'] === '') {
            $stmt->bindValue(':deleted', null, SQLITE3_NULL);
        } else {
            $stmt->bindValue(':deleted', $row['deleted_at'], SQLITE3_TEXT);
        }
        $stmt->execute();
    }

    respond(true, ['category' => rowToClient($row, true, $row['deleted_at'] ? null : $snapshotJson)]);
}

if ($action === 'my_access') {
    $me = requireUser($input);
    $stmt = $db->prepare("SELECT c.*, a.last_seen_at, a.last_snapshot_json
                          FROM public_vocab_access a
                          JOIN public_vocab_categories c ON c.id = a.public_id
                          WHERE a.user_id = :uid AND c.owner_user_id != :uid
                          ORDER BY a.last_seen_at DESC
                          LIMIT 50");
    $stmt->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
    $res = $stmt->execute();
    $items = [];
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
        if (empty($row['deleted_at'])) {
            $snap = $row['words_json'];
            $upd = $db->prepare("UPDATE public_vocab_access
                                 SET last_seen_at = datetime('now'), last_snapshot_json = :snap
                                 WHERE public_id = :pid AND user_id = :uid");
            $upd->bindValue(':snap', $snap, SQLITE3_TEXT);
            $upd->bindValue(':pid', intval($row['id']), SQLITE3_INTEGER);
            $upd->bindValue(':uid', intval($me['id']), SQLITE3_INTEGER);
            $upd->execute();
            $items[] = rowToClient($row, true, $snap);
        } else {
            $items[] = rowToClient($row, true, $row['last_snapshot_json']);
        }
    }
    respond(true, ['items' => $items]);
}

respond(false, null, 'action לא מוכר: ' . $action);
