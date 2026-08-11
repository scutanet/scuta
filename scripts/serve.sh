#!/bin/bash
# Local static server for SCUTA.IO (used by LaunchAgent / manual start).
set -euo pipefail
cd "$(dirname "$0")/.."
exec /usr/bin/python3 -m http.server 8080 --bind 127.0.0.1
