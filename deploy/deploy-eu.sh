#!/usr/bin/env bash
# Deploy SCUTA.IO regional arena — Europe (Amsterdam)
# Usage: ./deploy/deploy-eu.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

deploy_region "EU"
