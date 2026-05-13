#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-release/mac-arm64/个人知识库 RAG.app}"
ABS_APP_PATH="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"

echo "== Signing precheck =="
echo "- app: $ABS_APP_PATH"
echo

echo "== Xcode CLT (xcrun) =="
command -v xcrun >/dev/null 2>&1 && echo "OK: xcrun present" || (echo "MISSING: xcrun (install Xcode Command Line Tools)" && exit 2)
echo

echo "== Available code signing identities =="
security find-identity -v -p codesigning || true
echo

echo "== Current app signature (may be ad-hoc) =="
if [[ -d "$ABS_APP_PATH" ]]; then
  codesign -dvvv "$ABS_APP_PATH" 2>&1 | /usr/bin/grep -E "Identifier=|TeamIdentifier=|Authority=|Runtime Version" || true
  echo
  echo "== codesign verify (deep/strict) =="
  codesign --verify --deep --strict --verbose=2 "$ABS_APP_PATH" || true
else
  echo "App not found. Tip: npm run release:mac"
fi
echo

echo "Done."
