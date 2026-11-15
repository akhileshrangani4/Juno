#!/usr/bin/env bash
# Builds a signed Release .app for a physical iPhone with the JS bundle embedded, so it runs without Metro.
# Needs macOS, Xcode signed in to an Apple ID (a free one works), and APPLE_TEAM_ID set to that account's team.
# Optional: IOS_BUNDLE_ID overrides the bundle identifier for this build only (a free team needs a unique one).
# Prints the path of the built .app on its last line. See docs/building.md.
set -euo pipefail
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "xcodebuild doesn't run: install Xcode, open it once, and select it with sudo xcode-select -s /Applications/Xcode.app (see docs/building.md)" >&2
  exit 1
fi
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple development team (see docs/building.md)}"
if [ -f build.env ]; then set -a; . ./build.env; set +a; fi
if [ "${EXPO_PUBLIC_DEV_FRAME_SOURCE:-}" = 1 ] || grep -qsE '^[[:space:]]*EXPO_PUBLIC_DEV_FRAME_SOURCE[[:space:]]*=[[:space:]]*["'"'"']?1' .env .env.local .env.production .env.production.local; then
  echo "EXPO_PUBLIC_DEV_FRAME_SOURCE=1 is for simulator test builds only; unset it (and remove it from .env files) to build for a phone" >&2
  exit 1
fi
export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export EXPO_PUBLIC_CONVEX_URL="${EXPO_PUBLIC_CONVEX_URL:-https://dependable-goshawk-583.convex.cloud}"
corepack pnpm install --frozen-lockfile
corepack pnpm exec expo prebuild --platform ios --clean
shopt -s nullglob
workspaces=(ios/*.xcworkspace)
if [ "${#workspaces[@]}" -ne 1 ]; then
  echo "Expected one Xcode workspace in ios/ after prebuild, found ${#workspaces[@]}: ${workspaces[*]:-none}" >&2
  exit 1
fi
workspace=${workspaces[0]}
signing=(DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic)
if [ -n "${IOS_BUNDLE_ID:-}" ]; then
  # Renames the app and its widget together in the generated project: the widget's identifier must start with the
  # app's, so a command-line PRODUCT_BUNDLE_IDENTIFIER (which would give both the same identifier) can't be used.
  app_id=$(node -p "require('./app.json').expo.ios.bundleIdentifier")
  sed -i '' "s/${app_id//./\\.}/${IOS_BUNDLE_ID}/g" "${workspace%.xcworkspace}.xcodeproj/project.pbxproj"
fi
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
apps=(ios/build/Build/Products/Release-iphoneos/*.app)
if [ "${#apps[@]}" -ne 1 ]; then
  echo "Expected one built .app in ios/build/Build/Products/Release-iphoneos, found ${#apps[@]}: ${apps[*]:-none}" >&2
  exit 1
fi
echo "${apps[0]}"
