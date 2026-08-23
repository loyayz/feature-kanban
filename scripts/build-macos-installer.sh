#!/bin/bash
set -euo pipefail

SCRIPT_DIRECTORY="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
REPOSITORY_ROOT="$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd -P)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS installer must be built on macOS 14 or newer." >&2
  exit 1
fi
MACOS_VERSION="$(sw_vers -productVersion)"
MACOS_MAJOR="${MACOS_VERSION%%.*}"
if [[ ! "$MACOS_MAJOR" =~ ^[0-9]+$ || "$MACOS_MAJOR" -lt 14 ]]; then
  echo "The macOS installer requires macOS 14 or newer; this host is $MACOS_VERSION." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) HOST_ARCHITECTURE="arm64"; SWIFT_ARCHITECTURE="arm64" ;;
  x86_64) HOST_ARCHITECTURE="x64"; SWIFT_ARCHITECTURE="x86_64" ;;
  *) echo "Unsupported macOS host architecture: $(uname -m)" >&2; exit 1 ;;
esac
ROSETTA_TRANSLATED="$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)"
if [[ "$ROSETTA_TRANSLATED" == "1" ]]; then
  echo "Refusing to build an x64 artifact under Rosetta; use physical Intel hardware." >&2
  exit 1
fi

TARGET_ARCHITECTURE="${FEATURE_KANBAN_MAC_ARCH:-$HOST_ARCHITECTURE}"
if [[ "$TARGET_ARCHITECTURE" != "arm64" && "$TARGET_ARCHITECTURE" != "x64" ]]; then
  echo "FEATURE_KANBAN_MAC_ARCH must be arm64 or x64." >&2
  exit 1
fi
if [[ "$TARGET_ARCHITECTURE" != "$HOST_ARCHITECTURE" ]]; then
  echo "The requested $TARGET_ARCHITECTURE artifact must be built on matching hardware; this host is $HOST_ARCHITECTURE." >&2
  exit 1
fi

SIGNING_IDENTITY="${FEATURE_KANBAN_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${FEATURE_KANBAN_NOTARY_PROFILE:-}"
if [[ -n "$SIGNING_IDENTITY" || -n "$NOTARY_PROFILE" ]]; then
  if [[ -z "$SIGNING_IDENTITY" || -z "$NOTARY_PROFILE" ]]; then
    echo "Signed mode requires both FEATURE_KANBAN_SIGNING_IDENTITY and FEATURE_KANBAN_NOTARY_PROFILE." >&2
    exit 1
  fi
  BUILD_MODE="signed"
else
  BUILD_MODE="unsigned"
fi

NODE_SOURCE="${npm_node_execpath:-}"
if [[ -z "$NODE_SOURCE" ]]; then NODE_SOURCE="$(command -v node)"; fi
NPM_COMMAND="$(command -v npm)"
if [[ ! -x "$NODE_SOURCE" ]]; then
  echo "The active nvm/current Node executable is unavailable: $NODE_SOURCE" >&2
  exit 1
fi

DIST_ROOT="$REPOSITORY_ROOT/dist"
if [[ -L "$DIST_ROOT" || ( -e "$DIST_ROOT" && ! -d "$DIST_ROOT" ) ]]; then
  echo "Refusing an unsafe repository dist directory: $DIST_ROOT" >&2
  exit 1
fi
mkdir -p -- "$DIST_ROOT"
DIST_CANONICAL="$(CDPATH= cd -- "$DIST_ROOT" && pwd -P)"
if [[ "$DIST_CANONICAL" != "$DIST_ROOT" ]]; then
  echo "Refusing a repository dist directory outside the worktree: $DIST_CANONICAL" >&2
  exit 1
fi

OUTPUT_BASE="$DIST_ROOT/macos"
ARCHITECTURE_ROOT="$OUTPUT_BASE/$TARGET_ARCHITECTURE"
BUILD_ROOT="$ARCHITECTURE_ROOT/build"
APP_ROOT="$ARCHITECTURE_ROOT/Feature Kanban.app"

mkdir -p -- "$OUTPUT_BASE"
if [[ -L "$OUTPUT_BASE" ]]; then
  echo "Refusing a symbolic-link macOS output base: $OUTPUT_BASE" >&2
  exit 1
fi
OUTPUT_CANONICAL="$(CDPATH= cd -- "$OUTPUT_BASE" && pwd -P)"
if [[ "$OUTPUT_CANONICAL" != "$REPOSITORY_ROOT/dist/macos" ]]; then
  echo "Refusing a macOS output base outside the repository dist directory: $OUTPUT_CANONICAL" >&2
  exit 1
fi
if [[ -e "$ARCHITECTURE_ROOT" && ( ! -d "$ARCHITECTURE_ROOT" || -L "$ARCHITECTURE_ROOT" ) ]]; then
  echo "Refusing an unsafe macOS architecture output directory: $ARCHITECTURE_ROOT" >&2
  exit 1
fi
mkdir -p -- "$ARCHITECTURE_ROOT"
ARCHITECTURE_CANONICAL="$(CDPATH= cd -- "$ARCHITECTURE_ROOT" && pwd -P)"
if [[ "$ARCHITECTURE_CANONICAL" != "$OUTPUT_CANONICAL/$TARGET_ARCHITECTURE" ]]; then
  echo "Refusing a macOS architecture directory outside the output base: $ARCHITECTURE_CANONICAL" >&2
  exit 1
fi

reset_build_directory() {
  local target="$1"
  case "$target" in
    "$ARCHITECTURE_ROOT"/*) ;;
    *) echo "Refusing to reset an unsafe build path: $target" >&2; exit 1 ;;
  esac
  if [[ -L "$target" ]]; then
    echo "Refusing to reset a symbolic-link build path: $target" >&2
    exit 1
  fi
  rm -rf -- "$target"
  mkdir -p -- "$target"
}

reset_build_directory "$BUILD_ROOT"

cd "$REPOSITORY_ROOT"
"$NPM_COMMAND" run build
"$NPM_COMMAND" exec -- tsc -p tsconfig.test.json

PACKAGE_VERSION="$("$NPM_COMMAND" pkg get version)"
PACKAGE_VERSION="${PACKAGE_VERSION#\"}"
PACKAGE_VERSION="${PACKAGE_VERSION%\"}"
NODE_VERSION="$("$NODE_SOURCE" --version)"
BOOTSTRAP_COPY="$BUILD_ROOT/FeatureKanbanBootstrap"

xcrun swiftc \
  -parse-as-library \
  -target "$SWIFT_ARCHITECTURE-apple-macos14.0" \
  -framework AppKit \
  -o "$BOOTSTRAP_COPY" \
  "$REPOSITORY_ROOT/installer/macos/FeatureKanbanBootstrap.swift"
chmod 755 "$BOOTSTRAP_COPY"
xattr -c "$BOOTSTRAP_COPY"

"$NODE_SOURCE" "$REPOSITORY_ROOT/dist/test/scripts/stage-macos-package.js" \
  --repo-root "$REPOSITORY_ROOT" \
  --output-base "$OUTPUT_BASE" \
  --arch "$TARGET_ARCHITECTURE" \
  --product-version "$PACKAGE_VERSION" \
  --node-version "$NODE_VERSION" \
  --bootstrap "$BOOTSTRAP_COPY"
xattr -cr "$APP_ROOT"
plutil -lint "$APP_ROOT/Contents/Info.plist"

if [[ "$BUILD_MODE" == "signed" ]]; then
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    "$APP_ROOT"
  codesign --verify --deep --strict --verbose=2 "$APP_ROOT"
fi

"$NODE_SOURCE" "$REPOSITORY_ROOT/dist/test/scripts/verify-macos-package.js" "$APP_ROOT"
ARTIFACT_NAME="$(
  "$NODE_SOURCE" "$REPOSITORY_ROOT/dist/test/scripts/verify-macos-package.js" \
    "$APP_ROOT" \
    --artifact-name "$BUILD_MODE"
)"
FINAL_DMG_PATH="$OUTPUT_BASE/$ARTIFACT_NAME"
DMG_PATH="$BUILD_ROOT/candidate.dmg"
case "$FINAL_DMG_PATH" in
  "$OUTPUT_BASE"/FeatureKanban-*-macos-*.dmg) ;;
  *) echo "Refusing an unsafe final DMG path: $FINAL_DMG_PATH" >&2; exit 1 ;;
esac

DMG_SOURCE="$BUILD_ROOT/dmg-source"
MOUNT_POINT="$BUILD_ROOT/mount"
reset_build_directory "$DMG_SOURCE"
reset_build_directory "$MOUNT_POINT"
ditto "$APP_ROOT" "$DMG_SOURCE/Feature Kanban.app"
ln -s /Applications "$DMG_SOURCE/Applications"

hdiutil create \
  -fs HFS+ \
  -format UDZO \
  -volname "Feature Kanban" \
  -srcfolder "$DMG_SOURCE" \
  "$DMG_PATH"
hdiutil verify "$DMG_PATH"

MOUNTED=0
cleanup_mount() {
  if [[ "$MOUNTED" -eq 1 ]]; then hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true; fi
}
trap cleanup_mount EXIT INT TERM
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG_PATH" >/dev/null
MOUNTED=1
test -d "$MOUNT_POINT/Feature Kanban.app"
test "$(readlink "$MOUNT_POINT/Applications")" = "/Applications"
"$NODE_SOURCE" "$REPOSITORY_ROOT/dist/test/scripts/verify-macos-package.js" \
  "$MOUNT_POINT/Feature Kanban.app"
hdiutil detach "$MOUNT_POINT" >/dev/null
MOUNTED=0

if [[ "$BUILD_MODE" == "signed" ]]; then
  codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG_PATH"
  hdiutil verify "$DMG_PATH"
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
  hdiutil verify "$DMG_PATH"
  reset_build_directory "$MOUNT_POINT"
  hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG_PATH" >/dev/null
  MOUNTED=1
  spctl --assess --type execute --verbose=2 "$MOUNT_POINT/Feature Kanban.app"
  hdiutil detach "$MOUNT_POINT" >/dev/null
  MOUNTED=0
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
else
  echo "Created unsigned development image; do not distribute it as a release artifact." >&2
fi

if [[ -L "$FINAL_DMG_PATH" ]]; then
  echo "Refusing to replace a symbolic link at the final DMG path: $FINAL_DMG_PATH" >&2
  exit 1
fi
if [[ -e "$FINAL_DMG_PATH" ]]; then
  if [[ ! -f "$FINAL_DMG_PATH" ]]; then
    echo "Refusing to replace a non-file at the final DMG path: $FINAL_DMG_PATH" >&2
    exit 1
  fi
fi
mv -f "$DMG_PATH" "$FINAL_DMG_PATH"
echo "macOS installer created at $FINAL_DMG_PATH"
