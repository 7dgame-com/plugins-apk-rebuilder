#!/usr/bin/env bash
set -euo pipefail

IMAGE="${APK_REBUILDER_IMAGE:-}"

detect_platform() {
  local machine
  machine="$(uname -m 2>/dev/null || echo unknown)"
  case "${machine}" in
    x86_64|amd64)
      echo "linux/amd64"
      ;;
    arm64|aarch64)
      echo "linux/arm64"
      ;;
    *)
      echo ""
      ;;
  esac
}

if [[ -z "${APK_REBUILDER_PLATFORM:-}" ]]; then
  export APK_REBUILDER_PLATFORM="$(detect_platform)"
fi

if [[ -n "${IMAGE}" ]]; then
  echo "[quick-start] Trying prebuilt image: ${IMAGE}"
  if docker pull "${IMAGE}" >/dev/null 2>&1; then
    echo "[quick-start] Prebuilt image is available, starting from image."
    docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
    echo "[quick-start] Done. Open: http://localhost:3006"
    exit 0
  fi
  echo "[quick-start] Prebuilt image not accessible, falling back to local build."
fi

echo "[quick-start] Starting local build (platform=${APK_REBUILDER_PLATFORM:-auto})"
docker compose up -d --build
echo "[quick-start] Done. Open: http://localhost:3006"
