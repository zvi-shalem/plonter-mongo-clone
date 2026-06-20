<?php
// Media Storage API — folders + media items for Plonter.  MongoDB-backed (Phase 5b).
// Data access via MediaStore (apiMedia* contract-shaped methods); auth via AuthStore.
// The clone's missing db.php (jsonResponse/jsonError/getDB/getAuthUser) is replaced
// inline below. Contracts byte-identical EXCEPT ids are ObjectId strings
// (int→ObjectId decision); folder/media ids are handled as strings (no intval).
// ASSUMPTION (db.php absent locally): jsonError emits {error:<msg>} with HTTP 400 —
// matches the codebase's "echo the array as-is" jsonResponse style. Verify against
// the server's real db.php when available.

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/mongo_adapter/MediaStore.php';
require_once __DIR__ . '/mongo_adapter/AuthStore.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

function jsonResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function jsonError($msg, $status = 400) {
    jsonResponse(['error' => $msg], $status);
}
function mediaToken() {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
    return $_POST['token'] ?? $_GET['token'] ?? ($GLOBALS['_media_input']['token'] ?? '');
}
function getAuthUser() {
    $me = AuthStore::findUserBySessionToken((string)mediaToken());
    return $me ? ['id' => $me['id'], 'email' => $me['email'] ?? ''] : null;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

$method = $_SERVER['REQUEST_METHOD'];

// Oversize multipart guard (php post_max_size silently drops the body).
$__ctype = $_SERVER['CONTENT_TYPE'] ?? '';
if ($method === 'POST' && stripos($__ctype, 'multipart/form-data') !== false
    && empty($_POST) && empty($_FILES)
    && isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > 0) {
    http_response_code(413);
    jsonError('הקובץ גדול מדי — נא להעלות קובץ עד 64MB');
}

// Auth REQUIRED — per-user media warehouse, no guest fallback.
$GLOBALS['_media_user'] = getAuthUser();
if (empty($GLOBALS['_media_user']) || empty($GLOBALS['_media_user']['id'])) {
    jsonResponse(['ok' => false, 'error' => 'נדרשת התחברות למחסן המדיה', 'auth_required' => true], 401);
}

// File uploads (multipart) handled before JSON parsing.
if ($method === 'POST' && isset($_FILES['file'])) {
    handleUpload();
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$GLOBALS['_media_input'] = $input;
$action = $input['action'] ?? ($_GET['action'] ?? '');

switch ($action) {
    case 'list_folders':    handleListFolders(); break;
    case 'create_folder':   handleCreateFolder($input); break;
    case 'rename_folder':   handleRenameFolder($input); break;
    case 'delete_folder':   handleDeleteFolder($input); break;
    case 'move_folder':     handleMoveFolder($input); break;
    case 'list_media':      handleListMedia($input); break;
    case 'add_link':        handleAddLink($input); break;
    case 'move_media':      handleMoveMedia($input); break;
    case 'delete_media':    handleDeleteMedia($input); break;
    case 'rename_media':    handleRenameMedia($input); break;
    case 'search':          handleSearch($input); break;
    case 'create_shortcut': handleCreateShortcut($input); break;
    case 'get_slide_usage': handleGetSlideUsage($input); break;
    case 'create_tables':   jsonResponse(['ok' => true, 'message' => 'Media tables created']); break;
    default:                jsonError('Unknown action: ' . $action);
}

// ---- Folder handlers ----

function handleListFolders() {
    $user = $GLOBALS['_media_user'];
    jsonResponse(['folders' => MediaStore::apiListFolders($user['id'])]);
}

function handleCreateFolder($input) {
    $user = $GLOBALS['_media_user'];
    $name = trim($input['name'] ?? '');
    if (!$name) jsonError('Folder name required');
    $parentId = isset($input['parent_id']) && $input['parent_id'] !== '' ? (string)$input['parent_id'] : null;
    $r = MediaStore::apiCreateFolder($user['id'], $name, $parentId);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true, 'id' => $r], 201);
}

function handleRenameFolder($input) {
    $user = $GLOBALS['_media_user'];
    $folderId = (string)($input['id'] ?? '');
    $name = trim($input['name'] ?? '');
    if ($folderId === '' || !$name) jsonError('Folder ID and name required');
    $r = MediaStore::apiRenameFolder($user['id'], $folderId, $name);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true]);
}

function handleDeleteFolder($input) {
    $user = $GLOBALS['_media_user'];
    $folderId = (string)($input['id'] ?? '');
    if ($folderId === '') jsonError('Folder ID required');
    $r = MediaStore::apiDeleteFolder($user['id'], $folderId);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true]);
}

function handleMoveFolder($input) {
    $user = $GLOBALS['_media_user'];
    $folderId = (string)($input['id'] ?? '');
    $newParentId = isset($input['parent_id']) && $input['parent_id'] !== '' ? (string)$input['parent_id'] : null;
    if ($folderId === '') jsonError('Folder ID required');
    $r = MediaStore::apiMoveFolder($user['id'], $folderId, $newParentId);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true]);
}

// ---- Media handlers ----

function handleListMedia($input) {
    $user = $GLOBALS['_media_user'];
    $folderId = isset($input['folder_id']) && $input['folder_id'] !== '' ? (string)$input['folder_id'] : null;
    $limit  = isset($input['limit'])  ? max(1, intval($input['limit']))  : 0;
    $offset = isset($input['offset']) ? max(0, intval($input['offset'])) : 0;
    jsonResponse(MediaStore::apiListMedia($user['id'], $folderId, $limit, $offset));
}

function handleAddLink($input) {
    $user = $GLOBALS['_media_user'];
    $title = trim($input['title'] ?? '');
    $url = trim($input['url'] ?? '');
    $folderId = (string)($input['folder_id'] ?? '');
    $mediaType = $input['media_type'] ?? 'video';
    if (!$title || !$url) jsonError('Title and URL required');
    if ($folderId === '') jsonError('Folder ID required');
    if (!in_array($mediaType, ['video', 'audio', 'image'])) jsonError('Invalid media type');
    $r = MediaStore::apiAddLink($user['id'], $title, $url, $folderId, $mediaType);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true, 'id' => $r], 201);
}

function handleUpload() {
    $user = $GLOBALS['_media_user'];
    $title = trim($_POST['title'] ?? '');
    $folderId = (string)($_POST['folder_id'] ?? '');
    $mediaType = $_POST['media_type'] ?? 'audio';
    if (!$title) jsonError('Title required');
    if ($folderId === '') jsonError('Folder ID required');
    if (!in_array($mediaType, ['video', 'audio', 'image'])) jsonError('Invalid media type');

    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        $uploadErrors = [
            UPLOAD_ERR_INI_SIZE   => 'הקובץ גדול מדי (חורג ממגבלת השרת — מקסימום 64MB)',
            UPLOAD_ERR_FORM_SIZE  => 'הקובץ גדול מדי',
            UPLOAD_ERR_PARTIAL    => 'ההעלאה נקטעה — נסה שוב',
            UPLOAD_ERR_NO_FILE    => 'לא נבחר קובץ',
            UPLOAD_ERR_NO_TMP_DIR => 'שגיאת שרת זמנית — נסה שוב',
            UPLOAD_ERR_CANT_WRITE => 'שגיאת שמירה בשרת — נסה שוב',
            UPLOAD_ERR_EXTENSION  => 'סוג הקובץ נחסם בשרת',
        ];
        jsonError($uploadErrors[$file['error']] ?? ('ההעלאה נכשלה (קוד ' . $file['error'] . ')'));
    }
    if ($file['size'] > 64 * 1024 * 1024) jsonError('הקובץ גדול מדי — מקסימום 64MB');

    if (!MediaStore::apiOwnsFolder($user['id'], $folderId)) jsonError('Folder not found');

    // Save the blob to disk (unchanged from the original — filesystem, not DB).
    $uploadDir = __DIR__ . '/uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
    $fileName = 'media_' . $user['id'] . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $filePath = $uploadDir . $fileName;
    if (!move_uploaded_file($file['tmp_name'], $filePath)) {
        jsonError('Failed to save file');
    }
    $relPath = 'uploads/' . $fileName;

    $id = MediaStore::apiAddUpload($user['id'], $title, $folderId, $mediaType, $relPath, $filePath);
    jsonResponse(['ok' => true, 'id' => $id, 'url' => $relPath], 201);
}

function handleMoveMedia($input) {
    $user = $GLOBALS['_media_user'];
    $mediaId = (string)($input['id'] ?? '');
    $newFolderId = (string)($input['folder_id'] ?? '');
    if ($mediaId === '' || $newFolderId === '') jsonError('Media ID and folder ID required');
    $r = MediaStore::apiMoveMedia($user['id'], $mediaId, $newFolderId);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true]);
}

function handleDeleteMedia($input) {
    $user = $GLOBALS['_media_user'];
    $mediaId = (string)($input['id'] ?? '');
    if ($mediaId === '') jsonError('Media ID required');
    $item = MediaStore::apiMediaForDelete($user['id'], $mediaId);
    if (!$item) jsonError('Media not found');
    if ($item['file_path'] && file_exists($item['file_path'])) {
        unlink($item['file_path']);
    }
    MediaStore::apiDeleteMedia($user['id'], $mediaId);
    jsonResponse(['ok' => true]);
}

function handleRenameMedia($input) {
    $user = $GLOBALS['_media_user'];
    $mediaId = (string)($input['id'] ?? '');
    $title = trim($input['title'] ?? '');
    if ($mediaId === '') jsonError('Media ID required');
    if (!$title) jsonError('Title required');
    MediaStore::apiRenameMedia($user['id'], $mediaId, $title);
    jsonResponse(['ok' => true]);
}

function handleSearch($input) {
    $user = $GLOBALS['_media_user'];
    $query = trim($input['query'] ?? '');
    if (!$query) jsonError('Search query required');
    jsonResponse(['items' => MediaStore::apiSearch($user['id'], $query)]);
}

// ---- Shortcut handlers ----

function handleCreateShortcut($input) {
    $user = $GLOBALS['_media_user'];
    $sourceMediaId = (string)($input['source_media_id'] ?? '');
    $targetFolderId = (string)($input['target_folder_id'] ?? '');
    if ($sourceMediaId === '' || $targetFolderId === '') jsonError('source_media_id and target_folder_id required');
    $r = MediaStore::apiCreateShortcut($user['id'], $sourceMediaId, $targetFolderId);
    if (is_array($r) && isset($r['error'])) jsonError($r['error']);
    jsonResponse(['ok' => true, 'id' => $r], 201);
}

function handleGetSlideUsage($input) {
    $user = $GLOBALS['_media_user'];
    $folderId = (string)($input['folder_id'] ?? '');
    if ($folderId === '') jsonError('folder_id required');
    jsonResponse(['items' => MediaStore::apiGetSlideUsage($user['id'], $folderId)]);
}
