<?php
/**
 * ContentOrgJunctionStore — Phase 5b Option B.
 *
 * Faithful MongoDB port of api/content_org_api.php's RELATIONAL org engine,
 * preserving its exact behavior so the HTTP contract is byte-identical. Unlike
 * the embed-model ContentOrgStore (folder_ids[]/tag_ids[] on content docs, used
 * by the 135 adapter tests — left untouched), this store uses REAL junction
 * collections mirroring the original SQLite tables:
 *
 *   folders          — {_id, user_id, parent_id, name, created, updated}
 *   tags             — {_id, user_id, name, namespace}
 *   content_tags     — {content_id, tag_id, store}            (junction)
 *   content_folders  — {content_id, folder_id, store, is_shortcut}  (junction; home=0/shortcut=1)
 *   content_org      — {content_id, store, state, archived_at}  (per-item lifecycle)
 *   folder_shares    — {_id, folder_id, owner_user_id, target_type, target_id, role, token, created, expires_at, revoked_at}
 *   share_recipients — {token, user_id, content_id, content_type, store, role, opened_at, detached_at}
 *
 * Ownership is verified by READING the content / media_items collections (never
 * written here). All ids are ObjectId strings (int-PK→ObjectId decision). Methods
 * return the SAME array shapes / keys as the original org_* helpers.
 *
 * NOTE: in Mongo the content + media collections live in ONE database, so the
 * original "media DB unavailable" branch (org returned 'מאגר המדיה לא זמין') is
 * unreachable — media is always queryable. Documented in MONGO_PORT_PROGRESS.md.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

class ContentOrgJunctionStore
{
    const NAMESPACES   = ['subject', 'difficulty', 'free'];
    const STORES       = ['content', 'media'];
    const SHARE_ROLES  = ['practice', 'view', 'edit'];
    const SHARE_TARGETS = ['link', 'user', 'group', 'email'];
    const TTL_DEFAULT  = 2592000; // 30 days
    const TTL_MAX      = 7776000; // 90 days

    private static bool $indexesEnsured = false;

    private static function col(string $name): \MongoDB\Collection
    {
        $c = MongoStore::getInstance()->getCollection($name);
        if (!self::$indexesEnsured) {
            self::$indexesEnsured = true;
            try { self::ensureIndexes(); } catch (\Throwable $e) { error_log('ContentOrgJunctionStore::ensureIndexes: ' . $e->getMessage()); }
        }
        return $c;
    }

    public static function ensureIndexes(): void
    {
        self::col('content_folders')->createIndex(['folder_id' => 1]);
        self::col('content_folders')->createIndex(['store' => 1, 'content_id' => 1]);
        self::col('content_tags')->createIndex(['tag_id' => 1]);
        self::col('content_tags')->createIndex(['store' => 1, 'content_id' => 1]);
        self::col('content_org')->createIndex(['store' => 1, 'content_id' => 1], ['unique' => true]);
        self::col('folders')->createIndex(['user_id' => 1, 'parent_id' => 1]);
        self::col('tags')->createIndex(['user_id' => 1, 'namespace' => 1]);
        self::col('folder_shares')->createIndex(['folder_id' => 1]);
        self::col('share_recipients')->createIndex(['token' => 1, 'user_id' => 1], ['unique' => true]);
        self::col('share_recipients')->createIndex(['user_id' => 1, 'detached_at' => 1]);
    }

    // --------------------------------------------------------------- helpers

    private static function now(): string { return gmdate('Y-m-d H:i:s'); }

    private static function fmt($d): ?string
    {
        if ($d instanceof UTCDateTime) return $d->toDateTime()->format('Y-m-d H:i:s');
        return $d === null ? null : (string)$d;
    }

    public static function normalizeStore($store): ?string
    {
        $store = $store ? (string)$store : 'content';
        return in_array($store, self::STORES, true) ? $store : null;
    }

    /** Read-only ownership against content collection. */
    public static function ownsContent(string $userId, string $contentId): bool
    {
        try {
            return self::col('content')->countDocuments(['_id' => new ObjectId($contentId), 'user_id' => $userId]) > 0;
        } catch (\Exception $e) { return false; }
    }

    /** Read-only ownership against media_items collection. */
    public static function ownsMedia(string $userId, string $mediaId): bool
    {
        try {
            return self::col('media_items')->countDocuments(['_id' => new ObjectId($mediaId), 'user_id' => $userId]) > 0;
        } catch (\Exception $e) { return false; }
    }

    /** Returns true (owned) or ['error'=>...] (mirrors org_owner_gate). */
    public static function ownerGate(string $userId, string $store, string $itemId)
    {
        if ($store === 'content') {
            return self::ownsContent($userId, $itemId) ? true : ['error' => 'הפריט לא שייך למשתמש'];
        }
        if ($store === 'media') {
            return self::ownsMedia($userId, $itemId) ? true : ['error' => 'הפריט לא שייך למשתמש'];
        }
        return ['error' => 'הפריט לא שייך למשתמש'];
    }

    // --------------------------------------------------------------- tags

    public static function createTag(string $userId, $name, $namespace)
    {
        $name = trim((string)$name);
        if ($name === '') return ['error' => 'שם תג חובה'];
        if (!in_array($namespace, self::NAMESPACES, true)) return ['error' => 'namespace לא תקין (subject/difficulty/free)'];
        $dup = self::col('tags')->findOne(['user_id' => $userId, 'name' => $name, 'namespace' => $namespace]);
        if ($dup) return ['id' => (string)$dup['_id'], 'deduped' => true];
        $r = self::col('tags')->insertOne(['user_id' => $userId, 'name' => $name, 'namespace' => $namespace]);
        return ['id' => (string)$r->getInsertedId(), 'deduped' => false];
    }

    public static function listTags(string $userId, ?string $namespace = null): array
    {
        $filter = ['user_id' => $userId];
        if ($namespace) $filter['namespace'] = $namespace;
        $cursor = self::col('tags')->find($filter, ['sort' => ['namespace' => 1, 'name' => 1]]);
        $out = [];
        foreach ($cursor as $r) {
            $out[] = ['id' => (string)$r['_id'], 'name' => $r['name'] ?? '', 'namespace' => $r['namespace'] ?? ''];
        }
        return $out;
    }

    public static function ownsTag(string $userId, string $tagId): bool
    {
        try {
            return self::col('tags')->countDocuments(['_id' => new ObjectId($tagId), 'user_id' => $userId]) > 0;
        } catch (\Exception $e) { return false; }
    }

    public static function tagItem(string $userId, string $contentId, string $tagId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        if (!self::ownsTag($userId, $tagId)) return ['error' => 'התג לא שייך למשתמש'];
        $exists = self::col('content_tags')->countDocuments(['store' => $store, 'content_id' => $contentId, 'tag_id' => $tagId]);
        if ($exists > 0) return ['ok' => true, 'deduped' => true];
        self::col('content_tags')->insertOne(['content_id' => $contentId, 'tag_id' => $tagId, 'store' => $store]);
        return ['ok' => true, 'deduped' => false];
    }

    public static function untagItem(string $userId, string $contentId, string $tagId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        $res = self::col('content_tags')->deleteMany(['store' => $store, 'content_id' => $contentId, 'tag_id' => $tagId]);
        return ['ok' => true, 'removed' => $res->getDeletedCount()];
    }

    // --------------------------------------------------------------- folders

    public static function getFolder(string $userId, string $folderId): ?array
    {
        try {
            $row = self::col('folders')->findOne(['_id' => new ObjectId($folderId), 'user_id' => $userId]);
        } catch (\Exception $e) { return null; }
        if (!$row) return null;
        return [
            'id' => (string)$row['_id'],
            'user_id' => $row['user_id'] ?? '',
            'parent_id' => $row['parent_id'] ?? null,
            'name' => $row['name'] ?? '',
        ];
    }

    public static function createFolder(string $userId, $name, $parentId = null)
    {
        $name = trim((string)$name);
        if ($name === '') return ['error' => 'שם תיקייה חובה'];
        if ($parentId !== null && $parentId !== '') {
            $parentId = (string)$parentId;
            if (!self::getFolder($userId, $parentId)) return ['error' => 'תיקיית אב לא נמצאה'];
        } else {
            $parentId = null;
        }
        $now = self::now();
        $r = self::col('folders')->insertOne([
            'user_id' => $userId, 'parent_id' => $parentId, 'name' => $name, 'created' => $now, 'updated' => $now,
        ]);
        return ['id' => (string)$r->getInsertedId()];
    }

    public static function listFolders(string $userId): array
    {
        $cursor = self::col('folders')->find(['user_id' => $userId], ['sort' => ['parent_id' => 1, 'name' => 1]]);
        $out = [];
        foreach ($cursor as $r) {
            $out[] = [
                'id' => (string)$r['_id'],
                'parent_id' => $r['parent_id'] ?? null,
                'name' => $r['name'] ?? '',
                'created' => self::fmt($r['created'] ?? null),
                'updated' => self::fmt($r['updated'] ?? null),
            ];
        }
        return $out;
    }

    public static function renameFolder(string $userId, string $folderId, $name)
    {
        $name = trim((string)$name);
        if ($name === '') return ['error' => 'שם תיקייה חובה'];
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        self::col('folders')->updateOne(
            ['_id' => new ObjectId($folderId), 'user_id' => $userId],
            ['$set' => ['name' => $name, 'updated' => self::now()]]
        );
        return ['ok' => true];
    }

    public static function moveFolder(string $userId, string $folderId, $newParentId)
    {
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        if ($newParentId !== null && $newParentId !== '') {
            $newParentId = (string)$newParentId;
            if (!self::getFolder($userId, $newParentId)) return ['error' => 'תיקיית אב לא נמצאה'];
            if ($newParentId === $folderId) return ['error' => 'אי אפשר להעביר תיקייה לתוך עצמה'];
            // Cycle check: walk ancestors of the new parent.
            $checkId = $newParentId; $guard = 0;
            while ($checkId && $guard++ < 1000) {
                $f = self::getFolder($userId, $checkId);
                if (!$f) break;
                $p = $f['parent_id'] !== null ? (string)$f['parent_id'] : null;
                if ($p === $folderId) return ['error' => 'אי אפשר להעביר תיקייה לתוך צאצא שלה'];
                $checkId = $p;
            }
        } else {
            $newParentId = null;
        }
        self::col('folders')->updateOne(
            ['_id' => new ObjectId($folderId), 'user_id' => $userId],
            ['$set' => ['parent_id' => $newParentId, 'updated' => self::now()]]
        );
        return ['ok' => true];
    }

    public static function deleteFolder(string $userId, string $folderId)
    {
        $folder = self::getFolder($userId, $folderId);
        if (!$folder) return ['error' => 'תיקייה לא נמצאה'];
        $parentId = $folder['parent_id'] !== null ? (string)$folder['parent_id'] : null;

        // Re-parent child folders to this folder's parent (no orphans).
        $rep = self::col('folders')->updateMany(
            ['parent_id' => $folderId, 'user_id' => $userId],
            ['$set' => ['parent_id' => $parentId]]
        );
        $reparented = $rep->getModifiedCount();

        // UNFILE items: remove this folder's content_folders rows (content never deleted).
        $unf = self::col('content_folders')->deleteMany(['folder_id' => $folderId]);
        $unfiled = $unf->getDeletedCount();

        // Drop any shares for the folder.
        self::col('folder_shares')->deleteMany(['folder_id' => $folderId, 'owner_user_id' => $userId]);

        // Delete the folder.
        self::col('folders')->deleteOne(['_id' => new ObjectId($folderId), 'user_id' => $userId]);

        return ['ok' => true, 'unfiled' => $unfiled, 'reparented_children' => $reparented];
    }

    // --------------------------------------------------- membership (home/shortcut)

    public static function addToFolder(string $userId, string $contentId, string $folderId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];

        $cf = self::col('content_folders');
        $existing = $cf->findOne(['store' => $store, 'content_id' => $contentId, 'folder_id' => $folderId]);
        if ($existing) {
            if ((int)($existing['is_shortcut'] ?? 0) === 0) {
                return ['ok' => true, 'home_folder_id' => $folderId, 'deduped' => true];
            }
            // Was a shortcut here → promote to home; demote any other home of this item.
            $cf->updateMany(['store' => $store, 'content_id' => $contentId, 'folder_id' => $folderId], ['$set' => ['is_shortcut' => 0]]);
            $cf->updateMany(['store' => $store, 'content_id' => $contentId, 'folder_id' => ['$ne' => $folderId], 'is_shortcut' => 0], ['$set' => ['is_shortcut' => 1]]);
            return ['ok' => true, 'home_folder_id' => $folderId, 'moved' => true];
        }
        // One-home rule: if a home exists elsewhere (same store), MOVE it here.
        $homeRow = $cf->findOne(['store' => $store, 'content_id' => $contentId, 'is_shortcut' => 0]);
        if ($homeRow) {
            $cf->updateMany(['store' => $store, 'content_id' => $contentId, 'is_shortcut' => 0], ['$set' => ['folder_id' => $folderId]]);
            return ['ok' => true, 'home_folder_id' => $folderId, 'moved' => true];
        }
        $cf->insertOne(['content_id' => $contentId, 'folder_id' => $folderId, 'store' => $store, 'is_shortcut' => 0]);
        return ['ok' => true, 'home_folder_id' => $folderId];
    }

    public static function addShortcut(string $userId, string $contentId, string $folderId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        $cf = self::col('content_folders');
        if ($cf->countDocuments(['store' => $store, 'content_id' => $contentId, 'folder_id' => $folderId]) > 0) {
            return ['ok' => true, 'deduped' => true];
        }
        $cf->insertOne(['content_id' => $contentId, 'folder_id' => $folderId, 'store' => $store, 'is_shortcut' => 1]);
        return ['ok' => true];
    }

    public static function removeFromFolder(string $userId, string $contentId, string $folderId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        $res = self::col('content_folders')->deleteMany(['store' => $store, 'content_id' => $contentId, 'folder_id' => $folderId]);
        return ['ok' => true, 'removed' => $res->getDeletedCount()];
    }

    private static function isArchived(string $store, string $contentId): bool
    {
        $row = self::col('content_org')->findOne(['store' => $store, 'content_id' => $contentId]);
        return $row && ($row['state'] ?? '') === 'archived';
    }

    public static function listFolderItems(string $userId, string $folderId, bool $includeArchived = false)
    {
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        $cursor = self::col('content_folders')->find(['folder_id' => $folderId]);
        $items = [];
        foreach ($cursor as $row) {
            $store = $row['store'] ?? 'content';
            $iid = (string)($row['content_id'] ?? '');
            $isSc = (int)($row['is_shortcut'] ?? 0);
            if (!$includeArchived && self::isArchived($store, $iid)) continue;
            if ($store === 'content') {
                try { $c = self::col('content')->findOne(['_id' => new ObjectId($iid), 'user_id' => $userId]); }
                catch (\Exception $e) { $c = null; }
                if (!$c) continue;
                $items[] = ['id' => $iid, 'store' => 'content', 'content_type' => $c['content_type'] ?? '',
                            'title' => $c['title'] ?? '', 'color' => $c['color'] ?? '',
                            'updated' => self::fmt($c['updated_at'] ?? ($c['updated'] ?? null)), 'is_shortcut' => $isSc];
            } elseif ($store === 'media') {
                try { $m = self::col('media_items')->findOne(['_id' => new ObjectId($iid), 'user_id' => $userId]); }
                catch (\Exception $e) { $m = null; }
                if (!$m) continue;
                $items[] = ['id' => $iid, 'store' => 'media', 'content_type' => $m['media_type'] ?? '',
                            'title' => $m['title'] ?? '', 'color' => '',
                            'updated' => self::fmt($m['created_at'] ?? ($m['created'] ?? null)), 'is_shortcut' => $isSc];
            }
        }
        usort($items, function ($a, $b) {
            return ($a['is_shortcut'] <=> $b['is_shortcut']) ?: strcmp((string)$b['updated'], (string)$a['updated']);
        });
        return ['items' => $items];
    }

    // --------------------------------------------------------------- archive

    public static function archiveItem(string $userId, string $contentId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        $now = self::now();
        self::col('content_org')->updateOne(
            ['store' => $store, 'content_id' => $contentId],
            ['$set' => ['state' => 'archived', 'archived_at' => $now, 'content_id' => $contentId, 'store' => $store]],
            ['upsert' => true]
        );
        return ['ok' => true, 'state' => 'archived', 'archived_at' => $now];
    }

    public static function restoreItem(string $userId, string $contentId, $store = 'content')
    {
        $store = self::normalizeStore($store);
        if ($store === null) return ['error' => 'store לא תקין'];
        $gate = self::ownerGate($userId, $store, $contentId);
        if ($gate !== true) return $gate;
        self::col('content_org')->updateOne(
            ['store' => $store, 'content_id' => $contentId],
            ['$set' => ['state' => 'live', 'archived_at' => null, 'content_id' => $contentId, 'store' => $store]],
            ['upsert' => true]
        );
        return ['ok' => true, 'state' => 'live'];
    }

    // --------------------------------------------------------------- search

    public static function searchContent(string $userId, array $params): array
    {
        $scope      = $params['scope'] ?? 'all';
        $folderId   = isset($params['folder_id']) ? (string)$params['folder_id'] : null;
        $subject    = isset($params['subject']) ? trim((string)$params['subject']) : '';
        $difficulty = isset($params['difficulty']) ? trim((string)$params['difficulty']) : '';
        $q          = isset($params['q']) ? trim((string)$params['q']) : '';
        $tags       = (isset($params['tags']) && is_array($params['tags']))
                        ? array_values(array_filter(array_map('strval', $params['tags']), fn($x) => $x !== ''))
                        : [];
        $includeArchived = !empty($params['include_archived']);

        // ---- content store ----
        $contentFilter = ['user_id' => $userId];
        if ($subject !== '') $contentFilter['content_type'] = $subject;
        if ($q !== '') $contentFilter['title'] = new \MongoDB\BSON\Regex(preg_quote($q), 'i');

        // scope=folder → restrict to content ids in folder via content_folders (store=content)
        $folderContentIds = null;
        if ($scope === 'folder' && $folderId) {
            $folderContentIds = [];
            foreach (self::col('content_folders')->find(['folder_id' => $folderId, 'store' => 'content']) as $cf) {
                $folderContentIds[] = (string)($cf['content_id'] ?? '');
            }
            $folderContentIds = array_values(array_unique($folderContentIds));
        }

        // difficulty → a difficulty-namespace tag with that name
        $requiredTagIds = $tags;
        if ($difficulty !== '') {
            $diffTagIds = [];
            foreach (self::col('tags')->find(['user_id' => $userId, 'namespace' => 'difficulty', 'name' => $difficulty]) as $dt) {
                $diffTagIds[] = (string)$dt['_id'];
            }
            if (empty($diffTagIds)) {
                $requiredTagIds[] = '__no_such_difficulty__'; // matches nothing
            } else {
                // difficulty matches ANY of the named difficulty tags → expand via OR on content set
                $requiredTagIds = array_merge($requiredTagIds, $diffTagIds);
            }
        }

        // AND-match tag ids → content ids carrying ALL required tags (store=content)
        $tagMatchedContentIds = null;
        $contentRequired = $tags; // tags[] AND-match for content store
        if (!empty($contentRequired) || $difficulty !== '') {
            // Build the AND requirement for content store: tags[] are all required;
            // difficulty is satisfied by ANY of its tag ids.
            $tagMatchedContentIds = self::contentIdsWithTags('content', $tags, $difficulty !== '' ? ($diffTagIds ?? []) : null, $difficulty !== '');
        }

        $out = [];
        // Only run the content query when subject/q/folder/tags conditions are coherent.
        $runContent = true;
        if (($difficulty !== '' && isset($diffTagIds) && empty($diffTagIds))) {
            // difficulty requested but no such tag → no content matches via difficulty
            if ($subject === '' && $q === '' && empty($tags) && $scope !== 'folder') $runContent = false;
        }

        if ($runContent) {
            if ($tagMatchedContentIds !== null) {
                if (empty($tagMatchedContentIds)) {
                    $runContent = false;
                } else {
                    $ids = [];
                    foreach ($tagMatchedContentIds as $sid) { try { $ids[] = new ObjectId($sid); } catch (\Exception $e) {} }
                    $contentFilter['_id'] = ['$in' => $ids];
                }
            }
            if ($folderContentIds !== null) {
                if (empty($folderContentIds)) { $runContent = false; }
                else {
                    $ids = [];
                    foreach ($folderContentIds as $sid) { try { $ids[] = new ObjectId($sid); } catch (\Exception $e) {} }
                    if (isset($contentFilter['_id']['$in'])) {
                        // intersect with tag-matched set
                        $existing = array_map('strval', $contentFilter['_id']['$in']);
                        $inter = array_values(array_intersect(array_map('strval', $ids), $existing));
                        $contentFilter['_id'] = ['$in' => array_map(fn($s) => new ObjectId($s), $inter)];
                        if (empty($inter)) $runContent = false;
                    } else {
                        $contentFilter['_id'] = ['$in' => $ids];
                    }
                }
            }
        }

        if ($runContent) {
            $cursor = self::col('content')->find($contentFilter, ['sort' => ['updated_at' => -1]]);
            foreach ($cursor as $c) {
                $cid = (string)$c['_id'];
                if (!$includeArchived && self::isArchived('content', $cid)) continue;
                $out[] = [
                    'id' => $cid, 'store' => 'content',
                    'content_type' => $c['content_type'] ?? '',
                    'title' => $c['title'] ?? '',
                    'color' => $c['color'] ?? '',
                    'updated' => self::fmt($c['updated_at'] ?? ($c['updated'] ?? null)),
                ];
            }
        }

        // ---- media-store augmentation (scope=all, no subject, tag/difficulty filter) ----
        if ($scope === 'all' && $subject === '' && ($difficulty !== '' || count($tags) > 0)) {
            $required = $tags;
            $diffOk = true;
            if ($difficulty !== '') {
                $dids = $diffTagIds ?? [];
                if (empty($dids)) { $diffOk = false; }
                else { $required = array_merge($required, $dids); }
            }
            $required = array_values(array_unique(array_filter($required, fn($x) => $x !== null && $x !== '')));
            if ($diffOk && count($required) > 0) {
                $mediaIds = self::contentIdsWithTags('media', $tags, $difficulty !== '' ? ($diffTagIds ?? []) : null, $difficulty !== '');
                foreach ($mediaIds as $mid) {
                    if (!$includeArchived && self::isArchived('media', $mid)) continue;
                    try { $m = self::col('media_items')->findOne(['_id' => new ObjectId($mid), 'user_id' => $userId]); }
                    catch (\Exception $e) { $m = null; }
                    if (!$m) continue;
                    $out[] = [
                        'id' => $mid, 'store' => 'media',
                        'content_type' => $m['media_type'] ?? '',
                        'title' => $m['title'] ?? '',
                        'color' => '',
                        'updated' => self::fmt($m['created_at'] ?? ($m['created'] ?? null)),
                    ];
                }
            }
        }

        return $out;
    }

    /**
     * Content ids (within $store) carrying ALL of $andTags, and (if $useDiff)
     * ALSO at least one of $diffTags (difficulty = OR over its tag ids). Mirrors
     * the original's AND-match + difficulty-tag join.
     */
    private static function contentIdsWithTags(string $store, array $andTags, ?array $diffTags, bool $useDiff): array
    {
        // Gather candidate content_ids per tag.
        $sets = [];
        foreach ($andTags as $t) {
            $ids = [];
            foreach (self::col('content_tags')->find(['store' => $store, 'tag_id' => (string)$t]) as $ct) {
                $ids[$ct['content_id']] = true;
            }
            $sets[] = array_keys($ids);
        }
        if ($useDiff) {
            $ids = [];
            foreach (($diffTags ?? []) as $t) {
                foreach (self::col('content_tags')->find(['store' => $store, 'tag_id' => (string)$t]) as $ct) {
                    $ids[$ct['content_id']] = true;
                }
            }
            $sets[] = array_keys($ids); // difficulty as one more required set (OR within it)
        }
        if (empty($sets)) return [];
        $result = $sets[0];
        for ($i = 1; $i < count($sets); $i++) {
            $result = array_values(array_intersect($result, $sets[$i]));
        }
        return array_values(array_unique(array_map('strval', $result)));
    }

    // --------------------------------------------------------------- folder shares

    public static function createFolderShare(string $userId, string $folderId, $targetType, $targetId, $role, $ttlSecs = null)
    {
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        $targetType = $targetType ?: 'link';
        if (!in_array($targetType, self::SHARE_TARGETS, true)) return ['error' => 'target_type לא תקין'];
        $role = $role ?: 'view';
        if (!in_array($role, self::SHARE_ROLES, true)) return ['error' => 'role לא תקין'];
        if ($ttlSecs === null) $ttlSecs = self::TTL_DEFAULT;
        $ttlSecs = (int)$ttlSecs;
        if ($ttlSecs <= 0) $ttlSecs = self::TTL_DEFAULT;
        if ($ttlSecs > self::TTL_MAX) $ttlSecs = self::TTL_MAX;
        $token = bin2hex(random_bytes(16));
        $now = time();
        $created = gmdate('Y-m-d H:i:s', $now);
        $expires = gmdate('Y-m-d H:i:s', $now + $ttlSecs);
        $r = self::col('folder_shares')->insertOne([
            'folder_id' => $folderId, 'owner_user_id' => $userId, 'target_type' => $targetType,
            'target_id' => $targetId !== null ? (string)$targetId : null, 'role' => $role,
            'token' => $token, 'created' => $created, 'expires_at' => $expires, 'revoked_at' => null,
        ]);
        return ['id' => (string)$r->getInsertedId(), 'token' => $token, 'expires_at' => $expires, 'role' => $role];
    }

    public static function listFolderShares(string $userId, string $folderId)
    {
        if (!self::getFolder($userId, $folderId)) return ['error' => 'תיקייה לא נמצאה'];
        $cursor = self::col('folder_shares')->find(
            ['folder_id' => $folderId, 'owner_user_id' => $userId, 'revoked_at' => null],
            ['sort' => ['created' => -1]]
        );
        $out = [];
        foreach ($cursor as $r) {
            $out[] = [
                'id' => (string)$r['_id'], 'folder_id' => (string)($r['folder_id'] ?? ''),
                'target_type' => $r['target_type'] ?? null, 'target_id' => $r['target_id'] ?? null,
                'role' => $r['role'] ?? null, 'token' => $r['token'] ?? null,
                'created' => self::fmt($r['created'] ?? null), 'expires_at' => self::fmt($r['expires_at'] ?? null),
                'revoked_at' => self::fmt($r['revoked_at'] ?? null),
            ];
        }
        return ['shares' => $out];
    }

    public static function revokeFolderShare(string $userId, string $shareId)
    {
        try { $exists = self::col('folder_shares')->findOne(['_id' => new ObjectId($shareId), 'owner_user_id' => $userId]); }
        catch (\Exception $e) { $exists = null; }
        if (!$exists) return ['error' => 'שיתוף לא נמצא'];
        if (($exists['revoked_at'] ?? null) === null) {
            self::col('folder_shares')->updateOne(
                ['_id' => new ObjectId($shareId), 'owner_user_id' => $userId],
                ['$set' => ['revoked_at' => self::now()]]
            );
        }
        return ['ok' => true, 'revoked' => true];
    }

    public static function foldersSharedWithMe(array $me)
    {
        $uid = (string)$me['id'];
        $email = (string)($me['email'] ?? '');
        $nowStr = self::now();
        $targetMatch = [$uid];
        if ($email !== '') $targetMatch[] = $email;
        $cursor = self::col('folder_shares')->find([
            'target_type' => 'user',
            'target_id' => ['$in' => $targetMatch],
            'revoked_at' => null,
            '$or' => [['expires_at' => null], ['expires_at' => ['$gt' => $nowStr]]],
        ], ['sort' => ['created' => -1]]);
        $out = [];
        foreach ($cursor as $r) {
            $fid = (string)($r['folder_id'] ?? '');
            $fname = '';
            try { $f = self::col('folders')->findOne(['_id' => new ObjectId($fid)]); $fname = $f['name'] ?? ''; }
            catch (\Exception $e) {}
            $out[] = [
                'share_id' => (string)$r['_id'], 'folder_id' => $fid, 'folder_name' => $fname,
                'owner_user_id' => (string)($r['owner_user_id'] ?? ''), 'role' => $r['role'] ?? '',
                'created' => self::fmt($r['created'] ?? null), 'expires_at' => self::fmt($r['expires_at'] ?? null),
            ];
        }
        return ['folders' => $out];
    }

    // --------------------------------------------------- recipient-side shares

    public static function openShare(string $userId, $token)
    {
        $token = trim((string)$token);
        if ($token === '') return ['error' => 'token חובה'];
        $share = self::col('content_shares')->findOne(['token' => $token]);
        if (!$share) return ['error' => 'שיתוף לא נמצא'];
        if (!empty($share['revoked_at'])) return ['error' => 'השיתוף בוטל'];
        $exp = $share['expires_at'] ?? null;
        if (!empty($exp)) {
            $expTs = ($exp instanceof UTCDateTime) ? $exp->toDateTime()->getTimestamp() : strtotime((string)$exp);
            if ($expTs !== false && $expTs < time()) return ['error' => 'השיתוף פג תוקף'];
        }
        $cid = (string)($share['content_id'] ?? '');
        $ctype = $share['content_type'] ?? null;
        $role = $share['role'] ?: 'view';
        $store = 'content';
        $title = '';
        try { $c = self::col('content')->findOne(['_id' => new ObjectId($cid)]); if ($c) $title = $c['title'] ?? ''; }
        catch (\Exception $e) {}
        // Idempotent upsert of the recipient row (re-open clears detached_at).
        self::col('share_recipients')->updateOne(
            ['token' => $token, 'user_id' => $userId],
            ['$set' => [
                'token' => $token, 'user_id' => $userId, 'content_id' => $cid, 'content_type' => $ctype,
                'store' => $store, 'role' => $role, 'detached_at' => null,
            ], '$setOnInsert' => ['opened_at' => self::now()]],
            ['upsert' => true]
        );
        return ['ok' => true, 'content_type' => $ctype, 'id' => $cid, 'title' => $title, 'role' => $role, 'store' => $store];
    }

    public static function detachShare(string $userId, $token)
    {
        $token = trim((string)$token);
        if ($token === '') return ['error' => 'token חובה'];
        $row = self::col('share_recipients')->findOne(['token' => $token, 'user_id' => $userId]);
        if (!$row) return ['error' => 'שיתוף לא נמצא אצל המשתמש'];
        $res = self::col('share_recipients')->updateOne(
            ['token' => $token, 'user_id' => $userId, 'detached_at' => null],
            ['$set' => ['detached_at' => self::now()]]
        );
        return ['ok' => true, 'detached' => $res->getModifiedCount()];
    }

    public static function mySharedItems(string $userId)
    {
        $cursor = self::col('share_recipients')->find(
            ['user_id' => $userId, 'detached_at' => null],
            ['sort' => ['opened_at' => -1]]
        );
        $out = [];
        foreach ($cursor as $r) {
            $store = $r['store'] ?? 'content';
            $cid = (string)($r['content_id'] ?? '');
            $title = '';
            if ($store === 'content') {
                try { $c = self::col('content')->findOne(['_id' => new ObjectId($cid)]); $title = $c ? ($c['title'] ?? '') : ''; }
                catch (\Exception $e) {}
            } elseif ($store === 'media') {
                try { $m = self::col('media_items')->findOne(['_id' => new ObjectId($cid)]); $title = $m ? ($m['title'] ?? '') : ''; }
                catch (\Exception $e) {}
            }
            $out[] = [
                'store' => $store, 'id' => $cid, 'content_type' => $r['content_type'] ?? null,
                'title' => $title, 'role' => $r['role'] ?? '', 'opened_at' => self::fmt($r['opened_at'] ?? null),
                'token' => $r['token'] ?? '',
            ];
        }
        return ['items' => $out];
    }
}
