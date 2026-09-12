#!/usr/bin/env bash
# H-009 — Deploy the Dynamic Market Hook stack to Base Mainnet, then the
# periphery, with the preflight the runbook requires baked in.
#
#   deploy/dynamic-market/deploy.sh hook        # PoolManager + Registry + Hook (mined CREATE2)
#   deploy/dynamic-market/deploy.sh periphery   # PoolSwapTest, LP router, StateView, V4Quoter, PositionManager
#
# Reads (public values only — never a private key):
#   MARKET_OPERATOR     operator address (registers pools, pauses, rotates roles)
#   MARKET_RESOLVER     keeper address = the market resolver key (spec §0.1)
#   BASESCAN_API_KEY    for --verify
#   POOL_MANAGER        (periphery only) the PoolManager the hook step printed
#   DEPLOYER_ACCOUNT    keystore name (default: mantua-deployer) — its password is
#                       prompted by cast/forge, never read from the environment
#   BASE_RPC_URL        (default: https://mainnet.base.org; use the dedicated one)
#
# The broadcast is gated behind an explicit "yes" after the preflight prints
# the deployer address, its balance, and the dry-run gas estimate.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "hook" && "$MODE" != "periphery" ]]; then
  echo "usage: $0 hook|periphery" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/contracts"
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
ACCOUNT="${DEPLOYER_ACCOUNT:-mantua-deployer}"

need() { [[ -n "${!1:-}" ]] || { echo "missing $1" >&2; exit 2; }; }
need BASESCAN_API_KEY
if [[ "$MODE" == "hook" ]]; then
  need MARKET_OPERATOR; need MARKET_RESOLVER
  SCRIPT=script/DeployDynamicMarket.s.sol
else
  need POOL_MANAGER
  SCRIPT=script/DeployMarketPeriphery.s.sol
fi

echo "== chain check"
CHAIN=$(cast chain-id --rpc-url "$RPC")
[[ "$CHAIN" == "8453" ]] || { echo "RPC $RPC is chain $CHAIN, not Base Mainnet (8453)" >&2; exit 2; }

echo "== deployer (keystore '$ACCOUNT' — password prompt)"
DEPLOYER=$(cast wallet address --account "$ACCOUNT")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether)
echo "   $DEPLOYER  balance: $BAL ETH"

if [[ "$MODE" == "hook" ]]; then
  echo "== preflight: salt mine + hook suites"
  forge test --match-contract "SaltMineTest|DynamicMarketHookTest|MarketStateRegistryTest|RiskPolicyTest" -q
fi

echo "== dry run (fork simulation, no broadcast)"
forge script "$SCRIPT" --rpc-url "$RPC" --sender "$DEPLOYER" 2>&1 | grep -E "^  |Estimated|permission bits|Script ran|Error" || true

echo
read -r -p "Broadcast to Base Mainnet from $DEPLOYER? Type 'yes' to continue: " OK
[[ "$OK" == "yes" ]] || { echo "aborted"; exit 1; }

echo "== broadcast + verify"
forge script "$SCRIPT" \
  --rpc-url "$RPC" \
  --account "$ACCOUNT" \
  --sender "$DEPLOYER" \
  --broadcast \
  --verify --etherscan-api-key "$BASESCAN_API_KEY"

echo
echo "== done. Next:"
if [[ "$MODE" == "hook" ]]; then
  cat <<EOF
  1. Copy PoolManager / MarketStateRegistry / DynamicMarketHook / salt from the
     '== Logs ==' block above into deploy/dynamic-market/README.md (Deployment record).
  2. POOL_MANAGER=<PoolManager> $0 periphery
  3. Probe: cast call <Hook> "poolManager()(address)" --rpc-url $RPC
            cast call <Hook> "registry()(address)"    --rpc-url $RPC
EOF
else
  cat <<EOF
  1. Record the periphery addresses in deploy/dynamic-market/README.md.
  2. Populate DYNAMIC_MARKET_BY_CHAIN (server/src/lib/v4-contracts.ts) and
     MARKETS_PERIPHERY_BY_CHAIN (server/src/lib/markets-contracts.ts).
  3. DYNAMIC_MARKET_HOOK_ADDRESS=<Hook> npm run verify:hooks
  4. Run the quoteFee probe from the runbook before opening a market.
EOF
fi
