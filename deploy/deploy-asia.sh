#!/usr/bin/env bash
# Deploy SCUTA.IO regional arena — Asia (Singapore)
# Usage: ./deploy/deploy-asia.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

deploy_region "ASIA"
