#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools"
PLATFORM=""

case "$(uname -s)" in
  Darwin) PLATFORM="darwin";;
  Linux) PLATFORM="linux";;
  *) PLATFORM="win32";;
 esac

APKTOOL_VERSION="${APKTOOL_VERSION:-2.11.1}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-34.0.0}"
APKTOOL_JAR_URL="${APKTOOL_JAR_URL:-https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar}"

if [[ -n "${ANDROID_BUILD_TOOLS_URL:-}" ]]; then
  BUILD_TOOLS_URL="$ANDROID_BUILD_TOOLS_URL"
else
  case "$PLATFORM" in
    darwin) BUILD_TOOLS_URL="https://dl.google.com/android/repository/build-tools_r34-mac.zip" ;;
    linux) BUILD_TOOLS_URL="https://dl.google.com/android/repository/build-tools_r34-linux.zip" ;;
    win32) BUILD_TOOLS_URL="https://dl.google.com/android/repository/build-tools_r34-windows.zip" ;;
    *) BUILD_TOOLS_URL="https://dl.google.com/android/repository/build-tools_r34-linux.zip" ;;
  esac
fi

TARGET_DIR="$TOOLS_DIR/$PLATFORM"
APKTOOL_DIR="$TARGET_DIR/apktool"
BUILD_DIR="$TARGET_DIR/build-tools"

mkdir -p "$APKTOOL_DIR" "$BUILD_DIR"

echo "[bootstrap-tools] platform=$PLATFORM"

if [[ ! -f "$APKTOOL_DIR/apktool.jar" ]]; then
  if command -v curl >/dev/null 2>&1; then
    echo "[bootstrap-tools] Downloading apktool..."
    curl -fsSL --retry 3 --retry-delay 2 "$APKTOOL_JAR_URL" -o "$APKTOOL_DIR/apktool.jar"
  else
    echo "[bootstrap-tools] curl not found, skip apktool download."
  fi
else
  echo "[bootstrap-tools] apktool already exists, skip."
fi

if [[ ! -f "$BUILD_DIR/zipalign" || ! -f "$BUILD_DIR/apksigner" ]]; then
  if command -v curl >/dev/null 2>&1; then
    echo "[bootstrap-tools] Downloading Android build-tools..."
    curl -fsSL --retry 3 --retry-delay 2 "$BUILD_TOOLS_URL" -o "$BUILD_DIR/build-tools.zip" || true
  else
    echo "[bootstrap-tools] curl not found, skip build-tools download."
  fi

  if [[ -f "$BUILD_DIR/build-tools.zip" ]]; then
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$BUILD_DIR/build-tools.zip" -d "$BUILD_DIR"
    else
      echo "[bootstrap-tools] unzip not found, skip build-tools extract."
    fi
    rm -f "$BUILD_DIR/build-tools.zip"
    # find zipalign/apksigner and move to build-tools root
    ZIPALIGN_PATH=$(find "$BUILD_DIR" -type f -name zipalign -o -name zipalign.exe | head -n 1 || true)
    APKSIGNER_PATH=$(find "$BUILD_DIR" -type f -name apksigner -o -name apksigner.bat | head -n 1 || true)
    if [[ -n "$ZIPALIGN_PATH" ]]; then
      mv "$ZIPALIGN_PATH" "$BUILD_DIR/zipalign"
    fi
    if [[ -n "$APKSIGNER_PATH" ]]; then
      mv "$APKSIGNER_PATH" "$BUILD_DIR/apksigner"
    fi
  fi
else
  echo "[bootstrap-tools] build-tools already exist, skip."
fi

echo "[bootstrap-tools] Done."
