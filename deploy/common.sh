#!/usr/bin/env bash
# Shared deploy helpers for SCUTA.IO regional VPS boxes.
# Override via environment or deploy/config.env:
#   DEPLOY_USER, DEPLOY_PATH, DEPLOY_BRANCH
#   NA_HOST / EU_HOST / ASIA_HOST
#   NA_IP / EU_IP / ASIA_IP
#   NA_KEY / EU_KEY / ASIA_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SCRIPT_DIR}/config.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/config.env"
fi

DEPLOY_USER="${DEPLOY_USER:-scuta}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/scuta.io}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

NA_HOST="${NA_HOST:-na.scuta.io}"
EU_HOST="${EU_HOST:-eu.scuta.io}"
ASIA_HOST="${ASIA_HOST:-asia.scuta.io}"

NA_IP="${NA_IP:-}"
EU_IP="${EU_IP:-}"
ASIA_IP="${ASIA_IP:-}"

NA_KEY="${NA_KEY:-scuta-key.pem}"
EU_KEY="${EU_KEY:-scuta-key-eu.pem}"
ASIA_KEY="${ASIA_KEY:-scuta-key-asia.pem}"

# Prefer IP for SSH when set; fall back to hostname.
host_for_region() {
  case "$1" in
    NA) echo "${NA_IP:-$NA_HOST}" ;;
    EU) echo "${EU_IP:-$EU_HOST}" ;;
    ASIA) echo "${ASIA_IP:-$ASIA_HOST}" ;;
    *)
      echo "Unknown region: $1" >&2
      return 1
      ;;
  esac
}

key_for_region() {
  case "$1" in
    NA) echo "${NA_KEY}" ;;
    EU) echo "${EU_KEY}" ;;
    ASIA) echo "${ASIA_KEY}" ;;
    *)
      echo "Unknown region: $1" >&2
      return 1
      ;;
  esac
}

# Resolve key path: absolute as-is; otherwise look in deploy/, then repo root.
resolve_key_path() {
  local key="$1"
  if [[ "${key}" = /* ]]; then
    echo "${key}"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/${key}" ]]; then
    echo "${SCRIPT_DIR}/${key}"
    return 0
  fi
  if [[ -f "${ROOT_DIR}/${key}" ]]; then
    echo "${ROOT_DIR}/${key}"
    return 0
  fi
  echo "${SCRIPT_DIR}/${key}"
}

pm2_name_for_region() {
  echo "scuta-$1" | tr '[:upper:]' '[:lower:]'
}

deploy_region() {
  local region="$1"
  local host
  host="$(host_for_region "${region}")"
  local key_file
  key_file="$(resolve_key_path "$(key_for_region "${region}")")"
  local app_name
  app_name="$(pm2_name_for_region "${region}")"
  local remote="${DEPLOY_USER}@${host}"

  if [[ ! -f "${key_file}" ]]; then
    echo "ERROR: SSH key not found: ${key_file}" >&2
    echo "Place the .pem in deploy/ (or set an absolute NA_KEY / EU_KEY / ASIA_KEY)." >&2
    exit 1
  fi

  # AWS requires key permissions to be restricted
  chmod 400 "${key_file}" 2>/dev/null || true

  echo "==> Deploying SCUTA.IO [${region}] → ${remote}:${DEPLOY_PATH}"
  echo "    Branch: ${DEPLOY_BRANCH}"
  echo "    Key:    ${key_file}"
  echo "    PM2:    ${app_name}  (node server/index.js --region ${region})"

  ssh -i "${key_file}" \
    -o StrictHostKeyChecking=accept-new \
    -o IdentitiesOnly=yes \
    "${remote}" bash -s -- \
    "${DEPLOY_PATH}" \
    "${DEPLOY_BRANCH}" \
    "${region}" \
    "${app_name}" <<'REMOTE'
set -euo pipefail
DEPLOY_PATH="$1"
DEPLOY_BRANCH="$2"
REGION="$3"
APP_NAME="$4"

if [[ ! -d "${DEPLOY_PATH}/.git" ]]; then
  echo "ERROR: ${DEPLOY_PATH} is not a git checkout. Clone the repo there first." >&2
  exit 1
fi

cd "${DEPLOY_PATH}"
git fetch --prune origin
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

if command -v npm >/dev/null 2>&1; then
  # Optional — regional server is zero-deps today; keep for future packages.
  if [[ -f package-lock.json ]] || [[ -f package.json ]]; then
    npm install --omit=dev || true
  fi
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install with: npm i -g pm2" >&2
  exit 1
fi

# Restart or start with the correct --region flag
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start server/index.js \
    --name "${APP_NAME}" \
    --cwd "${DEPLOY_PATH}" \
    -- --region "${REGION}"
fi

pm2 save
pm2 status "${APP_NAME}"

# Expose app via :80 (SG allows 80; regional ports are often firewalled)
APP_PORT="$(node -e "import('./js/regions.js').then(m=>console.log(m.getRegionById(process.argv[1]).port))" "${REGION}" 2>/dev/null || true)"
if [[ -z "${APP_PORT}" ]]; then
  case "${REGION}" in
    NA) APP_PORT=3001 ;;
    EU) APP_PORT=3002 ;;
    ASIA) APP_PORT=3003 ;;
  esac
fi
if command -v iptables >/dev/null 2>&1; then
  if ! sudo iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports "${APP_PORT}" 2>/dev/null; then
    sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports "${APP_PORT}" || true
  fi
fi

echo "==> Done [${REGION}]"
REMOTE

  echo "==> Deploy finished for ${region} (${host})"
}

# Allow sourcing without running; when invoked as a script with a region arg:
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <NA|EU|ASIA>" >&2
    exit 1
  fi
  deploy_region "$1"
fi
