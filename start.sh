#!/usr/bin/env sh
# Starts the scoreboard server and opens the control panel (macOS / Linux).
#   ./start.sh            local only
#   ./start.sh --lan      also reachable from other devices on your network
#   ./start.sh --port=9000
cd "$(dirname "$0")" || exit 1

if ! command -v php >/dev/null 2>&1; then
    echo "PHP 7.4 or newer is required."
    echo "  macOS:          brew install php"
    echo "  Debian/Ubuntu:  sudo apt install php-cli"
    exit 1
fi

exec php server.php --open "$@"
