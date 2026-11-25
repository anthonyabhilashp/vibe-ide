#!/bin/bash
# Adds macOS usage-description keys to the dev Electron's Info.plist so that
# system permission prompts (mic, camera, etc.) work in `npm start` dev mode.
# Without these keys, askForMediaAccess() returns immediately and the app
# never appears in System Settings -> Privacy & Security.

set -e

INFO_PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"

if [ ! -f "$INFO_PLIST" ]; then
  echo "Info.plist not found at $INFO_PLIST (skipping)"
  exit 0
fi

add_key() {
  local key="$1"
  local desc="$2"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$INFO_PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key '$desc'" "$INFO_PLIST"
  else
    /usr/libexec/PlistBuddy -c "Add :$key string '$desc'" "$INFO_PLIST"
  fi
  echo "  $key set"
}

echo "Patching $INFO_PLIST..."
add_key NSMicrophoneUsageDescription "vibe-ide and tools running inside its terminals use the microphone for voice input."
echo "Done."
