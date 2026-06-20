#!/bin/sh
# Bind Apache to $PORT when the host provides one (Render sets PORT=10000,
# Fly typically 8080); default to 80 for local runs and Oracle. This keeps the
# image portable across free container hosts without rebuilding.
set -e

PORT="${PORT:-80}"

# Listen directive
sed -ri "s/^Listen[[:space:]]+[0-9]+/Listen ${PORT}/" /etc/apache2/ports.conf

# VirtualHost port
sed -ri "s/<VirtualHost \*:[0-9]+>/<VirtualHost *:${PORT}>/" \
    /etc/apache2/sites-available/000-default.conf

exec apache2-foreground "$@"
