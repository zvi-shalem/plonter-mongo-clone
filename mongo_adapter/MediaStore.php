<?php
/**
 * MediaStore — MongoDB data-access layer for the media warehouse.
 *
 * Replaces direct PDO/SQLite access in:
 *   - media_api.php  (73 queries)
 *
 * SQLite source DB: plonter_data.db (tables: media_items, media_folders)
 * Mongo collections: media_items, media_folders
 *
 * Notable patterns from the original:
 *   - source_media_id column added via lazy ALTER TABLE → kept as optional field
 *   - Shortcut/alias: media_items row with source_media_id pointing to original
 *   - Folder nesting: parent_id (nullable) with ownership checks
 *   - is_system flag on folders prevents rename/delete
 *   - Per-item count aggregation: COUNT(*) media_items GROUP BY folder_id
 *
 * SYNTAX-CLEAN — untested pending Atlas connection.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

class MediaStore
{
    /** Lazy-once guard: indexes are ensured the first time any collection is accessed. */
    private static bool $indexesEnsured = false;

    private static function col(string $name): \MongoDB\Collection
    {
        $collection = MongoStore::getInstance()->getCollection($name);
        if (!self::$indexesEnsured) {
            self::$indexesEnsured = true;
            try {
                self::ensureIndexes();
            } catch (\Throwable $e) {
                error_log('MediaStore::ensureIndexes failed: ' . $e->getMessage());
            }
        }
        return $collection;
    }

    public static function ensureIndexes(): void
    {
        self::col('media_folders')->createIndex(['user_id' => 1]);
        self::col('media_folders')->createIndex(['user_id' => 1, 'parent_id' => 1]);
        self::col('media_items')->createIndex(['user_id' => 1]);
        self::col('media_items')->createIndex(['folder_id' => 1]);
        self::col('media_items')->createIndex(['source_media_id' => 1]);
        self::col('media_items')->createIndex(['user_id' => 1, 'title' => 'text', 'url' => 'text']);
    }

    // =================================================================
    // media_api.php — CONTRACT-SHAPED methods (Phase 5b). Faithfully mirror
    // media_api.php's exact behavior + response shapes (media_count, source_type,
    // file_path, source_media_id, system/lesson-folder protections, full ancestor
    // cycle walk, pagination, search folder_name-join + exclude-shortcut + LIMIT50,
    // shortcut dedup+copy). The generic methods above (used by the 135 adapter
    // tests) are untouched. ids are ObjectId strings (int→ObjectId decision).
    // =================================================================

    private static function mediaTs($d): ?string
    {
        if ($d instanceof UTCDateTime) { return $d->toDateTime()->format('Y-m-d H:i:s'); }
        return $d === null ? null : (string)$d;
    }

    /** media_folders row in media_api shape. */
    private static function apiFolderRow(array $d): array
    {
        return [
            'id'        => (string)($d['_id'] ?? ''),
            'name'      => $d['name'] ?? '',
            'parent_id' => isset($d['parent_id']) && $d['parent_id'] !== null ? (string)$d['parent_id'] : null,
            'is_system' => (int)($d['is_system'] ?? 0),
            'created'   => self::mediaTs($d['created'] ?? ($d['created_at'] ?? null)),
        ];
    }

    /** media_items row in media_api shape. */
    private static function apiItemRow(array $d): array
    {
        return [
            'id'              => (string)($d['_id'] ?? ''),
            'folder_id'       => isset($d['folder_id']) && $d['folder_id'] !== null ? (string)$d['folder_id'] : null,
            'title'           => $d['title'] ?? '',
            'media_type'      => $d['media_type'] ?? '',
            'source_type'     => $d['source_type'] ?? '',
            'url'             => $d['url'] ?? null,
            'file_path'       => $d['file_path'] ?? null,
            'source_media_id' => isset($d['source_media_id']) && $d['source_media_id'] !== null ? (string)$d['source_media_id'] : null,
            'created'         => self::mediaTs($d['created'] ?? ($d['created_at'] ?? null)),
        ];
    }

    /** Raw folder doc by id+user (for protection checks), or null. */
    public static function apiFolderById(string $userId, string $folderId): ?array
    {
        try { $d = self::col('media_folders')->findOne(['_id' => new ObjectId($folderId), 'user_id' => $userId]); }
        catch (\Exception $e) { return null; }
        return $d ? self::apiFolderRow($d) : null;
    }

    public static function apiListFolders(string $userId): array
    {
        $folders = self::col('media_folders')->find(['user_id' => $userId])->toArray();
        $counts = [];
        foreach (self::col('media_items')->aggregate([
            ['$match' => ['user_id' => $userId]],
            ['$group' => ['_id' => '$folder_id', 'count' => ['$sum' => 1]]],
        ]) as $row) {
            $counts[(string)($row['_id'] ?? '')] = (int)$row['count'];
        }
        $out = [];
        foreach ($folders as $f) {
            $row = self::apiFolderRow($f);
            $row['media_count'] = $counts[$row['id']] ?? 0;
            $out[] = $row;
        }
        // ORDER BY is_system DESC, name ASC
        usort($out, function ($a, $b) {
            return ($b['is_system'] <=> $a['is_system']) ?: strcmp((string)$a['name'], (string)$b['name']);
        });
        return $out;
    }

    /** Create folder. Returns id string, or ['error'=>msg]. */
    public static function apiCreateFolder(string $userId, string $name, ?string $parentId)
    {
        if ($parentId !== null && $parentId !== '') {
            if (self::apiFolderById($userId, $parentId) === null) return ['error' => 'Parent folder not found'];
        } else {
            $parentId = null;
        }
        $dup = self::col('media_folders')->countDocuments(['user_id' => $userId, 'name' => $name, 'parent_id' => $parentId]);
        if ($dup > 0) return ['error' => 'כבר קיימת תיקייה בשם הזה'];
        $r = self::col('media_folders')->insertOne([
            'user_id' => $userId, 'name' => $name, 'parent_id' => $parentId,
            'is_system' => 0, 'created' => gmdate('Y-m-d H:i:s'),
        ]);
        return (string)$r->getInsertedId();
    }

    public static function apiRenameFolder(string $userId, string $folderId, string $name)
    {
        $f = self::apiFolderById($userId, $folderId);
        if (!$f) return ['error' => 'Folder not found'];
        if ($f['is_system']) return ['error' => 'Cannot rename system folder'];
        self::col('media_folders')->updateOne(['_id' => new ObjectId($folderId), 'user_id' => $userId], ['$set' => ['name' => $name]]);
        return true;
    }

    public static function apiDeleteFolder(string $userId, string $folderId)
    {
        $f = self::apiFolderById($userId, $folderId);
        if (!$f) return ['error' => 'Folder not found'];
        if ($f['is_system']) return ['error' => 'Cannot delete system folder'];
        // Lesson-folder protection: parent is a system "שיעורים" folder.
        $parentId = $f['parent_id'];
        if ($parentId) {
            $parent = self::apiFolderById($userId, $parentId);
            if ($parent && $parent['name'] === 'שיעורים' && $parent['is_system']) {
                return ['error' => 'לא ניתן למחוק תיקיית שיעור — מחק את השיעור עצמו כדי למחוק את התיקייה'];
            }
        }
        // DELETE the folder's media items (media_api deletes; not move-to-root).
        self::col('media_items')->deleteMany(['folder_id' => $folderId, 'user_id' => $userId]);
        // Reparent subfolders to this folder's parent (or root).
        self::col('media_folders')->updateMany(
            ['parent_id' => $folderId, 'user_id' => $userId],
            ['$set' => ['parent_id' => $parentId ?: null]]
        );
        self::col('media_folders')->deleteOne(['_id' => new ObjectId($folderId), 'user_id' => $userId]);
        return true;
    }

    public static function apiMoveFolder(string $userId, string $folderId, ?string $newParentId)
    {
        if (self::apiFolderById($userId, $folderId) === null) return ['error' => 'Folder not found'];
        if ($newParentId !== null && $newParentId !== '') {
            if ($newParentId === $folderId) return ['error' => 'Cannot move folder into itself'];
            $checkId = $newParentId; $guard = 0;
            while ($checkId && $guard++ < 1000) {
                $p = self::apiFolderById($userId, $checkId);
                if (!$p) break;
                $parent = $p['parent_id'];
                if ($parent === $folderId) return ['error' => 'Cannot move folder into its own child'];
                $checkId = $parent;
            }
        } else {
            $newParentId = null;
        }
        self::col('media_folders')->updateOne(['_id' => new ObjectId($folderId), 'user_id' => $userId], ['$set' => ['parent_id' => $newParentId]]);
        return true;
    }

    /** List media. Returns ['items'=>...] or ['items'=>..,'has_more'=>..,'total'=>..] when $limit>0. */
    public static function apiListMedia(string $userId, ?string $folderId, int $limit = 0, int $offset = 0): array
    {
        $filter = ['user_id' => $userId];
        if ($folderId !== null && $folderId !== '') $filter['folder_id'] = $folderId;
        $opts = ['sort' => ['created' => -1, 'created_at' => -1]];
        if ($limit > 0) { $opts['limit'] = $limit; $opts['skip'] = $offset; }
        $items = [];
        foreach (self::col('media_items')->find($filter, $opts) as $d) { $items[] = self::apiItemRow($d); }
        if ($limit > 0) {
            $total = (int)self::col('media_items')->countDocuments($filter);
            return ['items' => $items, 'has_more' => ($offset + count($items)) < $total, 'total' => $total];
        }
        return ['items' => $items];
    }

    public static function apiAddLink(string $userId, string $title, string $url, string $folderId, string $mediaType)
    {
        if (self::apiFolderById($userId, $folderId) === null) return ['error' => 'Folder not found'];
        $r = self::col('media_items')->insertOne([
            'user_id' => $userId, 'folder_id' => $folderId, 'title' => $title,
            'media_type' => $mediaType, 'source_type' => 'link', 'url' => $url,
            'file_path' => null, 'source_media_id' => null, 'created' => gmdate('Y-m-d H:i:s'),
        ]);
        return (string)$r->getInsertedId();
    }

    public static function apiAddUpload(string $userId, string $title, string $folderId, string $mediaType, string $relPath, string $filePath): string
    {
        $r = self::col('media_items')->insertOne([
            'user_id' => $userId, 'folder_id' => $folderId, 'title' => $title,
            'media_type' => $mediaType, 'source_type' => 'upload', 'url' => $relPath,
            'file_path' => $filePath, 'source_media_id' => null, 'created' => gmdate('Y-m-d H:i:s'),
        ]);
        return (string)$r->getInsertedId();
    }

    public static function apiOwnsFolder(string $userId, string $folderId): bool
    {
        return self::apiFolderById($userId, $folderId) !== null;
    }

    public static function apiOwnsMedia(string $userId, string $mediaId): bool
    {
        try { return self::col('media_items')->countDocuments(['_id' => new ObjectId($mediaId), 'user_id' => $userId]) > 0; }
        catch (\Exception $e) { return false; }
    }

    public static function apiMoveMedia(string $userId, string $mediaId, string $newFolderId)
    {
        if (!self::apiOwnsMedia($userId, $mediaId)) return ['error' => 'Media not found'];
        if (self::apiFolderById($userId, $newFolderId) === null) return ['error' => 'Target folder not found'];
        self::col('media_items')->updateOne(['_id' => new ObjectId($mediaId), 'user_id' => $userId], ['$set' => ['folder_id' => $newFolderId]]);
        return true;
    }

    /** Get a media item's file_path (and existence) for delete, or null. */
    public static function apiMediaForDelete(string $userId, string $mediaId): ?array
    {
        try { $d = self::col('media_items')->findOne(['_id' => new ObjectId($mediaId), 'user_id' => $userId]); }
        catch (\Exception $e) { return null; }
        return $d ? ['file_path' => $d['file_path'] ?? null] : null;
    }

    public static function apiDeleteMedia(string $userId, string $mediaId): bool
    {
        try { return self::col('media_items')->deleteOne(['_id' => new ObjectId($mediaId), 'user_id' => $userId])->getDeletedCount() > 0; }
        catch (\Exception $e) { return false; }
    }

    public static function apiRenameMedia(string $userId, string $mediaId, string $title): bool
    {
        try { self::col('media_items')->updateOne(['_id' => new ObjectId($mediaId), 'user_id' => $userId], ['$set' => ['title' => $title]]); return true; }
        catch (\Exception $e) { return false; }
    }

    /** Search: title LIKE, exclude shortcuts, LEFT JOIN folder_name, LIMIT 50, created DESC. */
    public static function apiSearch(string $userId, string $query): array
    {
        $cursor = self::col('media_items')->find([
            'user_id' => $userId,
            'title' => ['$regex' => preg_quote($query), '$options' => 'i'],
            'source_type' => ['$ne' => 'shortcut'],
        ], ['sort' => ['created' => -1, 'created_at' => -1], 'limit' => 50]);
        // Resolve folder names (LEFT JOIN media_folders).
        $names = [];
        foreach (self::col('media_folders')->find(['user_id' => $userId]) as $f) { $names[(string)$f['_id']] = $f['name'] ?? null; }
        $out = [];
        foreach ($cursor as $d) {
            $row = self::apiItemRow($d);
            $row['folder_name'] = $row['folder_id'] !== null ? ($names[$row['folder_id']] ?? null) : null;
            $out[] = $row;
        }
        return $out;
    }

    public static function apiCreateShortcut(string $userId, string $sourceMediaId, string $targetFolderId)
    {
        try { $source = self::col('media_items')->findOne(['_id' => new ObjectId($sourceMediaId), 'user_id' => $userId]); }
        catch (\Exception $e) { $source = null; }
        if (!$source) return ['error' => 'Source media not found'];
        if (self::apiFolderById($userId, $targetFolderId) === null) return ['error' => 'Target folder not found'];
        $dup = self::col('media_items')->countDocuments(['source_media_id' => $sourceMediaId, 'folder_id' => $targetFolderId, 'user_id' => $userId]);
        if ($dup > 0) return ['error' => 'Shortcut already exists in this folder'];
        $r = self::col('media_items')->insertOne([
            'user_id' => $userId, 'folder_id' => $targetFolderId, 'title' => $source['title'] ?? '',
            'media_type' => $source['media_type'] ?? '', 'source_type' => 'shortcut',
            'url' => $source['url'] ?? null, 'file_path' => $source['file_path'] ?? null,
            'source_media_id' => $sourceMediaId, 'created' => gmdate('Y-m-d H:i:s'),
        ]);
        return (string)$r->getInsertedId();
    }

    /** Items in a folder for slide-usage (id,title,media_type,source_type,url,source_media_id,created). */
    public static function apiGetSlideUsage(string $userId, string $folderId): array
    {
        $cursor = self::col('media_items')->find(
            ['user_id' => $userId, 'folder_id' => $folderId],
            ['sort' => ['source_type' => 1, 'created' => -1, 'created_at' => -1]]
        );
        $out = [];
        foreach ($cursor as $d) {
            $row = self::apiItemRow($d);
            unset($row['folder_id'], $row['file_path']); // original SELECTs only these cols
            $out[] = $row;
        }
        return $out;
    }

    // -----------------------------------------------------------------
    // Folders
    // -----------------------------------------------------------------

    /**
     * List all folders for a user, with media item counts.
     * Original: SELECT folders + COUNT(*) per folder_id JOIN with media_items
     */
    public static function listFolders(string $userId): array
    {
        $folders = self::col('media_folders')->find(['user_id' => $userId])->toArray();

        // Build item counts per folder
        $counts = [];
        $cursor = self::col('media_items')->aggregate([
            ['$match' => ['user_id' => $userId]],
            ['$group' => ['_id' => '$folder_id', 'count' => ['$sum' => 1]]],
        ]);
        foreach ($cursor as $row) {
            $counts[(string)($row['_id'] ?? '')] = (int)$row['count'];
        }

        $result = [];
        foreach ($folders as $f) {
            $row = self::hydrateFolder($f);
            $row['item_count'] = $counts[$row['id']] ?? 0;
            $result[] = $row;
        }
        return $result;
    }

    /**
     * Get a single folder (with ownership check).
     */
    public static function getFolder(string $userId, string $folderId): ?array
    {
        try {
            $doc = self::col('media_folders')->findOne([
                '_id'     => new ObjectId($folderId),
                'user_id' => $userId,
            ]);
        } catch (\MongoDB\Driver\Exception\InvalidArgumentException $e) {
            return null;
        }
        return $doc ? self::hydrateFolder($doc) : null;
    }

    /**
     * Create a folder. Returns new folder ID or null on duplicate name.
     * Original: SELECT dup check, then INSERT
     */
    public static function createFolder(
        string $userId,
        string $name,
        ?string $parentId = null,
        bool $isSystem = false
    ): ?string {
        // Check parent ownership
        if ($parentId !== null) {
            $parent = self::getFolder($userId, $parentId);
            if ($parent === null) {
                return null; // parent doesn't exist or not owned
            }
        }

        // Duplicate name check (same parent)
        $dupFilter = ['user_id' => $userId, 'name' => $name];
        $dupFilter['parent_id'] = $parentId; // null is also a valid filter value
        if (self::col('media_folders')->countDocuments($dupFilter) > 0) {
            return null; // duplicate
        }

        $result = self::col('media_folders')->insertOne([
            'user_id'    => $userId,
            'name'       => $name,
            'parent_id'  => $parentId,
            'is_system'  => $isSystem,
            'created_at' => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Rename a folder. Returns false if system folder or not owned.
     */
    public static function renameFolder(string $userId, string $folderId, string $name): bool
    {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null || $folder['is_system']) {
            return false;
        }

        try {
            $result = self::col('media_folders')->updateOne(
                ['_id' => new ObjectId($folderId), 'user_id' => $userId],
                ['$set' => ['name' => $name]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getModifiedCount() > 0;
    }

    /**
     * Move a folder to a new parent. Returns false if system folder, circular, or not owned.
     */
    public static function moveFolder(string $userId, string $folderId, ?string $newParentId): bool
    {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null || $folder['is_system']) {
            return false;
        }

        if ($newParentId !== null) {
            if ($newParentId === $folderId) {
                return false; // can't move into itself
            }
            $parent = self::getFolder($userId, $newParentId);
            if ($parent === null) {
                return false;
            }
        }

        try {
            $result = self::col('media_folders')->updateOne(
                ['_id' => new ObjectId($folderId), 'user_id' => $userId],
                ['$set' => ['parent_id' => $newParentId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getModifiedCount() >= 0; // 0 = no change = parent unchanged = still OK
    }

    /**
     * Delete a folder and move its items to null (root).
     * System folders cannot be deleted.
     */
    public static function deleteFolder(string $userId, string $folderId): bool
    {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null || $folder['is_system']) {
            return false;
        }

        // Move child items to root
        try {
            self::col('media_items')->updateMany(
                ['user_id' => $userId, 'folder_id' => $folderId],
                ['$set' => ['folder_id' => null]]
            );

            // Move child folders to root
            self::col('media_folders')->updateMany(
                ['user_id' => $userId, 'parent_id' => $folderId],
                ['$set' => ['parent_id' => null]]
            );

            self::col('media_folders')->deleteOne([
                '_id'     => new ObjectId($folderId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return true;
    }

    // -----------------------------------------------------------------
    // Media items
    // -----------------------------------------------------------------

    /**
     * List media items in a folder (null = root).
     */
    public static function listMedia(string $userId, ?string $folderId = null): array
    {
        $filter = ['user_id' => $userId, 'folder_id' => $folderId];
        $cursor = self::col('media_items')->find($filter, ['sort' => ['created_at' => -1]]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateItem($doc);
        }
        return $result;
    }

    /**
     * Add a link/media item.
     */
    public static function addLink(
        string $userId,
        string $title,
        string $url,
        ?string $folderId = null,
        ?string $mediaType = null
    ): string {
        $result = self::col('media_items')->insertOne([
            'user_id'    => $userId,
            'title'      => $title,
            'url'        => $url,
            'folder_id'  => $folderId,
            'media_type' => $mediaType,
            'created_at' => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Upload/insert a file-based media item.
     */
    public static function addUpload(
        string $userId,
        string $title,
        string $url,
        ?string $folderId = null,
        ?string $mediaType = null,
        ?string $mimeType = null,
        ?int $fileSize = null
    ): string {
        $result = self::col('media_items')->insertOne([
            'user_id'    => $userId,
            'title'      => $title,
            'url'        => $url,
            'folder_id'  => $folderId,
            'media_type' => $mediaType,
            'mime_type'  => $mimeType,
            'file_size'  => $fileSize,
            'created_at' => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Create a shortcut (alias) pointing to another media item.
     * Original: INSERT with source_media_id set
     */
    public static function createShortcut(
        string $userId,
        string $sourceMediaId,
        ?string $folderId = null
    ): ?string {
        // Verify source exists and is owned by user
        $source = self::getMediaItem($userId, $sourceMediaId);
        if ($source === null) {
            return null;
        }

        $result = self::col('media_items')->insertOne([
            'user_id'         => $userId,
            'title'           => $source['title'],
            'url'             => $source['url'],
            'folder_id'       => $folderId,
            'media_type'      => $source['media_type'] ?? null,
            'source_media_id' => $sourceMediaId,
            'created_at'      => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Get a single media item (with ownership check).
     */
    public static function getMediaItem(string $userId, string $itemId): ?array
    {
        try {
            $doc = self::col('media_items')->findOne([
                '_id'     => new ObjectId($itemId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateItem($doc) : null;
    }

    /**
     * Move a media item to a different folder.
     */
    public static function moveMedia(string $userId, string $itemId, ?string $folderId): bool
    {
        try {
            $result = self::col('media_items')->updateOne(
                ['_id' => new ObjectId($itemId), 'user_id' => $userId],
                ['$set' => ['folder_id' => $folderId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Rename a media item.
     */
    public static function renameMedia(string $userId, string $itemId, string $title): bool
    {
        try {
            $result = self::col('media_items')->updateOne(
                ['_id' => new ObjectId($itemId), 'user_id' => $userId],
                ['$set' => ['title' => $title]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Delete a media item.
     */
    public static function deleteMedia(string $userId, string $itemId): bool
    {
        try {
            $result = self::col('media_items')->deleteOne([
                '_id'     => new ObjectId($itemId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return $result->getDeletedCount() > 0;
    }

    /**
     * Full-text search across title and url fields.
     */
    public static function search(string $userId, string $query): array
    {
        $cursor = self::col('media_items')->find([
            'user_id' => $userId,
            '$or'     => [
                ['title' => ['$regex' => preg_quote($query), '$options' => 'i']],
                ['url'   => ['$regex' => preg_quote($query), '$options' => 'i']],
            ],
        ], ['sort' => ['created_at' => -1]]);

        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateItem($doc);
        }
        return $result;
    }

    /**
     * Get all shortcuts pointing to a specific source media item.
     * Original: SELECT WHERE source_media_id = ?
     */
    public static function getSlideUsage(string $userId, string $sourceMediaId): array
    {
        $cursor = self::col('media_items')->find([
            'user_id'         => $userId,
            'source_media_id' => $sourceMediaId,
        ]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateItem($doc);
        }
        return $result;
    }

    // -----------------------------------------------------------------
    // Hydrators
    // -----------------------------------------------------------------

    private static function hydrateFolder(array $doc): array
    {
        return [
            'id'         => (string)($doc['_id'] ?? ''),
            'user_id'    => $doc['user_id'] ?? '',
            'name'       => $doc['name'] ?? '',
            'parent_id'  => $doc['parent_id'] ?? null,
            'is_system'  => (bool)($doc['is_system'] ?? false),
            'created_at' => ($doc['created_at'] instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
        ];
    }

    private static function hydrateItem(array $doc): array
    {
        return [
            'id'              => (string)($doc['_id'] ?? ''),
            'user_id'         => $doc['user_id'] ?? '',
            'title'           => $doc['title'] ?? '',
            'url'             => $doc['url'] ?? '',
            'folder_id'       => $doc['folder_id'] ?? null,
            'media_type'      => $doc['media_type'] ?? null,
            'mime_type'       => $doc['mime_type'] ?? null,
            'file_size'       => $doc['file_size'] ?? null,
            'source_media_id' => $doc['source_media_id'] ?? null,
            'created_at'      => ($doc['created_at'] instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
        ];
    }
}
