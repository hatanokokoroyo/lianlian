#!/usr/bin/env bash
# Capture the real prototype screens used by deck.html.
# Requires: repo root served at $BASE (python3 -m http.server 8765 --directory .)
set -eu

CHROME="${CHROME:-/mnt/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="${BASE:-http://127.0.0.1:8765}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/screens"
WIN_TMP="${WIN_TMP:-C:\\Users\\lizek\\AppData\\Local\\Temp}"
WIN_TMP_WSL="${WIN_TMP_WSL:-/mnt/c/Users/lizek/AppData/Local/Temp}"

mkdir -p "$OUT"

shoot() {
  name="$1"; url="$2"; w="$3"; h="$4"; scale="$5"
  win="$WIN_TMP\\matt-$name.png"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor="$scale" --window-size="$w,$h" \
    --virtual-time-budget=2500 --screenshot="$win" "$BASE$url" >/dev/null 2>&1
  cp "$WIN_TMP_WSL/matt-$name.png" "$OUT/$name.png"
  echo "  $name.png"
}

device() { shoot "$1" "$2" 600 900 2; }
wide() { shoot "$1" "$2" 1280 800 1; }

echo "three directions"
device today-iron /design/screens/today-iron.html
device profile-iron /design/screens/profile-iron.html
device today-ledger /design/screens/today-ledger.html
device profile-ledger /design/screens/profile-ledger.html
device today-pulse /design/screens/today-pulse.html
device profile-pulse /design/screens/profile-pulse.html

echo "nine pulse screens"
device calendar-pulse /design/screens/calendar-pulse.html
device day-detail-pulse /design/screens/day-detail-pulse.html
device conversation-list-pulse /design/screens/conversation-list-pulse.html
device conversation-pulse /design/screens/conversation-pulse.html
device measurements-pulse /design/screens/measurements-pulse.html
device onboarding-pulse /design/screens/onboarding-pulse.html
device settings-pulse /design/screens/settings-pulse.html

echo "profile IA variants"
device ia-a '/design/screens/profile-ia-prototype.html#variant=A'
device ia-b '/design/screens/profile-ia-prototype.html#variant=B'
device ia-c '/design/screens/profile-ia-prototype.html#variant=C'
device ia-d '/design/screens/profile-ia-prototype.html#variant=D'
device ia-section '/design/screens/profile-ia-prototype.html#variant=D&section=gluteal-group'

echo "OpenDesign preview"
# 静态目录页兜底；P12 用的 od-workbench.png 是 localhost:7456 工作台实拍，需单独截。
wide od-preview /design/screens/index.html

echo "done -> $OUT"
