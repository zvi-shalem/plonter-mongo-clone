<?php
/**
 * AuthStore — MongoDB data-access layer for authentication.
 *
 * Replaces direct SQLite3 access in:
 *   - api/admin_api.php       (users, sessions — 21 queries)
 *   - api/content_org_api.php (sessions validation — partial)
 *   - api/vocab_public_api.php (sessions validation — partial)
 *   - sharing/content_api.php  (sessions validation — partial)
 *
 * SQLite source DBs:   api/plonter_auth.db
 * Mongo collections:   users, sessions
 *
 * Keeps the same request/response contracts as the original PHP functions
 * so API files need only swap their DB calls, not their response shapes.
 *
 * IMPORTANT: This file does NOT require a live Atlas connection to load.
 * No connection is made until one of these methods is called.
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/MongoStore.php';

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

class AuthStore
{
    /** Lazy-once guard: indexes are ensured the first time any collection is accessed. */
    private static bool $indexesEnsured = false;

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private static function col(string $name): \MongoDB\Collection
    {
        $collection = MongoStore::getInstance()->getCollection($name);
        // Ensure the designed unique/TTL indexes exist exactly once per process.
        // Set the flag BEFORE calling ensureIndexes() so the nested col() calls
        // inside it do not recurse.
        if (!self::$indexesEnsured) {
            self::$indexesEnsured = true;
            try {
                self::ensureIndexes();
            } catch (\Throwable $e) {
                error_log('AuthStore::ensureIndexes failed: ' . $e->getMessage());
            }
        }
        return $collection;
    }

    /** Convert PHP timestamp or null to MongoDB UTCDateTime. */
    private static function toDate(?int $ts): ?UTCDateTime
    {
        return $ts !== null ? new UTCDateTime($ts * 1000) : null;
    }

    /** Convert MongoDB UTCDateTime to Unix timestamp. */
    private static function fromDate($date): ?int
    {
        if ($date instanceof UTCDateTime) {
            return (int)($date->toDateTime()->getTimestamp());
        }
        return null;
    }

    // -----------------------------------------------------------------
    // Ensure indexes exist (call once during setup/migration)
    // -----------------------------------------------------------------

    public static function ensureIndexes(): void
    {
        $users = self::col('users');
        // username uniqueness must be PARTIAL: the users collection holds two
        // profile shapes — simple-auth users (username/token/approved) and
        // admin-profile users (email/first_name/last_name/role, NO username).
        // A plain unique index treats missing username as null and rejects the
        // 2nd null doc (E11000). Enforce uniqueness ONLY among docs that have a
        // string username. Migrate any legacy non-partial username_1 index.
        try {
            foreach ($users->listIndexes() as $ix) {
                if ($ix->getName() === 'username_1' && !isset($ix['partialFilterExpression'])) {
                    $users->dropIndex('username_1');
                }
            }
        } catch (\Throwable $e) {
            // no existing index / cannot introspect — createIndex below handles it
        }
        $users->createIndex(
            ['username' => 1],
            ['unique' => true, 'partialFilterExpression' => ['username' => ['$type' => 'string']]]
        );
        self::col('users')->createIndex(['token' => 1]);
        self::col('sessions')->createIndex(['token' => 1], ['unique' => true]);
        // TTL: auto-expire sessions documents once expires_at is reached
        self::col('sessions')->createIndex(
            ['expires_at' => 1],
            ['expireAfterSeconds' => 0]
        );
    }

    // -----------------------------------------------------------------
    // User operations
    // -----------------------------------------------------------------

    /**
     * Find a user by bearer token.
     * Original: SELECT * FROM users WHERE token = ?
     *
     * @return array|null  Associative array with user fields, or null if not found.
     */
    public static function findUserByToken(string $token): ?array
    {
        $doc = self::col('users')->findOne(['token' => $token]);
        return $doc ? self::hydrateUser($doc) : null;
    }

    /**
     * Find a user by username (case-insensitive).
     * Original: SELECT * FROM users WHERE username = ?
     */
    public static function findUserByUsername(string $username): ?array
    {
        $doc = self::col('users')->findOne([
            'username' => ['$regex' => '^' . preg_quote($username) . '$', '$options' => 'i']
        ]);
        return $doc ? self::hydrateUser($doc) : null;
    }

    /**
     * Get all users (admin list).
     * Original: SELECT id, username, created_at, approved FROM users ORDER BY created_at DESC
     */
    public static function listUsers(): array
    {
        $cursor = self::col('users')->find(
            [],
            ['sort' => ['created_at' => -1], 'projection' => ['password_hash' => 0]]
        );
        $result = [];
        foreach ($cursor as $doc) {
            $result[] = self::hydrateUser($doc);
        }
        return $result;
    }

    /**
     * Create a new user.
     * Original: INSERT INTO users (username, password_hash, token, created_at, approved) VALUES (...)
     *
     * @return string  The new user's string ID.
     */
    public static function createUser(
        string $username,
        string $passwordHash,
        string $token,
        bool $approved = false
    ): string {
        $now = new UTCDateTime();
        $result = self::col('users')->insertOne([
            'username'      => $username,
            'password_hash' => $passwordHash,
            'token'         => $token,
            'created_at'    => $now,
            'approved'      => $approved,
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Approve a user (admin action).
     * Original: UPDATE users SET approved = 1 WHERE id = ?
     */
    public static function approveUser(string $userId): bool
    {
        $result = self::col('users')->updateOne(
            ['_id' => new ObjectId($userId)],
            ['$set' => ['approved' => true, 'approved_at' => new UTCDateTime()]]
        );
        return $result->getModifiedCount() > 0;
    }

    /**
     * Update a user's token (re-login / token rotation).
     * Original: UPDATE users SET token = ? WHERE id = ?
     */
    public static function updateToken(string $userId, string $newToken): bool
    {
        $result = self::col('users')->updateOne(
            ['_id' => new ObjectId($userId)],
            ['$set' => ['token' => $newToken]]
        );
        return $result->getModifiedCount() > 0;
    }

    // -----------------------------------------------------------------
    // Admin operations (api/admin_api.php) — the richer user profile schema
    // (email, first_name, last_name, role, password, verified). These are
    // ADDITIVE: the simple username/token/approved methods above are unchanged.
    // NOTE: SQLite integer PKs become Mongo ObjectId strings, so the 'id' these
    // return is a 24-hex string, not an int (documented in MONGO_PORT_PROGRESS.md).
    // -----------------------------------------------------------------

    /** Hydrate a user doc into the admin profile shape. */
    private static function hydrateAdminUser(array $doc): array
    {
        return [
            'id'         => (string)($doc['_id'] ?? ''),
            'email'      => $doc['email'] ?? '',
            'first_name' => $doc['first_name'] ?? '',
            'last_name'  => $doc['last_name'] ?? '',
            'role'       => $doc['role'] ?? '',
            'created_at' => isset($doc['created_at'])
                ? (self::fromDate($doc['created_at']) !== null
                    ? date('c', self::fromDate($doc['created_at']))
                    : ($doc['created_at'] ?? null))
                : null,
        ];
    }

    /**
     * Resolve a SESSION token to its user (sessions.token → users._id),
     * honoring expiry. Replaces the sessions⋈users JOIN in admin_api.php.
     * Returns ['id','email','first_name','last_name','role'] or null.
     */
    public static function findUserBySessionToken(string $token): ?array
    {
        if ($token === '') {
            return null;
        }
        $now = new UTCDateTime();
        $sess = self::col('sessions')->findOne([
            'token'      => $token,
            'expires_at' => ['$gt' => $now],
        ]);
        if ($sess === null || empty($sess['user_id'])) {
            return null;
        }
        try {
            $doc = self::col('users')->findOne(['_id' => new ObjectId((string)$sess['user_id'])]);
        } catch (\Exception $e) {
            $doc = self::col('users')->findOne(['_id' => $sess['user_id']]);
        }
        if ($doc === null) {
            return null;
        }
        $u = self::hydrateAdminUser($doc);
        unset($u['created_at']);
        return $u;
    }

    /** List all users in the admin profile shape, ordered oldest-first. */
    public static function listFullUsers(): array
    {
        $cursor = self::col('users')->find([], ['sort' => ['_id' => 1]]);
        $out = [];
        foreach ($cursor as $doc) {
            $out[] = self::hydrateAdminUser($doc);
        }
        return $out;
    }

    /** Find a user by exact email. */
    public static function findUserByEmail(string $email): ?array
    {
        $doc = self::col('users')->findOne(['email' => $email]);
        return $doc ? self::hydrateAdminUser($doc) : null;
    }

    /** Get a user by id (admin shape) or null. */
    public static function getUserById(string $userId): ?array
    {
        try {
            $doc = self::col('users')->findOne(['_id' => new ObjectId($userId)]);
        } catch (\Exception $e) {
            return null;
        }
        return $doc ? self::hydrateAdminUser($doc) : null;
    }

    /**
     * Create a full profile user (admin create_user).
     * @return string new user id (ObjectId string)
     */
    public static function createFullUser(
        string $firstName,
        string $lastName,
        string $email,
        string $passwordHash,
        string $role,
        bool $verified = true
    ): string {
        $result = self::col('users')->insertOne([
            'first_name' => $firstName,
            'last_name'  => $lastName,
            'email'      => $email,
            'password'   => $passwordHash,
            'role'       => $role,
            'verified'   => $verified ? 1 : 0,
            'created_at' => new UTCDateTime(),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Update profile fields (first_name/last_name/email). Returns modified count.
     */
    public static function updateUserProfile(string $userId, array $fields): int
    {
        $set = [];
        foreach (['first_name', 'last_name', 'email'] as $k) {
            if (array_key_exists($k, $fields)) {
                $set[$k] = $fields[$k];
            }
        }
        if (!$set) {
            return 0;
        }
        try {
            $result = self::col('users')->updateOne(
                ['_id' => new ObjectId($userId)],
                ['$set' => $set]
            );
        } catch (\Exception $e) {
            return 0;
        }
        return $result->getModifiedCount();
    }

    /** Set a user's role. Returns modified count. */
    public static function setUserRole(string $userId, string $role): int
    {
        try {
            $result = self::col('users')->updateOne(
                ['_id' => new ObjectId($userId)],
                ['$set' => ['role' => $role]]
            );
        } catch (\Exception $e) {
            return 0;
        }
        return $result->getModifiedCount();
    }

    /** Delete a user by id. Returns deleted count. */
    public static function deleteUserById(string $userId): int
    {
        try {
            $result = self::col('users')->deleteOne(['_id' => new ObjectId($userId)]);
        } catch (\Exception $e) {
            return 0;
        }
        return $result->getDeletedCount();
    }

    /** Delete all sessions for a user id (cascade on user delete). */
    public static function deleteSessionsForUser(string $userId): int
    {
        return self::col('sessions')->deleteMany(['user_id' => $userId])->getDeletedCount();
    }

    // -----------------------------------------------------------------
    // Session operations
    // -----------------------------------------------------------------

    /**
     * Find a valid session by token.
     * Original: SELECT * FROM sessions WHERE token = ? AND expires_at > NOW()
     *
     * Note: MongoDB TTL index auto-deletes expired sessions, so a findOne
     * that returns a document is already guaranteed to be non-expired.
     * This method still filters by expires_at for the race window.
     */
    public static function findSession(string $token): ?array
    {
        $now = new UTCDateTime();
        $doc = self::col('sessions')->findOne([
            'token'      => $token,
            'expires_at' => ['$gt' => $now],
        ]);
        return $doc ? self::hydrateSession($doc) : null;
    }

    /**
     * Create a new session.
     * Original: INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (...)
     */
    public static function createSession(
        string $userId,
        string $token,
        int $expiresAtTs
    ): string {
        $result = self::col('sessions')->insertOne([
            'user_id'    => $userId,
            'token'      => $token,
            'created_at' => new UTCDateTime(),
            'expires_at' => new UTCDateTime($expiresAtTs * 1000),
        ]);
        return (string)$result->getInsertedId();
    }

    /**
     * Delete (invalidate) a session by token.
     * Original: DELETE FROM sessions WHERE token = ?
     */
    public static function deleteSession(string $token): bool
    {
        $result = self::col('sessions')->deleteOne(['token' => $token]);
        return $result->getDeletedCount() > 0;
    }

    /**
     * Delete all sessions for a user (logout everywhere).
     * Original: DELETE FROM sessions WHERE user_id = ?
     */
    public static function deleteUserSessions(string $userId): int
    {
        $result = self::col('sessions')->deleteMany(['user_id' => $userId]);
        return $result->getDeletedCount();
    }

    // -----------------------------------------------------------------
    // Private hydrators: MongoDB doc → PHP associative array
    // These preserve the same field names the API layer expects.
    // -----------------------------------------------------------------

    private static function hydrateUser(array $doc): array
    {
        return [
            'id'            => (string)($doc['_id'] ?? ''),
            'username'      => $doc['username'] ?? '',
            'password_hash' => $doc['password_hash'] ?? '',
            'token'         => $doc['token'] ?? '',
            'approved'      => (bool)($doc['approved'] ?? false),
            'created_at'    => self::fromDate($doc['created_at'] ?? null),
            'approved_at'   => self::fromDate($doc['approved_at'] ?? null),
        ];
    }

    private static function hydrateSession(array $doc): array
    {
        return [
            'id'         => (string)($doc['_id'] ?? ''),
            'user_id'    => $doc['user_id'] ?? '',
            'token'      => $doc['token'] ?? '',
            'created_at' => self::fromDate($doc['created_at'] ?? null),
            'expires_at' => self::fromDate($doc['expires_at'] ?? null),
        ];
    }
}
