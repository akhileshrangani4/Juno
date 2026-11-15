#!/usr/bin/env bash
# Builds a Release APK with the JS bundle embedded (signed with the debug keystore), so it runs without Metro.
# Output: android/app/build/outputs/apk/release/app-release.apk
set -euo pipefail
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
pnpm install --frozen-lockfile
pnpm exec expo prebuild --platform android --clean
cd android
./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,x86_64
