#!/usr/bin/env bash
# Verify the Base Mainnet Dynamic Market stack on BaseScan (Etherscan API V2).
# Read-only: no keystore, no transactions. Re-runnable; an already-verified
# contract is reported and skipped.
#
#   BASESCAN_API_KEY=... deploy/dynamic-market/verify.sh
#
# Why not `forge verify-contract`: it resolves imports with the global
# `solmate/=lib/solmate/src/` remapping even under v4-core's context remapping,
# so PoolManager's `solmate/src/auth/Owned.sol` is dropped from the submitted
# sources and BaseScan's compile fails. We take forge's standard-JSON input,
# complete it with fix_std_json.py, check it compiles to the exact on-chain
# bytecode, and submit it directly.
#
# Addresses and constructor args are the 2026-09-23 deploys recorded in README.md.
set -euo pipefail

: "${BASESCAN_API_KEY:?set BASESCAN_API_KEY}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../contracts"

API="https://api.etherscan.io/v2/api?chainid=8453"
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
SOLC_VERSION=v0.8.26+commit.8a97fa7a
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

OPERATOR=0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3
KEEPER=0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3
POOL_MANAGER=0xee196B3F83Fe6f57E074C399DBdeFe07e1407636
REGISTRY=0xEA8c2f329E7eBD9a67FA7E502CEcc938bE3ec7a6
HOOK=0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0
# Periphery (DeployMarketPeriphery.s.sol). Only PositionManager needs this
# script — it imports solmate's ERC721 through the same broken remapping; the
# other five verified in the deploy's own --verify.
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
POSITION_DESCRIPTOR=0x6A8Ce701aB14a2909F22a18063426fEE016A36da
POSITION_MANAGER=0x17a69A23F3c0F7F0dCA6391f967C020BaC0906da

field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }
# Retries ride out the connect timeouts seen on a flaky link; -f fails on HTTP errors.
api() { curl -fsS --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 15 --max-time 120 "$@"; }

verify() {
  local addr=$1 target=$2 args=${3#0x}
  echo "== ${target##*:} @ $addr"

  local resp status
  sleep 1
  resp=$(api "$API&module=contract&action=getsourcecode&address=$addr&apikey=$BASESCAN_API_KEY") \
    || { echo "   BaseScan API unreachable — check your connection and rerun" >&2; return 1; }
  status=$(python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("verified" if isinstance(r,list) and r[0].get("SourceCode") else "")' <<<"$resp")
  if [[ "$status" == "verified" ]]; then echo "   already verified"; return; fi

  if ! ETHERSCAN_API_KEY=x BASESCAN_API_KEY=x forge verify-contract "$addr" "$target" --chain 8453 \
      --compiler-version 0.8.26 --show-standard-json-input > "$TMP/in.json" 2>"$TMP/forge.err" \
      || [[ ! -s "$TMP/in.json" ]]; then
    echo "   forge could not build the standard-JSON input (is another forge build running?):" >&2
    grep -v "solc::sources" "$TMP/forge.err" | tail -3 | sed 's/^/     /' >&2; return 1
  fi
  python3 "$HERE/fix_std_json.py" "$TMP/in.json" "$TMP/fixed.json" | sed 's/^/   /'

  local guid attempt
  for attempt in 1 2 3 4; do
    sleep 1  # BaseScan free tier: 3 calls/sec
    resp=$(api -X POST "$API" \
      --data-urlencode "apikey=$BASESCAN_API_KEY" \
      --data-urlencode "module=contract" \
      --data-urlencode "action=verifysourcecode" \
      --data-urlencode "codeformat=solidity-standard-json-input" \
      --data-urlencode "contractaddress=$addr" \
      --data-urlencode "contractname=$target" \
      --data-urlencode "compilerversion=$SOLC_VERSION" \
      --data-urlencode "constructorArguements=$args" \
      --data-urlencode "sourceCode@$TMP/fixed.json") \
      || { echo "   submit request failed — check your connection and rerun" >&2; return 1; }
    [[ "$(field result <<<"$resp")" == *"rate limit"* ]] || break
    echo "   rate-limited; retrying" >&2; sleep $((attempt * 3))
  done
  if [[ "$(field status <<<"$resp")" != "1" ]]; then
    echo "   submit failed: $(field result <<<"$resp")" >&2; return 1
  fi
  guid=$(field result <<<"$resp")

  for _ in $(seq 1 20); do
    sleep 6
    resp=$(api "$API&module=contract&action=checkverifystatus&guid=$guid&apikey=$BASESCAN_API_KEY") || continue
    local result; result=$(field result <<<"$resp")
    case "$result" in
      "Pending in queue"|"In progress") continue ;;
      "Pass - Verified"|"Already Verified") echo "   $result — https://basescan.org/address/$addr#code"; return ;;
      *) echo "   failed: $result" >&2; return 1 ;;
    esac
  done
  echo "   still pending after 2 minutes; check https://basescan.org/address/$addr#code" >&2
  return 1
}

rc=0
verify "$POOL_MANAGER" lib/v4-core/src/PoolManager.sol:PoolManager \
  "$(cast abi-encode 'constructor(address)' "$OPERATOR")" || rc=1
verify "$REGISTRY" src/hooks/dynamic-market/MarketStateRegistry.sol:MarketStateRegistry \
  "$(cast abi-encode 'constructor(address,address)' "$OPERATOR" "$KEEPER")" || rc=1
verify "$HOOK" src/hooks/dynamic-market/DynamicMarketHook.sol:DynamicMarketHook \
  "$(cast abi-encode 'constructor(address,address)' "$POOL_MANAGER" "$REGISTRY")" || rc=1
verify "$POSITION_MANAGER" lib/v4-periphery/src/PositionManager.sol:PositionManager \
  "$(cast abi-encode 'constructor(address,address,uint256,address,address)' \
    "$POOL_MANAGER" "$PERMIT2" 300000 "$POSITION_DESCRIPTOR" 0x0000000000000000000000000000000000000000)" || rc=1
exit $rc
