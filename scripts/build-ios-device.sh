#!/usr/bin/env bash
# Builds a signed Release .app for a physical iPhone with the JS bundle embedded, so it runs without Metro.
# Needs macOS, Xcode signed in to an Apple ID (a free one works), and APPLE_TEAM_ID set to that account's team.
# Optional: IOS_BUNDLE_ID overrides the bundle identifier for this build only (a free team needs a unique one).
# Prints the path of the built .app on its last line. See docs/building.md.
set -euo pipefail
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple development team (see docs/building.md)}"
if [ -f build.env ]; then set -a; . ./build.env; set +a; fi
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export EXPO_PUBLIC_CONVEX_URL="${EXPO_PUBLIC_CONVEX_URL:-https://dependable-goshawk-583.convex.cloud}"
corepack pnpm install --frozen-lockfile
corepack pnpm exec expo prebuild --platform ios --clean
workspace=$(ls -d ios/*.xcworkspace | head -n 1)
signing=(DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic)
if [ -n "${IOS_BUNDLE_ID:-}" ]; then signing+=(PRODUCT_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID"); fi
xcodebuild \
  -workspace "$workspace" \
  -scheme "$(basename "$workspace" .xcworkspace)" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  "${signing[@]}" \
  build
ls -d ios/build/Build/Products/Release-iphoneos/*.app | head -n 1
