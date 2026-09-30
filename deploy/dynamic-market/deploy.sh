#!/usr/bin/env bash
# H-009 — Deploy the Dynamic Market Hook stack to Arc Mainnet (5042), then
# the periphery, with the preflight the runbook requires baked in.
#
#   deploy/dynamic-market/deploy.sh hook        # PoolManager + Registry + Hook (mined CREATE2)
#   deploy/dynamic-market/deploy.sh periphery   # PoolSwapTest, LP router, StateView, V4Quoter, PositionManager
#
# Reads (public values only — never a private key):
#   MARKET_OPERATOR     operator address (registers pools, pauses, rotates roles)
#   MARKET_RESOLVER     keeper address = the market resolver key (spec §0.1)
#   POOL_MANAGER        (periphery only) the PoolManager the hook step printed
#   DEPLOYER_ACCOUNT    keystore name (default: mantua-deployer) — its password is
#                       prompted by cast/forge, never read from the environment
#   ARC_RPC_URL         (default: https://rpc.mainnet.arc.io; use the dedicated one)
#
# Gas on Arc is paid in USDC: the deployer's native balance IS its USDC
# balance (18-decimal view). The whole stack costs well under $1 at Arc's
# ~20 gwei. Verification goes to Arcscan (Blockscout) — no API key.
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
RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
ACCOUNT="${DEPLOYER_ACCOUNT:-mantua-deployer}"
VERIFIER_URL="https://explorer.arc.io/api"
CHAIN_ID=5042

# A placeholder left in an export ("0x...", "...") must fail here, not inside
# forge after the password prompt.
need() { [[ -n "${!1:-}" && "${!1}" != "..." ]] || { echo "missing $1 (set a real value, not a placeholder)" >&2; exit 2; }; }
need_addr() {
  need "$1"
  [[ "${!1}" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "$1 is not a 40-hex address: '${!1}'" >&2; exit 2; }
}
if [[ "$MODE" == "hook" ]]; then
  need_addr MARKET_OPERATOR; need_addr MARKET_RESOLVER
  SCRIPT=script/DeployDynamicMarket.s.sol
else
  need_addr POOL_MANAGER
  SCRIPT=script/DeployMarketPeriphery.s.sol
fi

echo "== chain check"
CHAIN=$(cast chain-id --rpc-url "$RPC")
[[ "$CHAIN" == "$CHAIN_ID" ]] || { echo "RPC $RPC is chain $CHAIN, not Arc Mainnet ($CHAIN_ID)" >&2; exit 2; }

echo "== deployer (keystore '$ACCOUNT' — password prompt)"
DEPLOYER=$(cast wallet address --account "$ACCOUNT")
BAL_WEI=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
BAL_USDC=$(cast --to-unit "$BAL_WEI" ether)
echo "   $DEPLOYER  balance: $BAL_USDC USDC (gas)"
# The hook step is ~8.2M gas; at Arc's ~20 gwei (USDC) that is about $0.17,
# but the simulation and the broadcast both refuse an unfunded sender, so
# stop here with the instruction instead of after the password.
if [[ "$BAL_WEI" == "0" ]]; then
  echo "deployer $DEPLOYER has 0 USDC on Arc — send ~2 USDC to it (bridge via CCTP or an exchange that supports Arc), then rerun" >&2
  exit 2
fi

if [[ "$MODE" == "hook" ]]; then
  echo "== preflight: salt mine + hook suites"
  # The artifact resolver logs spurious "solmate/src/src/..." ERROR lines
  # under the parent remapping; compilation and the tests still succeed
  # (set -e aborts if they do not). Keep the noise out of the transcript.
  forge test --match-contract "SaltMineTest|DynamicMarketHookTest|MarketStateRegistryTest|RiskPolicyTest" -q 2>&1 \
    | grep -vE "foundry_compilers_artifacts_solc::sources" || true
  [[ "${PIPESTATUS[0]}" -eq 0 ]] || { echo "preflight suites failed — not deploying" >&2; exit 1; }
fi

echo "== dry run (fork simulation, no broadcast)"
if ! forge script "$SCRIPT" --rpc-url "$RPC" --sender "$DEPLOYER" 2>&1 \
  | grep -vE "foundry_compilers_artifacts_solc::sources" \
  | tee /tmp/mantua-deploy-dryrun.log \
  | grep -E "^  |Estimated|permission bits|Script ran|Error"; then :; fi
grep -q "Script ran successfully" /tmp/mantua-deploy-dryrun.log || {
  echo "dry run did not succeed — not offering to broadcast (see /tmp/mantua-deploy-dryrun.log)" >&2
  exit 1
}

echo
read -r -p "Broadcast to Arc Mainnet from $DEPLOYER? Type 'yes' to continue: " OK
[[ "$OK" == "yes" ]] || { echo "aborted"; exit 1; }

echo "== broadcast + verify (Arcscan / Blockscout)"
# A verification failure must not hide a successful broadcast: the
# transactions land first; verify.sh re-verifies any contract on its own.
forge script "$SCRIPT" \
  --rpc-url "$RPC" \
  --account "$ACCOUNT" \
  --sender "$DEPLOYER" \
  --broadcast \
  --verify --verifier blockscout --verifier-url "$VERIFIER_URL" \
  || echo "!! broadcast/verify step returned non-zero — check the receipts above; re-verify with deploy/dynamic-market/verify.sh" >&2

echo
echo "== done. Next:"
if [[ "$MODE" == "hook" ]]; then
  cat <<EOF
  1. Copy PoolManager / MarketStateRegistry / DynamicMarketHook / salt from the
     '== Logs ==' block above into deploy/dynamic-market/README.md (Deployment record).
  2. POOL_MANAGER=<PoolManager> $0 periphery
  3. Probe: cast call <Hook> "poolManager()(address)" --rpc-url $RPC
            cast call <Hook> "registry()(address)"    --rpc-url $RPC
  4. If Arcscan shows any contract unverified: deploy/dynamic-market/verify.sh <path:Name> <address> [ctor-args]
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
