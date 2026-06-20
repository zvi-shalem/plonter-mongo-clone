<?php
/**
 * AiDictStore — MongoDB data-access layer for the AI dictionary cache.
 *
 * Replaces direct SQLite3 access in:
 *   - api/ai_dict_cache.php  (24 queries)
 *
 * SQLite source DB: plonter_data.db (tables: ai_dict_cache, ai_dict_likes)
 * Mongo collection: ai_dict_cache  (ai_dict_likes embedded as 'likes' field)
 *
 * Embedding likes inside the cache doc is valid because:
 *   - Likes are always read/written together with the term+stage entry
 *   - The set of likes per term+stage is small (one doc per (term, stage, meaning_key))
 *
 * Compound index on (term, stage) ensures uniqueness and fast lookups.
 *
 * SYNTAX-CLEAN — untested pending Atlas connection.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\UTCDateTime;

class AiDictStore
{
    /** Lazy-once guard: indexes are ensured the first time the collection is accessed. */
    private static bool $indexesEnsured = false;

    private static function col(): \MongoDB\Collection
    {
        $collection = MongoStore::getInstance()->getCollection('ai_dict_cache');
        if (!self::$indexesEnsured) {
            self::$indexesEnsured = true;
            try {
                self::ensureIndexes();
            } catch (\Throwable $e) {
                error_log('AiDictStore::ensureIndexes failed: ' . $e->getMessage());
            }
        }
        return $collection;
    }

    public static function ensureIndexes(): void
    {
        self::col()->createIndex(['term' => 1, 'stage' => 1], ['unique' => true]);
        self::col()->createIndex(['term' => 1, 'hit_count' => -1]);
    }

    // -----------------------------------------------------------------
    // lookup (action=lookup)
    //   Original: SELECT result_json WHERE term+stage → UPDATE hit_count++
    // -----------------------------------------------------------------

    /**
     * Look up a cached result for term+stage.
     * Increments hit_count on a cache hit.
     *
     * @return array|null  {found: bool, result: mixed, likes: array}
     */
    public static function lookup(string $term, string $stage): ?array
    {
        $doc = self::col()->findOne(['term' => $term, 'stage' => $stage]);
        if ($doc === null) {
            return ['found' => false];
        }

        // Increment hit_count asynchronously (don't block the response)
        self::col()->updateOne(
            ['term' => $term, 'stage' => $stage],
            ['$inc' => ['hit_count' => 1], '$set' => ['updated_at' => new UTCDateTime()]]
        );

        $result = $doc['result_json'] ?? null;
        if (is_string($result)) {
            $result = json_decode($result, true) ?? $result;
        }

        return [
            'found'  => true,
            'result' => $result,
            'likes'  => $doc['likes'] ?? [],
        ];
    }

    // -----------------------------------------------------------------
    // save (action=save)
    //   Original: SELECT-then-UPDATE/INSERT (no ON CONFLICT)
    // -----------------------------------------------------------------

    /**
     * Upsert a cache entry.
     *
     * @param string|array $resultJson  Raw JSON string OR decoded array (stored as string for compat)
     */
    public static function save(string $term, string $stage, $resultJson): bool
    {
        $rjString = is_array($resultJson) ? json_encode($resultJson, JSON_UNESCAPED_UNICODE) : $resultJson;
        $now = new UTCDateTime();

        $result = self::col()->updateOne(
            ['term' => $term, 'stage' => $stage],
            [
                '$set'         => ['result_json' => $rjString, 'updated_at' => $now],
                '$setOnInsert' => ['created_at' => $now, 'hit_count' => 0, 'likes' => []],
            ],
            ['upsert' => true]
        );

        return $result->getUpsertedCount() > 0 || $result->getModifiedCount() > 0;
    }

    // -----------------------------------------------------------------
    // save_related (action=save_related)
    //   Original: INSERT only if no primary entry exists (insert-guard)
    //   Uses stage='' for related/cross-referenced entries
    // -----------------------------------------------------------------

    /**
     * Save a related/secondary cache entry. Only inserts; never overwrites an
     * existing one.
     *
     * NOTE (Phase 5b fix, 2026-06-19): the original api/ai_dict_cache.php
     * `save_related` action inserts the entry at stage='primary' (insert-only
     * if no primary exists yet), so that a later lookup(term,'primary') finds
     * it. This adapter previously used stage='' which diverged from that
     * contract and made the integrated endpoint's lookup miss. Corrected to
     * 'primary' to match the API it replaces.
     */
    public static function saveRelated(string $term, $resultJson): bool
    {
        $existing = self::col()->findOne(['term' => $term, 'stage' => 'primary']);
        if ($existing !== null) {
            return false; // guard: don't overwrite primary
        }

        $rjString = is_array($resultJson) ? json_encode($resultJson, JSON_UNESCAPED_UNICODE) : $resultJson;
        $now = new UTCDateTime();

        try {
            self::col()->insertOne([
                'term'        => $term,
                'stage'       => 'primary',
                'result_json' => $rjString,
                'hit_count'   => 0,
                'likes'       => [],
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
            return true;
        } catch (\MongoDB\Driver\Exception\BulkWriteException $e) {
            return false; // duplicate key on race condition — OK
        }
    }

    // -----------------------------------------------------------------
    // like (action=like)
    //   Original: SELECT-then-UPDATE/INSERT on ai_dict_likes
    //   Embedded: likes is an array of {meaning_key, count} on the cache doc
    // -----------------------------------------------------------------

    /**
     * Increment or decrement a like counter for a specific meaning key.
     *
     * @param int $delta  +1 or -1
     * @return array  {ok: bool, likes: int}
     */
    public static function like(string $term, string $stage, string $meaningKey, int $delta): array
    {
        $doc = self::col()->findOne(['term' => $term, 'stage' => $stage]);
        if ($doc === null) {
            return ['ok' => false, 'likes' => 0];
        }

        // Find or create the likes entry for this meaning_key
        $likes = $doc['likes'] ?? [];
        $found = false;
        foreach ($likes as &$like) {
            if ($like['meaning_key'] === $meaningKey) {
                $like['count'] = max(0, ($like['count'] ?? 0) + $delta);
                $found = true;
                break;
            }
        }
        unset($like);

        if (!$found) {
            $likes[] = ['meaning_key' => $meaningKey, 'count' => max(0, $delta)];
        }

        self::col()->updateOne(
            ['term' => $term, 'stage' => $stage],
            ['$set' => ['likes' => $likes, 'updated_at' => new UTCDateTime()]]
        );

        // Return the updated count for this meaning_key
        $newCount = 0;
        foreach ($likes as $like) {
            if ($like['meaning_key'] === $meaningKey) {
                $newCount = $like['count'];
                break;
            }
        }

        return ['ok' => true, 'likes' => $newCount];
    }

    // -----------------------------------------------------------------
    // suggest (action=suggest)
    //   Original: SELECT DISTINCT term WHERE term LIKE prefix% ORDER BY hit_count DESC LIMIT N
    // -----------------------------------------------------------------

    /**
     * Suggest terms by prefix, ordered by popularity.
     *
     * @return string[]
     */
    public static function suggest(string $prefix, int $limit = 10, ?string $stage = null): array
    {
        $filter = ['term' => ['$regex' => '^' . preg_quote($prefix), '$options' => 'i']];
        if ($stage !== null) {
            // Original ai_dict_cache.php suggest filters stage='primary'.
            $filter['stage'] = $stage;
        }
        $cursor = self::col()->find(
            $filter,
            [
                'sort'       => ['hit_count' => -1],
                'limit'      => $limit,
                'projection' => ['term' => 1],
            ]
        );

        $terms = [];
        $seen  = [];
        foreach ($cursor as $doc) {
            $t = $doc['term'] ?? '';
            if ($t !== '' && !isset($seen[$t])) {
                $terms[] = $t;
                $seen[$t] = true;
            }
        }
        return $terms;
    }
}
