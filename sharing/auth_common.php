<?php
// sharing/auth_common.php — Phase 5b shim. Re-exports the canonical Mongo-backed
// auth_common from api/ so both the api/ and sharing/ vocab-share files share one
// implementation (respond / getToken / getUserFromToken / requireAuth / role helpers).
require_once __DIR__ . '/../api/auth_common.php';
