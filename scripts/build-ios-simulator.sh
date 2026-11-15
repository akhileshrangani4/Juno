#!/usr/bin/env bash
# Builds a Release .app for the iOS Simulator with the JS bundle embedded, so it runs without Metro.
# Output: ios/build/Build/Products/Release-iphonesimulator/Juno.app (prebuild names the project after expo.name)
set -euo pipefail
# Optional build-time settings (EXPO_PUBLIC_* only, never secrets), for builds run on Revyl. See docs/building.md.
if [ -f build.env ]; then set -a; . ./build.env; set +a; fi
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export EXPO_PUBLIC_CONVEX_URL="${EXPO_PUBLIC_CONVEX_URL:-https://dependable-goshawk-583.convex.cloud}"
corepack enable
pnpm install --frozen-lockfile
pnpm exec expo prebuild --platform ios --clean
xcodebuild \
  -workspace ios/Juno.xcworkspace \
  -scheme Juno \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- \
  build
