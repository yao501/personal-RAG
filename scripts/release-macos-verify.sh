#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-release/mac-arm64/个人知识库 RAG.app}"
ABS_APP_PATH="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  echo "Tip: run: npm run release:mac" >&2
  exit 2
fi

echo "== App =="
echo "$ABS_APP_PATH"
echo

echo "== codesign details =="
codesign -dvvv "$ABS_APP_PATH" 2>&1 | /usr/bin/grep -E "Identifier=|TeamIdentifier=|Authority=|Runtime Version" || true
echo

echo "== codesign verify (deep/strict) =="
codesign --verify --deep --strict --verbose=2 "$ABS_APP_PATH"
echo "OK: codesign verify"
echo

echo "== spctl assess (Gatekeeper) =="
spctl --assess --verbose=4 --type execute "$ABS_APP_PATH" || true
echo

echo "== stapler validate (requires notarization+staple) =="
xcrun stapler validate -v "$ABS_APP_PATH" || true
echo

echo "Done."
