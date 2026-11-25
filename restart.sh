#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
pkill -f "work/ide/node_modules" 2>/dev/null || true
pkill -f "vibe-ide" 2>/dev/null || true
sleep 1
pkill -9 -f "work/ide/node_modules" 2>/dev/null || true
if [[ "$(uname)" == "Darwin" && -d "$PWD/node_modules/electron/dist/Electron.app" ]]; then
  open -n "$PWD/node_modules/electron/dist/Electron.app" --args "$PWD"
  echo "vibe-ide restarted via Electron.app"
else
  nohup npm start > /tmp/vibe-ide.log 2>&1 </dev/null &
  echo "vibe-ide restarted (PID $!)"
fi
