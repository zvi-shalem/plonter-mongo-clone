<?php
/**
 * ContentOrgStore — MongoDB data-access layer for content organization.
 *
 * Replaces direct SQLite3 access in:
 *   - api/content_org_api.php     (107 queries, hardest — spans 3 SQLite DBs)
 *   - sharing/content_api.php     (35 queries)
 *   - sharing/content_share_api.php (20 queries)
 *
 * SQLite source DBs:
 *   - plonter_content.db: content, folders, content_org, content_folders,
 *                         content_tags, tags, folder_shares, share_recipients, content_shares
 *   - plonter_auth.db:    users (sessions only — auth delegated to AuthStore)
 *   - plonter_data.db:    media_items (cross-DB ownership validation)
 *
 * Mongo collections and embedding decisions:
 *   content           — main content items; tag_ids[] and folder_ids[] embedded
 *   folders           — folder hierarchy; share_recipients embedded in folder_shares
 *   tags              — reference collection (small, rarely changes)
 *   folder_shares     — folder sharing grants; recipients[] embedded
 *   content_shares    — content-level share tokens
 *
 * Cross-DB validation that existed in SQLite:
 *   content_org_api.php ~line 214: verifies media item ownership by querying
 *   plonter_data.db while the main transaction is on plonter_content.db.
 *   In Mongo: both become collections in one DB → standard findOne on media_items.
 *
 * sqlite_master existence checks → replaced with listCollectionNames().
 *
 * SYNTAX-CLEAN — untested pending Atlas connection.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\BSON\Regex;

class ContentOrgStore
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
                error_log('ContentOrgStore::ensureIndexes failed: ' . $e->getMessage());
            }
        }
        return $collection;
    }

    public static function ensureIndexes(): void
    {
        // content
        self::col('content')->createIndex(['user_id' => 1, 'created_at' => -1]);
        self::col('content')->createIndex(['folder_ids' => 1]);
        self::col('content')->createIndex(['tag_ids' => 1]);
        self::col('content')->createIndex(['user_id' => 1, 'store' => 1]);
        self::col('content')->createIndex(['user_id' => 1, 'archived' => 1]);

        // folders
        self::col('folders')->createIndex(['user_id' => 1]);
        self::col('folders')->createIndex(['user_id' => 1, 'parent_id' => 1]);

        // tags
        self::col('tags')->createIndex(['user_id' => 1, 'namespace' => 1]);
        self::col('tags')->createIndex(['user_id' => 1, 'name' => 1, 'namespace' => 1], ['unique' => true]);

        // folder_shares
        self::col('folder_shares')->createIndex(['folder_id' => 1, 'owner_id' => 1]);
        self::col('folder_shares')->createIndex(['token' => 1]);

        // content_shares
        self::col('content_shares')->createIndex(['content_id' => 1, 'user_id' => 1]);
        self::col('content_shares')->createIndex(['token' => 1]);
    }

    // -----------------------------------------------------------------
    // Collection existence check (replaces sqlite_master queries)
    // -----------------------------------------------------------------

    /**
     * Check if a collection exists in the current database.
     * Replaces: SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n
     */
    public static function collectionExists(string $name): bool
    {
        $db = MongoStore::getInstance()->getDatabase();
        $names = $db->listCollectionNames(['filter' => ['name' => $name]]);
        foreach ($names as $n) {
            if ($n === $name) {
                return true;
            }
        }
        return false;
    }

    // -----------------------------------------------------------------
    // Tags
    // -----------------------------------------------------------------

    /**
     * Create a tag.
     * Original: org_create_tag — SELECT dup check, then INSERT
     */
    public static function createTag(string $userId, string $name, string $namespace = 'default'): ?array
    {
        $existing = self::col('tags')->findOne([
            'user_id'   => $userId,
            'name'      => $name,
            'namespace' => $namespace,
        ]);
        if ($existing) {
            return self::hydrateTag($existing); // return existing (idempotent)
        }

        $result = self::col('tags')->insertOne([
            'user_id'    => $userId,
            'name'       => $name,
            'namespace'  => $namespace,
            'created_at' => new UTCDateTime(),
        ]);

        return [
            'id'        => (string)$result->getInsertedId(),
            'user_id'   => $userId,
            'name'      => $name,
            'namespace' => $namespace,
        ];
    }

    /**
     * List tags for a user, optionally filtered by namespace.
     * Original: org_list_tags
     */
    public static function listTags(string $userId, ?string $namespace = null): array
    {
        $filter = ['user_id' => $userId];
        if ($namespace !== null) {
            $filter['namespace'] = $namespace;
        }
        $cursor = self::col('tags')->find($filter, ['sort' => ['name' => 1]]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateTag($doc);
        }
        return $result;
    }

    /**
     * Assign a tag to a content item (or media item via store).
     * Original: org_tag_item — inserts tag_id into content_tags join table
     * Mongo: adds tagId to content.tag_ids[] via $addToSet
     */
    public static function tagItem(
        string $userId,
        string $contentId,
        string $tagId,
        string $store = 'content'
    ): bool {
        if (!self::userOwnsTag($userId, $tagId)) {
            return false;
        }
        if (!self::userOwnsItem($userId, $contentId, $store)) {
            return false;
        }

        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$addToSet' => ['tag_ids' => $tagId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Remove a tag from a content item.
     * Original: org_untag_item
     */
    public static function untagItem(
        string $userId,
        string $contentId,
        string $tagId,
        string $store = 'content'
    ): bool {
        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$pull' => ['tag_ids' => $tagId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    // -----------------------------------------------------------------
    // Folders
    // -----------------------------------------------------------------

    /**
     * Get a single folder with ownership check.
     * Original: org_get_folder
     */
    public static function getFolder(string $userId, string $folderId): ?array
    {
        try {
            $doc = self::col('folders')->findOne([
                '_id'     => new ObjectId($folderId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateFolder($doc) : null;
    }

    /**
     * Create a folder.
     * Original: org_create_folder — name uniqueness per parent
     */
    public static function createFolder(
        string $userId,
        string $name,
        ?string $parentId = null
    ): ?array {
        // Duplicate name check within same parent
        $dup = self::col('folders')->findOne([
            'user_id'   => $userId,
            'name'      => $name,
            'parent_id' => $parentId,
        ]);
        if ($dup) {
            return self::hydrateFolder($dup); // idempotent
        }

        $result = self::col('folders')->insertOne([
            'user_id'    => $userId,
            'name'       => $name,
            'parent_id'  => $parentId,
            'created_at' => new UTCDateTime(),
        ]);

        return [
            'id'        => (string)$result->getInsertedId(),
            'user_id'   => $userId,
            'name'      => $name,
            'parent_id' => $parentId,
        ];
    }

    /**
     * List all folders for a user.
     * Original: org_list_folders
     */
    public static function listFolders(string $userId): array
    {
        $cursor = self::col('folders')->find(
            ['user_id' => $userId],
            ['sort' => ['name' => 1]]
        );
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateFolder($doc);
        }
        return $result;
    }

    /**
     * Rename a folder.
     * Original: org_rename_folder
     */
    public static function renameFolder(string $userId, string $folderId, string $name): bool
    {
        try {
            $result = self::col('folders')->updateOne(
                ['_id' => new ObjectId($folderId), 'user_id' => $userId],
                ['$set' => ['name' => $name]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Move a folder to a new parent.
     * Original: org_move_folder — checks for circular references
     */
    public static function moveFolder(
        string $userId,
        string $folderId,
        ?string $newParentId
    ): bool {
        if ($newParentId !== null && $newParentId === $folderId) {
            return false; // circular
        }
        if ($newParentId !== null) {
            $parent = self::getFolder($userId, $newParentId);
            if ($parent === null) {
                return false;
            }
        }
        try {
            $result = self::col('folders')->updateOne(
                ['_id' => new ObjectId($folderId), 'user_id' => $userId],
                ['$set' => ['parent_id' => $newParentId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Delete a folder and clean up references.
     * Original: org_delete_folder — removes folder + its content_org rows + folder_share rows
     */
    public static function deleteFolder(string $userId, string $folderId): bool
    {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null) {
            return false;
        }

        // Remove folderId from all content items' folder_ids arrays
        self::col('content')->updateMany(
            ['user_id' => $userId, 'folder_ids' => $folderId],
            ['$pull' => ['folder_ids' => $folderId]]
        );

        // Remove folder shares for this folder
        self::col('folder_shares')->deleteMany(['folder_id' => $folderId, 'owner_id' => $userId]);

        // Move child folders to root
        try {
            self::col('folders')->updateMany(
                ['user_id' => $userId, 'parent_id' => $folderId],
                ['$set' => ['parent_id' => null]]
            );

            self::col('folders')->deleteOne([
                '_id'     => new ObjectId($folderId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return true;
    }

    // -----------------------------------------------------------------
    // Content organization (add/remove/list items in folders)
    // -----------------------------------------------------------------

    /**
     * Add a content item to a folder.
     * Original: org_add_to_folder — uses content_folders join table
     * Mongo: $addToSet on content.folder_ids
     */
    public static function addToFolder(
        string $userId,
        string $contentId,
        string $folderId,
        string $store = 'content'
    ): bool {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null) {
            return false;
        }
        if (!self::userOwnsItem($userId, $contentId, $store)) {
            return false;
        }

        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$addToSet' => ['folder_ids' => $folderId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Add a shortcut to a folder (content_org row with is_shortcut=true).
     * Original: org_add_shortcut
     * Mongo: separate content document with is_shortcut=true pointing to source
     */
    public static function addShortcut(
        string $userId,
        string $contentId,
        string $folderId,
        string $store = 'content'
    ): bool {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null) {
            return false;
        }

        try {
            $result = self::col('content')->insertOne([
                'user_id'           => $userId,
                'store'             => $store,
                'source_content_id' => $contentId,
                'folder_ids'        => [$folderId],
                'tag_ids'           => [],
                'is_shortcut'       => true,
                'archived'          => false,
                'created_at'        => new UTCDateTime(),
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return $result->getInsertedCount() > 0;
    }

    /**
     * Remove a content item from a folder.
     * Original: org_remove_from_folder
     */
    public static function removeFromFolder(
        string $userId,
        string $contentId,
        string $folderId,
        string $store = 'content'
    ): bool {
        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$pull' => ['folder_ids' => $folderId]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * List items in a folder.
     * Original: org_list_folder_items — JOINs content_org → content
     * Mongo: find content WHERE folder_ids contains folderId
     */
    public static function listFolderItems(
        string $userId,
        string $folderId,
        bool $includeArchived = false
    ): array {
        $filter = [
            'user_id'    => $userId,
            'folder_ids' => $folderId,
        ];
        if (!$includeArchived) {
            $filter['archived'] = ['$ne' => true];
        }

        $cursor = self::col('content')->find($filter, ['sort' => ['created_at' => -1]]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateContent($doc);
        }
        return $result;
    }

    // -----------------------------------------------------------------
    // Archive / restore
    // -----------------------------------------------------------------

    /**
     * Archive a content item (soft-delete).
     * Original: org_archive_item
     */
    public static function archiveItem(
        string $userId,
        string $contentId,
        string $store = 'content'
    ): bool {
        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$set' => ['archived' => true, 'archived_at' => new UTCDateTime()]]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Restore an archived item.
     * Original: org_restore_item
     */
    public static function restoreItem(
        string $userId,
        string $contentId,
        string $store = 'content'
    ): bool {
        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$set' => ['archived' => false], '$unset' => ['archived_at' => '']]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    // -----------------------------------------------------------------
    // Content search
    // -----------------------------------------------------------------

    /**
     * Search content items by text, tags, folders.
     * Original: org_search_content — large multi-JOIN query
     */
    public static function searchContent(string $userId, array $params): array
    {
        $filter = ['user_id' => $userId];

        if (!empty($params['archived'])) {
            $filter['archived'] = true;
        } else {
            $filter['archived'] = ['$ne' => true];
        }

        if (!empty($params['store'])) {
            $filter['store'] = $params['store'];
        }

        if (!empty($params['folder_id'])) {
            $filter['folder_ids'] = $params['folder_id'];
        }

        if (!empty($params['tag_id'])) {
            $filter['tag_ids'] = $params['tag_id'];
        }

        if (!empty($params['query'])) {
            $pattern = new Regex(preg_quote($params['query']), 'i');
            $filter['$or'] = [
                ['title'   => $pattern],
                ['content' => $pattern],
            ];
        }

        $sort = ['created_at' => -1];
        if (!empty($params['sort']) && $params['sort'] === 'alpha') {
            $sort = ['title' => 1];
        }

        $opts = ['sort' => $sort];
        if (!empty($params['limit'])) {
            $opts['limit'] = (int)$params['limit'];
        }

        $cursor = self::col('content')->find($filter, $opts);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateContent($doc);
        }
        return $result;
    }

    // -----------------------------------------------------------------
    // Folder shares (folder_shares + embedded recipients)
    // -----------------------------------------------------------------

    /**
     * Create a folder share grant.
     * Original: org_create_folder_share + add recipient row
     */
    public static function createFolderShare(
        string $userId,
        string $folderId,
        string $targetType,
        string $targetId,
        string $role,
        ?int $ttlSecs = null,
        ?string $token = null
    ): ?array {
        $folder = self::getFolder($userId, $folderId);
        if ($folder === null) {
            return null;
        }

        $now = new UTCDateTime();
        $expiresAt = $ttlSecs !== null ? new UTCDateTime((time() + $ttlSecs) * 1000) : null;
        $shareToken = $token ?? bin2hex(random_bytes(16));

        $recipient = [
            'target_type' => $targetType,
            'target_id'   => $targetId,
            'role'        => $role,
            'added_at'    => $now,
        ];

        $result = self::col('folder_shares')->insertOne([
            'folder_id'  => $folderId,
            'owner_id'   => $userId,
            'token'      => $shareToken,
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'recipients' => [$recipient],
        ]);

        return [
            'id'         => (string)$result->getInsertedId(),
            'folder_id'  => $folderId,
            'owner_id'   => $userId,
            'token'      => $shareToken,
            'expires_at' => $expiresAt?->toDateTime()->format('Y-m-d H:i:s'),
            'recipients' => [$recipient],
        ];
    }

    /**
     * List all shares for a folder.
     * Original: org_list_folder_shares
     */
    public static function listFolderShares(string $userId, string $folderId): array
    {
        $cursor = self::col('folder_shares')->find([
            'owner_id'  => $userId,
            'folder_id' => $folderId,
        ]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateFolderShare($doc);
        }
        return $result;
    }

    /**
     * Revoke a folder share.
     * Original: org_revoke_folder_share
     */
    public static function revokeFolderShare(string $userId, string $shareId): bool
    {
        try {
            $result = self::col('folder_shares')->deleteOne([
                '_id'      => new ObjectId($shareId),
                'owner_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return $result->getDeletedCount() > 0;
    }

    /**
     * Get folders shared with the current user.
     * Original: org_folders_shared_with_me — complex JOIN across folder_shares + share_recipients
     * Mongo: find folder_shares WHERE recipients[].target_id = userId
     */
    public static function foldersSharedWithMe(string $userId): array
    {
        $cursor = self::col('folder_shares')->find([
            'recipients' => [
                '$elemMatch' => [
                    '$or' => [
                        ['target_type' => 'user',  'target_id' => $userId],
                        ['target_type' => 'public'],
                    ],
                ],
            ],
        ]);

        $result = [];
        foreach ($cursor as $doc) {
            // Fetch the actual folder
            $folder = self::getFolder($doc['owner_id'] ?? '', $doc['folder_id'] ?? '');
            if ($folder) {
                $result[] = array_merge($folder, [
                    'share_token' => $doc['token'] ?? '',
                    'share_role'  => 'viewer',
                ]);
            }
        }
        return $result;
    }

    /**
     * Open (access) a share via token.
     * Original: org_open_share
     */
    public static function openShare(string $userId, string $token): ?array
    {
        $now = new UTCDateTime();
        $doc = self::col('folder_shares')->findOne([
            'token'  => $token,
            '$or'    => [
                ['expires_at' => null],
                ['expires_at' => ['$gt' => $now]],
            ],
        ]);
        return $doc ? self::hydrateFolderShare($doc) : null;
    }

    /**
     * Detach (leave) a share.
     * Original: org_detach_share — removes recipient row
     * Mongo: $pull recipient from the recipients array
     */
    public static function detachShare(string $userId, string $token): bool
    {
        $result = self::col('folder_shares')->updateOne(
            ['token' => $token],
            ['$pull' => ['recipients' => ['target_id' => $userId]]]
        );
        return $result->getMatchedCount() > 0;
    }

    /**
     * Get all content items shared with the user (via content_shares).
     * Original: org_my_shared_items
     */
    public static function mySharedItems(string $userId): array
    {
        $cursor = self::col('content_shares')->find(['recipient_user_id' => $userId]);
        $contentIds = [];
        foreach ($cursor as $doc) {
            $contentIds[] = $doc['content_id'] ?? null;
        }
        $contentIds = array_filter($contentIds);

        if (empty($contentIds)) {
            return [];
        }

        $objectIds = array_map(function ($id) {
            try {
                return new ObjectId($id);
            } catch (\Exception $e) {
                return null;
            }
        }, $contentIds);
        $objectIds = array_filter($objectIds);

        $cursor = self::col('content')->find(['_id' => ['$in' => array_values($objectIds)]]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateContent($doc);
        }
        return $result;
    }

    // -----------------------------------------------------------------
    // Content shares (content-level sharing)
    // -----------------------------------------------------------------

    /**
     * Create a content-level share.
     */
    public static function createContentShare(
        string $ownerId,
        string $contentId,
        string $recipientUserId,
        string $role = 'viewer'
    ): string {
        $result = self::col('content_shares')->insertOne([
            'content_id'         => $contentId,
            'owner_user_id'      => $ownerId,
            'recipient_user_id'  => $recipientUserId,
            'role'               => $role,
            'created_at'         => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * List content shares for an owner's item.
     */
    public static function listContentShares(string $ownerId, string $contentId): array
    {
        $cursor = self::col('content_shares')->find([
            'owner_user_id' => $ownerId,
            'content_id'    => $contentId,
        ]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = [
                'id'                 => (string)($doc['_id'] ?? ''),
                'content_id'         => $doc['content_id'] ?? '',
                'owner_user_id'      => $doc['owner_user_id'] ?? '',
                'recipient_user_id'  => $doc['recipient_user_id'] ?? '',
                'role'               => $doc['role'] ?? 'viewer',
            ];
        }
        return $result;
    }

    // -----------------------------------------------------------------
    // content_api.php — CONTRACT-SHAPED content CRUD (Phase 5b).
    // The generic getContent/createContent/hydrateContent above use an
    // org-centric shape (tag_ids/folder_ids). sharing/content_api.php has a
    // DIFFERENT row contract: {id,user_id,content_type,title,data(decoded),
    // color,source_id,created,updated}. These additive api*-methods preserve
    // that exact contract. They share the SAME `content` collection — the org
    // fields (tag_ids/folder_ids/archived) are additive and untouched here.
    // NOTE: id is an ObjectId string (documented int→ObjectId decision).
    // -----------------------------------------------------------------

    /** Map a content doc to the content_api row contract. */
    private static function hydrateApiContent(array $doc): array
    {
        $fmt = function ($d) {
            return ($d instanceof UTCDateTime) ? $d->toDateTime()->format('Y-m-d H:i:s') : ($d ?? null);
        };
        $data = $doc['data'] ?? [];
        return [
            'id'           => (string)($doc['_id'] ?? ''),
            'user_id'      => $doc['user_id'] ?? '',
            'content_type' => $doc['content_type'] ?? '',
            'title'        => $doc['title'] ?? '',
            'data'         => is_array($data) ? $data : (json_decode((string)$data, true) ?: []),
            'color'        => $doc['color'] ?? '#0d9488',
            'source_id'    => $doc['source_id'] ?? null,
            'created'      => $fmt($doc['created_at'] ?? ($doc['created'] ?? null)),
            'updated'      => $fmt($doc['updated_at'] ?? ($doc['updated'] ?? null)),
        ];
    }

    /** List a user's content, optional content_type / source_id filters, newest first. */
    public static function apiListContent(string $userId, ?string $contentType = null, $sourceId = null): array
    {
        $filter = ['user_id' => $userId];
        if ($contentType !== null && $contentType !== '') {
            $filter['content_type'] = $contentType;
        }
        if ($sourceId !== null) {
            $filter['source_id'] = $sourceId;
        }
        $cursor = self::col('content')->find($filter, ['sort' => ['updated_at' => -1, 'created_at' => -1]]);
        $out = [];
        foreach ($cursor as $doc) {
            $out[] = self::hydrateApiContent($doc);
        }
        return $out;
    }

    /** Get a content item owned by the user, in the api row contract, or null. */
    public static function apiGetOwned(string $userId, string $contentId): ?array
    {
        try {
            $doc = self::col('content')->findOne(['_id' => new ObjectId($contentId), 'user_id' => $userId]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateApiContent($doc) : null;
    }

    /** Get a content item by id regardless of owner (for share-aware reads), or null. */
    public static function apiGetAnyById(string $contentId): ?array
    {
        try {
            $doc = self::col('content')->findOne(['_id' => new ObjectId($contentId)]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateApiContent($doc) : null;
    }

    /** Create a content item in the api shape. Returns new id (ObjectId string). */
    public static function apiCreateContent(
        string $userId,
        string $contentType,
        string $title,
        $data,
        string $color = '#0d9488',
        $sourceId = null
    ): string {
        $now = new UTCDateTime();
        $result = self::col('content')->insertOne([
            'user_id'      => $userId,
            'content_type' => $contentType,
            'title'        => $title,
            'data'         => is_array($data) ? $data : (json_decode((string)$data, true) ?: []),
            'color'        => $color,
            'source_id'    => $sourceId,
            'store'        => 'content',
            'tag_ids'      => [],
            'folder_ids'   => [],
            'archived'     => false,
            'created_at'   => $now,
            'updated_at'   => $now,
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Update content fields (caller already authorized owner/edit-share).
     * Accepts any of: title, data, color, content_type, source_id.
     * Returns the modified count (mirrors SQLite changes()).
     */
    public static function apiUpdateContent(string $contentId, array $fields): int
    {
        $set = ['updated_at' => new UTCDateTime()];
        if (array_key_exists('title', $fields))        { $set['title'] = $fields['title']; }
        if (array_key_exists('data', $fields))         { $set['data'] = is_array($fields['data']) ? $fields['data'] : (json_decode((string)$fields['data'], true) ?: []); }
        if (array_key_exists('color', $fields))        { $set['color'] = $fields['color']; }
        if (array_key_exists('content_type', $fields)) { $set['content_type'] = $fields['content_type']; }
        if (array_key_exists('source_id', $fields))    { $set['source_id'] = $fields['source_id']; }
        try {
            $result = self::col('content')->updateOne(['_id' => new ObjectId($contentId)], ['$set' => $set]);
        } catch (\Exception $e) {
            return 0;
        }
        return $result->getModifiedCount();
    }

    /** Delete a content item owned by the user. Returns deleted count. */
    public static function apiDeleteOwned(string $userId, string $contentId): int
    {
        try {
            $result = self::col('content')->deleteOne(['_id' => new ObjectId($contentId), 'user_id' => $userId]);
        } catch (\Exception $e) {
            return 0;
        }
        return $result->getDeletedCount();
    }

    /** Bulk-rename source_id for (user, content_type, old_source_id). Returns modified count. */
    public static function apiRenameSource(string $userId, string $contentType, string $old, string $new): int
    {
        $result = self::col('content')->updateMany(
            ['user_id' => $userId, 'content_type' => $contentType, 'source_id' => $old],
            ['$set' => ['source_id' => $new, 'updated_at' => new UTCDateTime()]]
        );
        return $result->getModifiedCount();
    }

    /** Per-user content stats: ['total'=>int, 'by_type'=>[type=>count]]. */
    public static function apiStats(string $userId): array
    {
        $total = (int)self::col('content')->countDocuments(['user_id' => $userId]);
        $byType = [];
        $cursor = self::col('content')->aggregate([
            ['$match' => ['user_id' => $userId]],
            ['$group' => ['_id' => '$content_type', 'cnt' => ['$sum' => 1]]],
        ]);
        foreach ($cursor as $row) {
            $byType[(string)($row['_id'] ?? '')] = (int)($row['cnt'] ?? 0);
        }
        return ['total' => $total, 'by_type' => $byType];
    }

    /**
     * Does an ACTIVE content_share grant the requested access?
     * Mirrors content_api.php userCanView/userCanEditContent share queries:
     *  - a matching share TOKEN (any role for view; role='edit' for edit), OR
     *  - a targeted user share (target_type='user', target_id=userId), OR
     *  - an email-bound share (target_type='email', target_id=email).
     * Active = revoked_at null AND (expires_at null OR expires_at > now).
     * $requireEdit=true restricts to role='edit'.
     */
    public static function apiShareGrants(
        string $contentId,
        bool $requireEdit,
        string $shareToken = '',
        string $userId = '',
        string $email = ''
    ): bool {
        $nowStr = gmdate('Y-m-d H:i:s');
        $active = [
            '$and' => [
                ['$or' => [['revoked_at' => null], ['revoked_at' => ['$exists' => false]]]],
                ['$or' => [
                    ['expires_at' => null],
                    ['expires_at' => ['$exists' => false]],
                    ['expires_at' => ['$gt' => $nowStr]],
                    ['expires_at' => ['$gt' => new UTCDateTime()]],
                ]],
            ],
        ];
        $role = $requireEdit ? 'edit' : null;
        $base = ['content_id' => $contentId];
        if ($role !== null) {
            $base['role'] = $role;
        }
        // (a) token grant
        if ($shareToken !== '') {
            $q = array_merge($base, ['token' => $shareToken], $active);
            if (self::col('content_shares')->countDocuments($q) > 0) {
                return true;
            }
        }
        // (b) targeted user share
        if ($userId !== '') {
            $q = array_merge($base, ['target_type' => 'user', 'target_id' => $userId], $active);
            if (self::col('content_shares')->countDocuments($q) > 0) {
                return true;
            }
        }
        // (c) email-bound share
        $em = strtolower(trim($email));
        if ($em !== '') {
            $q = array_merge($base, ['target_type' => 'email', 'target_id' => $em], $active);
            if (self::col('content_shares')->countDocuments($q) > 0) {
                return true;
            }
        }
        return false;
    }

    // -----------------------------------------------------------------
    // content_share_api.php — FULL-schema content_shares (Phase 5b).
    // Writes the same schema the readers expect (ContentOrgJunctionStore::openShare
    // and apiShareGrants above): content_id, content_type, owner_user_id,
    // target_type, target_id, role, token, created, expires_at, revoked_at.
    // Timestamps stored as 'Y-m-d H:i:s' strings to match the original contract.
    // -----------------------------------------------------------------

    public static function apiCreateContentShare(
        string $ownerId,
        string $contentId,
        string $contentType,
        string $targetType,
        $targetId,
        string $role,
        string $token,
        ?string $expiresAt
    ): string {
        $r = self::col('content_shares')->insertOne([
            'content_id'    => $contentId,
            'content_type'  => $contentType,
            'owner_user_id' => $ownerId,
            'target_type'   => $targetType,
            'target_id'     => $targetId !== null ? (string)$targetId : null,
            'role'          => $role,
            'token'         => $token,
            'created'       => gmdate('Y-m-d H:i:s'),
            'expires_at'    => $expiresAt,
            'revoked_at'    => null,
        ]);
        return (string)$r->getInsertedId();
    }

    /** List an owner's shares for one content item (full-schema rows, newest first). */
    public static function apiListContentSharesFull(string $ownerId, string $contentId): array
    {
        $cursor = self::col('content_shares')->find(
            ['content_id' => $contentId, 'owner_user_id' => $ownerId],
            ['sort' => ['created' => -1]]
        );
        $out = [];
        foreach ($cursor as $r) {
            $out[] = [
                'id'           => (string)($r['_id'] ?? ''),
                'content_id'   => $r['content_id'] ?? '',
                'content_type' => $r['content_type'] ?? '',
                'target_type'  => $r['target_type'] ?? null,
                'target_id'    => $r['target_id'] ?? null,
                'role'         => $r['role'] ?? '',
                'token'        => $r['token'] ?? '',
                'created'      => self::tsStr($r['created'] ?? null),
                'expires_at'   => self::tsStr($r['expires_at'] ?? null),
                'revoked_at'   => self::tsStr($r['revoked_at'] ?? null),
            ];
        }
        return $out;
    }

    /** Revoke a content share (owner-scoped, idempotent). Returns affected count. */
    public static function apiRevokeContentShare(string $ownerId, string $shareId): int
    {
        try {
            $existing = self::col('content_shares')->findOne(['_id' => new ObjectId($shareId), 'owner_user_id' => $ownerId]);
        } catch (\Exception $e) {
            return 0;
        }
        if (!$existing) {
            return 0;
        }
        if (($existing['revoked_at'] ?? null) === null) {
            self::col('content_shares')->updateOne(
                ['_id' => new ObjectId($shareId), 'owner_user_id' => $ownerId],
                ['$set' => ['revoked_at' => gmdate('Y-m-d H:i:s')]]
            );
        }
        return 1; // matched an owned row (mirrors the original "found & (idempotently) revoked")
    }

    /** Resolve a content share by token (raw row, for resolve_link). */
    public static function apiResolveShareByToken(string $token): ?array
    {
        $r = self::col('content_shares')->findOne(['token' => $token]);
        if (!$r) {
            return null;
        }
        return [
            'id'           => (string)($r['_id'] ?? ''),
            'content_id'   => $r['content_id'] ?? '',
            'content_type' => $r['content_type'] ?? '',
            'owner_user_id'=> $r['owner_user_id'] ?? '',
            'target_type'  => $r['target_type'] ?? '',
            'target_id'    => $r['target_id'] ?? null,
            'role'         => $r['role'] ?? '',
            'token'        => $r['token'] ?? '',
            'expires_at'   => self::tsStr($r['expires_at'] ?? null),
            'revoked_at'   => self::tsStr($r['revoked_at'] ?? null),
        ];
    }

    /** Active shares addressed to a user (by id or email), joined to content meta. */
    public static function apiSharedWithMe(string $userId, string $email): array
    {
        $nowStr = gmdate('Y-m-d H:i:s');
        $targets = [['target_type' => 'user', 'target_id' => $userId]];
        if ($email !== '') {
            $targets[] = ['target_type' => 'email', 'target_id' => $email];
        }
        $cursor = self::col('content_shares')->find([
            'revoked_at' => null,
            '$and' => [
                ['$or' => [['expires_at' => null], ['expires_at' => ['$gt' => $nowStr]], ['expires_at' => ['$gt' => new UTCDateTime()]]]],
                ['$or' => $targets],
            ],
        ], ['sort' => ['created' => -1]]);
        $out = [];
        foreach ($cursor as $s) {
            $cid = (string)($s['content_id'] ?? '');
            $c = null;
            try { $c = self::col('content')->findOne(['_id' => new ObjectId($cid)]); } catch (\Exception $e) {}
            if (!$c) { continue; }
            $out[] = [
                'share_id'     => (string)($s['_id'] ?? ''),
                'role'         => $s['role'] ?? '',
                'created'      => self::tsStr($s['created'] ?? null),
                'expires_at'   => self::tsStr($s['expires_at'] ?? null),
                'target_type'  => $s['target_type'] ?? '',
                'content_id'   => $cid,
                'content_type' => $c['content_type'] ?? '',
                'title'        => $c['title'] ?? '',
                'color'        => $c['color'] ?? '',
                'source_id'    => $c['source_id'] ?? null,
            ];
        }
        return $out;
    }

    private static function tsStr($d): ?string
    {
        if ($d instanceof UTCDateTime) { return $d->toDateTime()->format('Y-m-d H:i:s'); }
        return $d === null ? null : (string)$d;
    }

    // -----------------------------------------------------------------
    // Content CRUD (generic/org-centric — used by other callers/tests)
    // -----------------------------------------------------------------

    /**
     * Get a content item (with ownership check).
     */
    public static function getContent(string $userId, string $contentId): ?array
    {
        try {
            $doc = self::col('content')->findOne([
                '_id'     => new ObjectId($contentId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateContent($doc) : null;
    }

    /**
     * Create a content item.
     */
    public static function createContent(
        string $userId,
        string $store,
        array $fields
    ): string {
        $doc = array_merge($fields, [
            'user_id'    => $userId,
            'store'      => $store,
            'tag_ids'    => $fields['tag_ids'] ?? [],
            'folder_ids' => $fields['folder_ids'] ?? [],
            'archived'   => false,
            'created_at' => new UTCDateTime(),
        ]);

        $result = self::col('content')->insertOne($doc);
        return (string)$result->getInsertedId();
    }

    /**
     * Update content fields.
     */
    public static function updateContent(string $userId, string $contentId, array $fields): bool
    {
        unset($fields['_id'], $fields['user_id'], $fields['created_at']);
        $fields['updated_at'] = new UTCDateTime();

        try {
            $result = self::col('content')->updateOne(
                ['_id' => new ObjectId($contentId), 'user_id' => $userId],
                ['$set' => $fields]
            );
        } catch (\Exception $e) {
            return false;
        }
        return $result->getMatchedCount() > 0;
    }

    /**
     * Delete a content item.
     */
    public static function deleteContent(string $userId, string $contentId): bool
    {
        try {
            $result = self::col('content')->deleteOne([
                '_id'     => new ObjectId($contentId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }

        if ($result->getDeletedCount() > 0) {
            // Clean up shares
            self::col('content_shares')->deleteMany(['content_id' => $contentId]);
            return true;
        }
        return false;
    }

    // -----------------------------------------------------------------
    // Ownership helpers
    // (cross-DB validation: originally required 2 separate SQLite handles)
    // -----------------------------------------------------------------

    /**
     * Verify a user owns a content or media item.
     * Replaces: verifyOwnsItem() which queried plonter_content.db OR plonter_data.db
     * In Mongo: both are in the same DB — single collection lookup.
     */
    public static function userOwnsItem(string $userId, string $itemId, string $store = 'content'): bool
    {
        $collection = ($store === 'media') ? 'media_items' : 'content';
        try {
            $count = self::col($collection)->countDocuments([
                '_id'     => new ObjectId($itemId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return $count > 0;
    }

    /**
     * Verify a user owns a tag.
     * Original: org_user_owns_tag
     */
    public static function userOwnsTag(string $userId, string $tagId): bool
    {
        try {
            $count = self::col('tags')->countDocuments([
                '_id'     => new ObjectId($tagId),
                'user_id' => $userId,
            ]);
        } catch (\Exception $e) {
            return false;
        }
        return $count > 0;
    }

    // -----------------------------------------------------------------
    // Hydrators
    // -----------------------------------------------------------------

    private static function hydrateTag(array $doc): array
    {
        return [
            'id'        => (string)($doc['_id'] ?? ''),
            'user_id'   => $doc['user_id'] ?? '',
            'name'      => $doc['name'] ?? '',
            'namespace' => $doc['namespace'] ?? 'default',
        ];
    }

    private static function hydrateFolder(array $doc): array
    {
        return [
            'id'        => (string)($doc['_id'] ?? ''),
            'user_id'   => $doc['user_id'] ?? '',
            'name'      => $doc['name'] ?? '',
            'parent_id' => $doc['parent_id'] ?? null,
            'created_at' => ($doc['created_at'] instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
        ];
    }

    private static function hydrateContent(array $doc): array
    {
        return [
            'id'                => (string)($doc['_id'] ?? ''),
            'user_id'           => $doc['user_id'] ?? '',
            'store'             => $doc['store'] ?? 'content',
            'title'             => $doc['title'] ?? '',
            'content'           => $doc['content'] ?? '',
            'tag_ids'           => $doc['tag_ids'] ?? [],
            'folder_ids'        => $doc['folder_ids'] ?? [],
            'archived'          => (bool)($doc['archived'] ?? false),
            'is_shortcut'       => (bool)($doc['is_shortcut'] ?? false),
            'source_content_id' => $doc['source_content_id'] ?? null,
            'created_at'        => ($doc['created_at'] instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
        ];
    }

    private static function hydrateFolderShare(array $doc): array
    {
        $exp = $doc['expires_at'] ?? null;
        return [
            'id'         => (string)($doc['_id'] ?? ''),
            'folder_id'  => $doc['folder_id'] ?? '',
            'owner_id'   => $doc['owner_id'] ?? '',
            'token'      => $doc['token'] ?? '',
            'expires_at' => ($exp instanceof UTCDateTime) ? $exp->toDateTime()->format('Y-m-d H:i:s') : null,
            'recipients' => $doc['recipients'] ?? [],
        ];
    }
}
