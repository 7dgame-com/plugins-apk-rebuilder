#!/bin/bash
set -e

echo "Installing Java OpenJDK 17 via Homebrew (Temurin)..."
brew install --cask temurin@17 || echo "Temurin 17 already installed or failed."

# Set up local tools directory 
cd "$(dirname "$0")"
mkdir -p tools/darwin/build-tools
mkdir -p tools/darwin/apktool

echo "Downloading Android Build Tools r34 for macOS..."
cd tools/darwin/build-tools
curl -fsSL -o build-tools.zip "https://dl.google.com/android/repository/build-tools_r34-macosx.zip"
unzip -q -o build-tools.zip
mv android-14/* . 2>/dev/null || mv android-*/* . 2>/dev/null || true
rm -rf android-* build-tools.zip

echo "Downloading Apktool 2.11.1..."
cd ../apktool
curl -fsSL -o apktool.jar "https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar"

echo "Tools downloaded to tools/darwin successfully!"
ls -la ../build-tools/apksigner ../build-tools/zipalign apktool.jar
java -version
