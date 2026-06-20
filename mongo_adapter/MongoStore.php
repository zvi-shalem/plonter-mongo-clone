<?php
/**
 * MongoStore — singleton connection bootstrap for the Plonter → MongoDB port.
 *
 * Usage:
 *   require_once __DIR__ . '/../vendor/autoload.php';
 *   require_once __DIR__ . '/MongoStore.php';
 *
 *   $col = MongoStore::getInstance()->getCollection('users');
 *
 * Connection URI is read from (in order of priority):
 *   1. MONGO_URI environment variable
 *   2. .mongo_uri file in the project root (one line, no trailing newline needed)
 *
 * The actual TCP connection is deferred until the first MongoDB operation.
 * Building and loading this file never requires a live Atlas cluster.
 */

use MongoDB\Client;
use MongoDB\Collection;
use MongoDB\Database;

class MongoStore
{
    private static ?MongoStore $instance = null;

    private ?Client $client = null;
    private ?Database $db = null;

    // Project root = one level up from this file's directory (mongo_adapter/)
    private string $projectRoot;

    // Database name to use on the Atlas cluster
    private string $dbName = 'plonter';

    private function __construct()
    {
        $this->projectRoot = dirname(__DIR__);
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    // -----------------------------------------------------------------
    // URI resolution
    // -----------------------------------------------------------------

    private function resolveUri(): string
    {
        // 1. Environment variable
        $envUri = getenv('MONGO_URI');
        if ($envUri !== false && $envUri !== '') {
            return $envUri;
        }

        // 2. .mongo_uri file
        $uriFile = $this->projectRoot . '/.mongo_uri';
        if (file_exists($uriFile)) {
            $uri = trim(file_get_contents($uriFile));
            if ($uri !== '') {
                return $uri;
            }
        }

        throw new \RuntimeException(
            'MongoDB URI not configured. ' .
            'Set MONGO_URI env var or write the URI to ' . $uriFile
        );
    }

    // -----------------------------------------------------------------
    // Lazy connect
    // -----------------------------------------------------------------

    private function connect(): void
    {
        if ($this->client !== null) {
            return;
        }

        $uri = $this->resolveUri();

        // Allow an isolated database to be selected without touching real data.
        // Production leaves MONGO_DB unset → 'plonter'. The test harness sets
        // MONGO_DB=plonter_test so its scratch wipes never hit migrated data.
        $envDb = getenv('MONGO_DB');
        if ($envDb !== false && $envDb !== '') {
            $this->dbName = $envDb;
        }

        $this->client = new Client($uri, [], [
            'typeMap' => [
                'array'    => 'array',
                'document' => 'array',
                'root'     => 'array',
            ],
        ]);

        $this->db = $this->client->selectDatabase($this->dbName);
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Get a MongoDB Collection by name.
     * Triggers a lazy connection on first call.
     */
    public function getCollection(string $name): Collection
    {
        $this->connect();
        return $this->db->selectCollection($name);
    }

    /**
     * Direct access to the Database object (for transactions, aggregations, etc.)
     */
    public function getDatabase(): Database
    {
        $this->connect();
        return $this->db;
    }

    /**
     * Ping the Atlas cluster.  Returns true on success, false if unreachable.
     * Use this only for health checks / integration tests — not in hot paths.
     */
    public function ping(): bool
    {
        try {
            $this->connect();
            $this->db->command(['ping' => 1]);
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Return a human-readable connection status string (for diagnostics).
     */
    public function status(): string
    {
        try {
            $uri = $this->resolveUri();
            // Mask password in log output
            $masked = preg_replace('|://[^:]+:[^@]+@|', '://*:*@', $uri);
            if ($this->client !== null) {
                return "connected (URI: $masked, db: {$this->dbName})";
            }
            return "configured but not yet connected (URI: $masked)";
        } catch (\RuntimeException $e) {
            return "not configured: " . $e->getMessage();
        }
    }
}
