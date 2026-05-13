#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <NOTARYTOOL_KEYCHAIN_PROFILE>" >&2
  exit 2
fi

echo "== Notarization precheck =="
echo "- keychain profile: $PROFILE"
echo

echo "== notarytool available =="
xcrun notarytool --version
echo

echo "== keychain profile check =="
set +e
xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1
rc=$?
set -e
if [[ $rc -ne 0 ]]; then
  echo "FAILED: profile not usable. Ensure you created it via:"
  echo "  xcrun notarytool store-credentials \"$PROFILE\" --key-id <ASC_KEY_ID> --issuer <ASC_ISSUER_ID> --key /path/to/AuthKey_<ASC_KEY_ID>.p8"
  exit 3
fi
echo "OK: profile usable"
echo

echo "Done."
