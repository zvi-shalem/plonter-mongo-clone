<?php
/**
 * auth_common.php — shared auth + JSON primitives (Phase 5b Mongo shim).
 *
 * The clone never carried the original auth_common.php; this MongoDB-backed shim
 * provides the same primitives the vocab-share files (and other callers) expect,
 * routed through AuthStore instead of a SQLite handle:
 *   respond($ok, $errorOrData)  — {success:true,...data} / {success:false,error}
 *   getToken()                  — bearer / token / body session token
 *   getUserFromToken($token)    — uid (ObjectId string) or null
 *   requireAuth()               — uid or respond(false,'נדרשת התחברות')+exit
 *   authUserEmail($uid) / authUserRole($uid) — profile lookups via AuthStore
 *   authAllUsers()              — id→display-name map (for owner-name listings)
 *
 * NOTE: ids are ObjectId strings (int→ObjectId decision). Loaded once per request.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../mongo_adapter/AuthStore.php';

if (!function_exists('respond')) {
    function respond($ok, $errorOrData = '', $data = []) {
        if ($ok) {
            echo json_encode(array_merge(['success' => true], is_array($errorOrData) ? $errorOrData : $data), JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode(['success' => false, 'error' => is_string($errorOrData) ? $errorOrData : ''], JSON_UNESCAPED_UNICODE);
        }
        exit;
    }
}

if (!function_exists('getToken')) {
    function getToken() {
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (strpos($auth, 'Bearer ') === 0) return substr($auth, 7);
        if (isset($_GET['token'])) return (string)$_GET['token'];
        if (isset($_POST['token'])) return (string)$_POST['token'];
        $raw = file_get_contents('php://input');
        $body = $raw ? (json_decode($raw, true) ?: []) : [];
        return (string)($body['token'] ?? '');
    }
}

if (!function_exists('getUserFromToken')) {
    function getUserFromToken($token) {
        if (!$token) return null;
        $me = AuthStore::findUserBySessionToken((string)$token);
        return $me ? $me['id'] : null;
    }
}

if (!function_exists('requireAuth')) {
    function requireAuth() {
        $uid = getUserFromToken(getToken());
        if (!$uid) respond(false, 'נדרשת התחברות');
        return $uid;
    }
}

if (!function_exists('authUserEmail')) {
    function authUserEmail($uid) {
        if (!$uid) return '';
        $u = AuthStore::getUserById((string)$uid);
        return $u ? strtolower(trim((string)($u['email'] ?? ''))) : '';
    }
}

if (!function_exists('authUserRole')) {
    function authUserRole($uid) {
        if (!$uid) return '';
        $u = AuthStore::getUserById((string)$uid);
        return $u ? trim((string)($u['role'] ?? '')) : '';
    }
}

if (!function_exists('authAllUsers')) {
    /** Map of user id (string) → display name (first+last, else email-local, else user#id). */
    function authAllUsers() {
        $map = [];
        foreach (AuthStore::listFullUsers() as $u) {
            $id = (string)($u['id'] ?? '');
            $name = trim((string)($u['first_name'] ?? '') . ' ' . (string)($u['last_name'] ?? ''));
            if ($name === '') {
                $em = (string)($u['email'] ?? '');
                $at = strpos($em, '@');
                $name = $at !== false ? substr($em, 0, $at) : ($em ?: ('user#' . $id));
            }
            $map[$id] = $name;
        }
        return $map;
    }
}
