<?php
/**
 * VocabAudioStore — MongoDB data-access layer for vocabulary audio sharing.
 *
 * Replaces direct SQLite3 access in:
 *   - api/vocab_share_api.php      (50 queries)
 *   - sharing/ref_vocab_share_api.php  (50 queries)
 *
 * SQLite source DB: plonter_vocab_audio.db
 *   Tables: vocab_audio, vocab_share_tokens
 * Auth DB: plonter_auth.db (users table — for role checks)
 *   → Auth queries delegated to AuthStore
 *
 * Mongo collections: vocab_audio, vocab_share_tokens
 *
 * TTL index on vocab_share_tokens.expires_at auto-purges expired tokens.
 *
 * Schema notes from the original:
 *   - vocab_share_tokens has lazy-added columns: words_json, is_group, group_name, categories_json
 *   - These become optional fields in the Mongo doc (no schema migration headaches)
 *
 * SYNTAX-CLEAN — untested pending Atlas connection.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

class VocabAudioStore
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
                error_log('VocabAudioStore::ensureIndexes failed: ' . $e->getMessage());
            }
        }
        return $collection;
    }

    public static function ensureIndexes(): void
    {
        self::col('vocab_share_tokens')->createIndex(['token' => 1], ['unique' => true]);
        self::col('vocab_share_tokens')->createIndex(['owner_user_id' => 1]);
        self::col('vocab_share_tokens')->createIndex(
            ['expires_at' => 1],
            ['expireAfterSeconds' => 0]  // TTL: auto-delete expired tokens
        );
        self::col('vocab_audio')->createIndex(['token_id' => 1]);
        self::col('vocab_audio')->createIndex(['term' => 1, 'category' => 1]);
    }

    // -----------------------------------------------------------------
    // Share tokens
    // -----------------------------------------------------------------

    /**
     * Create a new share token.
     * Original: INSERT INTO vocab_share_tokens
     *
     * @return string  The 32-hex token string
     */
    public static function createToken(
        string $ownerUserId,
        string $token,
        string $category,
        ?int $ttlSeconds = null,
        ?string $wordsJson = null,
        bool $isGroup = false,
        ?string $groupName = null,
        ?string $categoriesJson = null
    ): string {
        $now = new UTCDateTime();
        $expiresAt = $ttlSeconds !== null ? new UTCDateTime((time() + $ttlSeconds) * 1000) : null;

        self::col('vocab_share_tokens')->insertOne([
            'token'           => $token,
            'owner_user_id'   => $ownerUserId,
            'category'        => $category,
            'created_at'      => $now,
            'expires_at'      => $expiresAt,
            'revoked'         => false,
            'words_json'      => $wordsJson,
            'is_group'        => $isGroup,
            'group_name'      => $groupName,
            'categories_json' => $categoriesJson,
        ]);

        return $token;
    }

    /**
     * Get token info (for action=info, open/public endpoint).
     */
    public static function getTokenInfo(string $token): ?array
    {
        $doc = self::col('vocab_share_tokens')->findOne(['token' => $token]);
        if ($doc === null) {
            return null;
        }
        return self::hydrateToken($doc);
    }

    /**
     * Validate a token for upload: not revoked, not expired, category matches.
     *
     * @return array|null  Token doc if valid, null if invalid
     */
    public static function validateToken(string $token, string $category): ?array
    {
        $now = new UTCDateTime();
        $doc = self::col('vocab_share_tokens')->findOne([
            'token'    => $token,
            'category' => $category,
            'revoked'  => ['$ne' => true],
            '$or'      => [
                ['expires_at' => null],
                ['expires_at' => ['$gt' => $now]],
            ],
        ]);
        return $doc ? self::hydrateToken($doc) : null;
    }

    /**
     * List all tokens owned by a user.
     * Original: SELECT * WHERE owner_user_id
     */
    public static function listTokens(string $ownerUserId): array
    {
        $cursor = self::col('vocab_share_tokens')->find(
            ['owner_user_id' => $ownerUserId],
            ['sort' => ['created_at' => -1]]
        );
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateToken($doc);
        }
        return $result;
    }

    /**
     * Revoke a token (set revoked=true).
     * Original: UPDATE vocab_share_tokens SET revoked=1 WHERE token AND owner_user_id
     */
    public static function revokeToken(string $ownerUserId, string $token): bool
    {
        $result = self::col('vocab_share_tokens')->updateOne(
            ['token' => $token, 'owner_user_id' => $ownerUserId],
            ['$set' => ['revoked' => true]]
        );
        return $result->getMatchedCount() > 0;
    }

    // -----------------------------------------------------------------
    // Vocab audio records
    // -----------------------------------------------------------------

    /**
     * Insert a new vocab audio record (called after successful upload).
     * Original: INSERT INTO vocab_audio
     */
    public static function addAudio(
        string $tokenId,
        string $term,
        string $category,
        string $filePath,
        ?string $uploaderUserId = null
    ): string {
        $result = self::col('vocab_audio')->insertOne([
            'token_id'          => $tokenId,
            'term'              => $term,
            'category'          => $category,
            'file_path'         => $filePath,
            'uploader_user_id'  => $uploaderUserId,
            'created_at'        => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * List audio files for a category (or all).
     */
    public static function listAudio(?string $category = null, ?string $tokenId = null): array
    {
        $filter = [];
        if ($category !== null) {
            $filter['category'] = $category;
        }
        if ($tokenId !== null) {
            $filter['token_id'] = $tokenId;
        }

        $cursor = self::col('vocab_audio')->find($filter, ['sort' => ['created_at' => -1]]);
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateAudio($doc);
        }
        return $result;
    }

    /**
     * Get audio by term and category.
     */
    public static function getAudio(string $term, string $category): ?array
    {
        $doc = self::col('vocab_audio')->findOne(['term' => $term, 'category' => $category]);
        return $doc ? self::hydrateAudio($doc) : null;
    }

    /**
     * Delete an audio record.
     */
    public static function deleteAudio(string $audioId, ?string $ownerTokenId = null): bool
    {
        $filter = [];
        try {
            $filter['_id'] = new ObjectId($audioId);
        } catch (\Exception $e) {
            return false;
        }
        if ($ownerTokenId !== null) {
            $filter['token_id'] = $ownerTokenId;
        }

        $result = self::col('vocab_audio')->deleteOne($filter);
        return $result->getDeletedCount() > 0;
    }

    // -----------------------------------------------------------------
    // Hydrators
    // -----------------------------------------------------------------

    private static function hydrateToken(array $doc): array
    {
        $expiresAt = $doc['expires_at'] ?? null;
        return [
            'id'              => (string)($doc['_id'] ?? ''),
            'token'           => $doc['token'] ?? '',
            'owner_user_id'   => $doc['owner_user_id'] ?? '',
            'category'        => $doc['category'] ?? '',
            'revoked'         => (bool)($doc['revoked'] ?? false),
            'created_at'      => ($expiresAt instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
            'expires_at'      => ($expiresAt instanceof UTCDateTime)
                ? $expiresAt->toDateTime()->format('Y-m-d H:i:s')
                : null,
            'words_json'      => $doc['words_json'] ?? null,
            'is_group'        => (bool)($doc['is_group'] ?? false),
            'group_name'      => $doc['group_name'] ?? null,
            'categories_json' => $doc['categories_json'] ?? null,
        ];
    }

    private static function hydrateAudio(array $doc): array
    {
        return [
            'id'                => (string)($doc['_id'] ?? ''),
            'token_id'          => $doc['token_id'] ?? '',
            'term'              => $doc['term'] ?? '',
            'category'          => $doc['category'] ?? '',
            'file_path'         => $doc['file_path'] ?? '',
            'uploader_user_id'  => $doc['uploader_user_id'] ?? null,
            'created_at'        => ($doc['created_at'] instanceof UTCDateTime)
                ? $doc['created_at']->toDateTime()->format('Y-m-d H:i:s')
                : ($doc['created_at'] ?? null),
        ];
    }
}
