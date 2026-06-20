<?php
/**
 * VocabShareStore — Phase 5b. Faithful MongoDB port of the vocab-share data layer
 * used by api/vocab_share_api.php and sharing/ref_vocab_share_api.php.
 *
 * The original two files used __DIR__-relative SQLite DBs (api/ vs sharing/), i.e.
 * TWO independent datastores running identical code. This store preserves that
 * separation via a collection PREFIX set per file:
 *   - api/vocab_share_api.php       → prefix ''     (vocab_share_tokens, vocab_audio)
 *   - sharing/ref_vocab_share_api.php → prefix 'ref_' (ref_vocab_share_tokens, ref_vocab_audio)
 *
 * It uses its OWN collections (not the section-09 VocabAudioStore ones), so the
 * 135 adapter tests (which exercise VocabAudioStore's different schema) are
 * untouched. Schema mirrors the original SQLite tables exactly:
 *
 *   <p>vocab_share_tokens: token(PK), owner_user_id, category, created_at(int),
 *       expires_at(int), revoked(int 0/1), last_used_at(int|null), words_json,
 *       is_group(int 0/1), group_name, categories_json
 *   <p>vocab_audio: id(uuid), user_id, word_key, cat_name, mime, path, size_bytes,
 *       recorder_name, lang, is_hidden(int), created_at(int)
 *
 * owner_user_id / user_id are AuthStore ObjectId strings (int→ObjectId decision);
 * compared as strings (no intval). Blob disk I/O stays in the API file.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

class VocabShareStore
{
    /** Collection-name prefix — set per API file ('' or 'ref_'). */
    public static string $prefix = '';

    private static bool $indexesEnsured = false;

    private static function tokCol(): \MongoDB\Collection
    {
        $c = MongoStore::getInstance()->getCollection(self::$prefix . 'vocab_share_tokens');
        if (!self::$indexesEnsured) {
            self::$indexesEnsured = true;
            try { self::ensureIndexes(); } catch (\Throwable $e) { error_log('VocabShareStore::ensureIndexes: ' . $e->getMessage()); }
        }
        return $c;
    }
    private static function audCol(): \MongoDB\Collection
    {
        return MongoStore::getInstance()->getCollection(self::$prefix . 'vocab_audio');
    }

    public static function ensureIndexes(): void
    {
        self::tokCol()->createIndex(['token' => 1], ['unique' => true]);
        self::tokCol()->createIndex(['owner_user_id' => 1]);
        self::tokCol()->createIndex(['category' => 1]);
        self::audCol()->createIndex(['user_id' => 1, 'cat_name' => 1, 'word_key' => 1]);
    }

    // --------------------------------------------------------------- tokens

    public static function insertToken(array $doc): void
    {
        self::tokCol()->insertOne($doc);
    }

    /** Load a token row as a plain assoc (SQLite-row-shaped), or null. */
    public static function loadToken(string $token): ?array
    {
        if ($token === '') return null;
        $d = self::tokCol()->findOne(['token' => $token]);
        if (!$d) return null;
        return self::tokRow($d);
    }

    private static function tokRow($d): array
    {
        return [
            'token'           => $d['token'] ?? '',
            'owner_user_id'   => $d['owner_user_id'] ?? '',
            'category'        => $d['category'] ?? '',
            'created_at'      => (int)($d['created_at'] ?? 0),
            'expires_at'      => (int)($d['expires_at'] ?? 0),
            'revoked'         => (int)($d['revoked'] ?? 0),
            'last_used_at'    => isset($d['last_used_at']) && $d['last_used_at'] !== null ? (int)$d['last_used_at'] : null,
            'words_json'      => $d['words_json'] ?? null,
            'is_group'        => (int)($d['is_group'] ?? 0),
            'group_name'      => $d['group_name'] ?? null,
            'categories_json' => $d['categories_json'] ?? null,
        ];
    }

    public static function listTokens(string $ownerId): array
    {
        $out = [];
        foreach (self::tokCol()->find(['owner_user_id' => $ownerId], ['sort' => ['created_at' => -1]]) as $d) {
            $out[] = self::tokRow($d);
        }
        return $out;
    }

    /** Tokens for a category; $ownerId null = all owners. */
    public static function tokensByCategory(string $category, ?string $ownerId): array
    {
        $filter = ['category' => $category];
        if ($ownerId !== null) $filter['owner_user_id'] = $ownerId;
        $out = [];
        foreach (self::tokCol()->find($filter, ['sort' => ['created_at' => -1]]) as $d) {
            $out[] = self::tokRow($d);
        }
        return $out;
    }

    /** Group tokens by name; $ownerId null = all owners. */
    public static function groupTokensByName(string $groupName, ?string $ownerId): array
    {
        $filter = ['is_group' => 1, 'group_name' => $groupName];
        if ($ownerId !== null) $filter['owner_user_id'] = $ownerId;
        $out = [];
        foreach (self::tokCol()->find($filter, ['sort' => ['created_at' => -1]]) as $d) {
            $out[] = self::tokRow($d);
        }
        return $out;
    }

    public static function revokeToken(string $token, string $ownerId): int
    {
        return self::tokCol()->updateOne(
            ['token' => $token, 'owner_user_id' => $ownerId],
            ['$set' => ['revoked' => 1]]
        )->getModifiedCount();
    }

    public static function revokeCategoryTokens(string $ownerId, string $category): int
    {
        return self::tokCol()->updateMany(
            ['owner_user_id' => $ownerId, 'category' => $category, 'revoked' => 0],
            ['$set' => ['revoked' => 1]]
        )->getModifiedCount();
    }

    public static function touchToken(string $token, int $ts): void
    {
        self::tokCol()->updateOne(['token' => $token], ['$set' => ['last_used_at' => $ts]]);
    }

    /** Per-category words refresh on active, non-group tokens. Returns modified count. */
    public static function refreshWords(string $ownerId, string $category, string $wordsJson, int $now): int
    {
        return self::tokCol()->updateMany(
            ['owner_user_id' => $ownerId, 'category' => $category, 'revoked' => 0,
             'expires_at' => ['$gt' => $now], 'is_group' => 0],
            ['$set' => ['words_json' => $wordsJson]]
        )->getModifiedCount();
    }

    public static function refreshGroup(string $token, string $ownerId, string $catsJson, string $groupName): int
    {
        return self::tokCol()->updateOne(
            ['token' => $token, 'owner_user_id' => $ownerId],
            ['$set' => ['categories_json' => $catsJson, 'group_name' => $groupName, 'category' => $groupName]]
        )->getModifiedCount();
    }

    // --------------------------------------------------------------- audio

    /**
     * Existing (non-hidden) recordings for (owner, cat), grouped by lang:
     * returns ['keys'=>['ar'=>[wk..],'he'=>[..]], 'names'=>['ar'=>[wk=>name],'he'=>[..]]].
     * Newest-first; first occurrence per (lang,wk) wins.
     */
    public static function existingFor(string $ownerId, string $catName): array
    {
        $byLang = ['ar' => [], 'he' => []];
        $namesByLang = ['ar' => [], 'he' => []];
        $cursor = self::audCol()->find(
            ['user_id' => $ownerId, 'cat_name' => $catName, 'is_hidden' => ['$ne' => 1]],
            ['sort' => ['created_at' => -1]]
        );
        foreach ($cursor as $ro) {
            $wk = $ro['word_key'] ?? '';
            $lg = ($ro['lang'] ?? 'ar') ?: 'ar';
            if (!isset($byLang[$lg])) $byLang[$lg] = [];
            if (!isset($namesByLang[$lg])) $namesByLang[$lg] = [];
            if (!in_array($wk, $byLang[$lg], true)) {
                $byLang[$lg][] = $wk;
                $namesByLang[$lg][$wk] = (string)($ro['recorder_name'] ?? '');
            }
        }
        return ['keys' => $byLang, 'names' => $namesByLang];
    }

    /** Recordings for (owner, cat, word_key) — returns [['id'=>,'path'=>], ...]. */
    public static function recordingsFor(string $ownerId, string $catName, string $wordKey): array
    {
        $out = [];
        foreach (self::audCol()->find(['user_id' => $ownerId, 'cat_name' => $catName, 'word_key' => $wordKey]) as $d) {
            $out[] = ['id' => $d['id'] ?? (string)($d['_id'] ?? ''), 'path' => $d['path'] ?? ''];
        }
        return $out;
    }

    /** Replace-mode: recordings for (owner, wk, cat, lang) — returns rows to unlink+delete. */
    public static function recordingsForLang(string $ownerId, string $wordKey, string $catName, string $lang): array
    {
        $out = [];
        foreach (self::audCol()->find(['user_id' => $ownerId, 'word_key' => $wordKey, 'cat_name' => $catName,
                'lang' => $lang]) as $d) {
            $out[] = ['id' => $d['id'] ?? (string)($d['_id'] ?? ''), 'path' => $d['path'] ?? ''];
        }
        // also match docs where lang missing and requested lang is 'ar' (COALESCE(lang,'ar'))
        if ($lang === 'ar') {
            foreach (self::audCol()->find(['user_id' => $ownerId, 'word_key' => $wordKey, 'cat_name' => $catName,
                    'lang' => ['$exists' => false]]) as $d) {
                $out[] = ['id' => $d['id'] ?? (string)($d['_id'] ?? ''), 'path' => $d['path'] ?? ''];
            }
        }
        return $out;
    }

    public static function deleteAudioByIds(array $ids): void
    {
        if (!$ids) return;
        self::audCol()->deleteMany(['id' => ['$in' => array_values($ids)]]);
    }

    /** Latest non-hidden recording for (owner, cat, wk, lang) → {path, mime} or null. */
    public static function latestRecording(string $ownerId, string $catName, string $wordKey, string $lang): ?array
    {
        // COALESCE(lang,'ar') = lang  → for 'ar', also match missing lang.
        $langClause = ($lang === 'ar')
            ? ['$or' => [['lang' => 'ar'], ['lang' => ['$exists' => false]], ['lang' => null]]]
            : ['lang' => $lang];
        $filter = array_merge(
            ['user_id' => $ownerId, 'cat_name' => $catName, 'word_key' => $wordKey, 'is_hidden' => ['$ne' => 1]],
            $langClause
        );
        $d = self::audCol()->findOne($filter, ['sort' => ['created_at' => -1]]);
        if (!$d) return null;
        return ['path' => $d['path'] ?? '', 'mime' => $d['mime'] ?? 'application/octet-stream'];
    }

    public static function insertAudio(array $doc): void
    {
        self::audCol()->insertOne($doc);
    }
}
