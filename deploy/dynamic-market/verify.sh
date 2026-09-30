#!/usr/bin/env bash
# Verify one contract's source for Arcscan. Read-only: no keystore, no
# transactions. Re-runnable; an already-verified contract is reported and
# skipped.
#
#   deploy/dynamic-market/verify.sh <path:Name> <address> [constructor-args-hex]
#
#   deploy/dynamic-market/verify.sh lib/v4-core/src/PoolManager.sol:PoolManager 0xPOOL \
#     "$(cast abi-encode 'constructor(address)' 0xOPERATOR)"
#
# Why not plain `forge verify-contract`: it resolves imports with the global
# `solmate/=lib/solmate/src/` remapping even under v4-core's context
# remapping, so PoolManager's `solmate/src/auth/Owned.sol` (and
# PositionManager's ERC721) drop out of the standard-JSON input and the
# explorer's compile fails. We take forge's standard-JSON input, complete it
# with fix_std_json.py, and submit it to Sourcify (which lists Arc Mainnet
# 5042); Arcscan imports a Sourcify match when the contract page is next
# opened. Arcscan's own API sits behind a Cloudflare challenge that rejects
# non-browser clients, so it is never called here. A CREATE2 deployment
# (the hook) has no creation tx for Arcscan to index — its Sourcify match
# must be submitted through the explorer's web form with the input this
# script saves to /tmp/<Name>.std-input.json.
#
# SOLC overrides the compiler version (default: the one in the artifact —
# note the `^0.8.26` settlement contracts compile with the newest installed
# solc, 0.8.35 at the 2026-09-30 deploy). CREATION_TX (optional) lets
# Sourcify match the creation bytecode too. SOURCIFY overrides the server;
# ARC_RPC_URL is read only to confirm the address has code.
set -euo pipefail

TARGET="${1:?usage: verify.sh <path:Name> <address> [constructor-args-hex]}"
ADDR="${2:?usage: verify.sh <path:Name> <address> [constructor-args-hex]}"
[[ "$ADDR" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not a 40-hex address: $ADDR" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../contracts"
SOURCIFY="${SOURCIFY:-https://sourcify.dev/server}"
RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
CHAIN_ID=5042
NAME="${TARGET##*:}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Retries ride out flaky links; -f fails on HTTP errors.
api() { curl -fsS --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 15 --max-time 180 "$@"; }
field() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1], "") if isinstance(d, dict) else "")' "$1"; }

echo "== $NAME @ $ADDR"
[[ "$(cast code "$ADDR" --rpc-url "$RPC")" != "0x" ]] || { echo "   no code at $ADDR on $RPC" >&2; exit 1; }

if resp=$(api "${SOURCIFY}/v2/contract/${CHAIN_ID}/${ADDR}" 2>/dev/null) && [[ -n "$(field match <<<"$resp")" ]]; then
  echo "   already verified on Sourcify ($(field match <<<"$resp")) — open https://explorer.arc.io/address/${ADDR}?tab=contract to let Arcscan import it"; exit 0
fi

# The compiler version: the artifact's (forge's own metadata) unless SOLC says otherwise.
JSON_PATH="${TARGET%%:*}"
ARTIFACT="out/$(basename "$JSON_PATH")/${NAME}.json"
[[ -f "$ARTIFACT" ]] || forge build -q 2>/dev/null || true
if [[ -n "${SOLC:-}" ]]; then
  SOLC_ARTIFACT="out/$(basename "$JSON_PATH")/${NAME}.${SOLC}.json"
  [[ -f "$SOLC_ARTIFACT" ]] && ARTIFACT="$SOLC_ARTIFACT"
fi
COMPILER=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1]))["metadata"]; print(m["compiler"]["version"])' "$ARTIFACT")
SOLC="${SOLC:-${COMPILER%%+*}}"
[[ "$COMPILER" == "$SOLC"* ]] || { echo "   artifact $ARTIFACT is $COMPILER, not $SOLC — build it with that solc first" >&2; exit 1; }

if ! ETHERSCAN_API_KEY=x forge verify-contract "$ADDR" "$TARGET" --chain "$CHAIN_ID" \
    --compiler-version "$SOLC" --show-standard-json-input > "$TMP/in.json" 2>"$TMP/forge.err" \
    || [[ ! -s "$TMP/in.json" ]]; then
  echo "   forge could not build the standard-JSON input (is another forge build running?):" >&2
  grep -v "solc::sources" "$TMP/forge.err" | tail -3 | sed 's/^/     /' >&2; exit 1
fi
python3 "$HERE/fix_std_json.py" "$TMP/in.json" "$TMP/fixed.json" | sed 's/^/   /'
cp "$TMP/fixed.json" "/tmp/${NAME}.std-input.json"
echo "   compiler $COMPILER; standard-JSON input saved to /tmp/${NAME}.std-input.json"

# Sourcify v2: the completed input, the compiler, the fully-qualified name.
python3 - "$TMP/fixed.json" "$COMPILER" "$TARGET" "${CREATION_TX:-}" > "$TMP/body.json" <<'EOF'
import json, sys
body = {"stdJsonInput": json.load(open(sys.argv[1])), "compilerVersion": sys.argv[2], "contractIdentifier": sys.argv[3]}
if sys.argv[4]: body["creationTransactionHash"] = sys.argv[4]
json.dump(body, sys.stdout)
EOF
resp=$(api -X POST "${SOURCIFY}/v2/verify/${CHAIN_ID}/${ADDR}" -H "Content-Type: application/json" --data-binary "@$TMP/body.json") \
  || { echo "   Sourcify submit failed — verify by hand at https://explorer.arc.io/address/${ADDR}?tab=contract with /tmp/${NAME}.std-input.json" >&2; exit 1; }
JOB=$(field verificationId <<<"$resp")
[[ -n "$JOB" ]] || { echo "   unexpected Sourcify response: $resp" >&2; exit 1; }
echo "   submitted to Sourcify (job $JOB)"

for _ in $(seq 1 30); do
  sleep 6
  resp=$(api "${SOURCIFY}/v2/verify/${JOB}") || continue
  [[ "$(field isJobCompleted <<<"$resp")" == "True" ]] || continue
  match=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("contract") or {}).get("match") or "")' <<<"$resp")
  if [[ -n "$match" ]]; then
    echo "   Pass - $match — open https://explorer.arc.io/address/${ADDR}?tab=contract to let Arcscan import it"; exit 0
  fi
  echo "   Sourcify: $(python3 -c 'import json,sys; e=json.load(sys.stdin).get("error") or {}; print(e.get("customCode",""), e.get("message",""))' <<<"$resp")" >&2
  echo "   (a bytecode mismatch usually means a different solc — try SOLC=0.8.35)" >&2; exit 1
done
echo "   still pending after 3 minutes; check ${SOURCIFY}/v2/verify/${JOB}" >&2
exit 1
