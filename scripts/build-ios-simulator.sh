#!/usr/bin/env bash
# Builds a Release .app for the iOS Simulator with the JS bundle embedded, so it runs without Metro.
# Output: ios/build/Build/Products/Release-iphonesimulator/consumerhack.app
set -euo pipefail
# Optional build-time settings (EXPO_PUBLIC_* only, never secrets), for builds run on Revyl. See docs/building.md.
if [ -f build.env ]; then set -a; . ./build.env; set +a; fi
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
pnpm install --frozen-lockfile
pnpm exec expo prebuild --platform ios --clean
xcodebuild \
  -workspace ios/consumerhack.xcworkspace \
  -scheme consumerhack \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- \
  build
