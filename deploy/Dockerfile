# Plonter MongoDB clone — container image for free container hosts (Render / Fly / Oracle).
#
# Reproduces the LIVE path layout: every PHP API is reachable at /plonter/api/<name>.php
# and the React SPA is served at /plonter/clone/. The app reads its Mongo connection
# string from the MONGO_URI environment variable ONLY (never baked into the image).
#
# Build context MUST be the repo root (projects/plonter_mongo_clone), e.g.:
#   docker build -f deploy/Dockerfile -t plonter-mongo-clone .

FROM php:8.2-apache

# ---------------------------------------------------------------------------
# 1. PHP mongodb PECL extension (required at runtime by mongodb/mongodb in vendor/)
#    + system libs it links against.
# ---------------------------------------------------------------------------
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libssl-dev pkg-config; \
    pecl install mongodb; \
    docker-php-ext-enable mongodb; \
    apt-get purge -y --auto-remove pkg-config; \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# 2. Apache: rewrite module (for the live /plonter/api/ path mapping) + our vhost
#    + PHP upload limits (mod_php ignores per-dir .user.ini, so set them globally).
# ---------------------------------------------------------------------------
RUN a2enmod rewrite
COPY deploy/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/php-uploads.ini  /usr/local/etc/php/conf.d/zz-plonter-uploads.ini
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ---------------------------------------------------------------------------
# 3. App code — reproduce the live /plonter/ layout under the docroot.
#    DocumentRoot is /var/www/html (default), so the app lives at /var/www/html/plonter.
#
#    Path-resolution invariant the PHP files rely on:
#      api/*.php                       -> __DIR__/../vendor , __DIR__/../mongo_adapter
#      sharing/content*_api.php        -> __DIR__/../vendor , __DIR__/../mongo_adapter
#      media_api.php (repo root)       -> __DIR__/vendor   , __DIR__/mongo_adapter   (siblings)
#    => vendor/ + mongo_adapter/ sit at /plonter/ (parent of api/ and sharing/, sibling of media_api.php).
#    The sharing/ endpoints and root media_api.php are exposed under /plonter/api/ via
#    Apache rewrites (see 000-default.conf); rewriting keeps each file's physical __DIR__,
#    so the relative require_once paths stay valid. No PHP source is modified.
# ---------------------------------------------------------------------------
COPY api/                          /var/www/html/plonter/api/
COPY mongo_adapter/                /var/www/html/plonter/mongo_adapter/
COPY vendor/                       /var/www/html/plonter/vendor/
COPY composer.json composer.lock   /var/www/html/plonter/
COPY sharing/content_api.php        /var/www/html/plonter/sharing/content_api.php
COPY sharing/content_share_api.php  /var/www/html/plonter/sharing/content_share_api.php
COPY sharing/auth_common.php        /var/www/html/plonter/sharing/auth_common.php
COPY media_api.php                  /var/www/html/plonter/media_api.php
COPY clone/                        /var/www/html/plonter/clone/

# ---------------------------------------------------------------------------
# 4. Defensive cleanup: ensure no SQLite data, no clone-local api/, no test dirs
#    or local media blobs ever live in the running image (belt-and-braces on top
#    of .dockerignore). The clone MUST NOT carry its own api/ (empty DBs) — it
#    calls the absolute /plonter/api/ backend.
# ---------------------------------------------------------------------------
RUN set -eux; \
    rm -f  /var/www/html/plonter/api/*.db; \
    rm -rf /var/www/html/plonter/api/vocab_audio_blobs; \
    rm -rf /var/www/html/plonter/clone/api; \
    rm -rf /var/www/html/plonter/clone/tests; \
    rm -f  /var/www/html/plonter/.mongo_uri; \
    chown -R www-data:www-data /var/www/html

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
