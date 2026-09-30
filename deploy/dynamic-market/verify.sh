#!/usr/bin/env bash
# Verify one contract on Arcscan (Blockscout, no API key). Read-only: no
# keystore, no transactions. Re-runnable; an already-verified contract is
# reported and skipped.
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
# with fix_std_json.py, and submit it to Blockscout's standard-input
# endpoint directly.
#
# ARC_EXPLORER_API overrides the explorer (default Arc Mainnet; use
# https://explorer.testnet.arc.io/api for Arc Testnet). ARC_RPC_URL is read
# only to confirm the address has code.
set -euo pipefail

TARGET="${1:?usage: verify.sh <path:Name> <address> [constructor-args-hex]}"
ADDR="${2:?usage: verify.sh <path:Name> <address> [constructor-args-hex]}"
ARGS="${3:-}"; ARGS="${ARGS#0x}"
[[ "$ADDR" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not a 40-hex address: $ADDR" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../contracts"
API="${ARC_EXPLORER_API:-https://explorer.arc.io/api}"
RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
NAME="${TARGET##*:}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Retries ride out flaky links; -f fails on HTTP errors.
api() { curl -fsS --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 15 --max-time 120 "$@"; }
field() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1], "") if isinstance(d, dict) else "")' "$1"; }

echo "== $NAME @ $ADDR"
[[ "$(cast code "$ADDR" --rpc-url "$RPC")" != "0x" ]] || { echo "   no code at $ADDR on $RPC" >&2; exit 1; }

# Already verified? (Blockscout v2 read; a Cloudflare challenge on the
# explorer surfaces here as a non-JSON body — treat as unknown, not failure.)
if resp=$(api "${API}/v2/smart-contracts/${ADDR}" 2>/dev/null) && [[ "$(field is_verified <<<"$resp")" == "True" ]]; then
  echo "   already verified — ${API%/api}/address/${ADDR}?tab=contract"; exit 0
fi

# The compiler version the artifact was built with, from forge's own metadata.
JSON_PATH="${TARGET%%:*}"
ARTIFACT="out/$(basename "$JSON_PATH")/${NAME}.json"
[[ -f "$ARTIFACT" ]] || forge build -q 2>/dev/null || true
COMPILER=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1]))["metadata"]; print("v"+m["compiler"]["version"])' "$ARTIFACT")
SOLC="${COMPILER#v}"; SOLC="${SOLC%%+*}"

if ! ETHERSCAN_API_KEY=x forge verify-contract "$ADDR" "$TARGET" --chain 5042 \
    --compiler-version "$SOLC" --show-standard-json-input > "$TMP/in.json" 2>"$TMP/forge.err" \
    || [[ ! -s "$TMP/in.json" ]]; then
  echo "   forge could not build the standard-JSON input (is another forge build running?):" >&2
  grep -v "solc::sources" "$TMP/forge.err" | tail -3 | sed 's/^/     /' >&2; exit 1
fi
python3 "$HERE/fix_std_json.py" "$TMP/in.json" "$TMP/fixed.json" | sed 's/^/   /'

# Blockscout v2 standard-input verification. `contract_name` is the
# "path:Name" the artifact was built from; constructor args are hex, no 0x.
resp=$(api -X POST "${API}/v2/smart-contracts/${ADDR}/verification/via/standard-input" \
  -F "compiler_version=${COMPILER}" \
  -F "contract_name=${TARGET}" \
  -F "autodetect_constructor_args=$([[ -n "$ARGS" ]] && echo false || echo true)" \
  ${ARGS:+-F "constructor_args=${ARGS}"} \
  -F "files[0]=@${TMP}/fixed.json;filename=input.json;type=application/json") \
  || { echo "   submit failed — if the explorer answered a Cloudflare challenge, verify manually at ${API%/api}/address/${ADDR}?tab=contract with ${TMP}/fixed.json (kept only until this shell exits: copy it first)" >&2; cp "$TMP/fixed.json" "/tmp/${NAME}.std-input.json"; echo "   standard-JSON input saved to /tmp/${NAME}.std-input.json" >&2; exit 1; }
echo "   submitted: $(field message <<<"$resp")"

for _ in $(seq 1 20); do
  sleep 6
  resp=$(api "${API}/v2/smart-contracts/${ADDR}") || continue
  if [[ "$(field is_verified <<<"$resp")" == "True" ]]; then
    echo "   Pass - Verified — ${API%/api}/address/${ADDR}?tab=contract"; exit 0
  fi
done
echo "   still pending after 2 minutes; check ${API%/api}/address/${ADDR}?tab=contract" >&2
exit 1
