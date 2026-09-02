#!/usr/bin/env bash
#
# Stable Protection deploy wrapper — Base Mainnet (8453)
#
# What this does:
#   - Verifies clean git tree, required env vars, deployer wallet balance
#   - Asks for explicit "yes" confirmation before broadcasting
#   - Runs forge script with --broadcast and --verify
#   - Verifies bytecode landed at the pre-mined expected address
#   - Runs npm run verify:hooks to record the deployment
#
# What this does NOT do:
#   - Store, request, or expose your private key (lives only in your shell env)
#   - Retry on failure (operator decides next steps)
#   - Run unattended (explicit confirmation required)
#
# Run from repo root:
#   ./contracts/deploy-stable-protection.sh

set -euo pipefail

MIN_BALANCE_WEI=5000000000000000  # 0.005 ETH — enough for hook deploy + verify

# ── Pre-flight ────────────────────────────────────────────────────────

echo "→ Verifying clean working tree..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree dirty. Stash or commit first."
  exit 1
fi

echo "→ Verifying env vars are set..."
: "${BASE_RPC_URL:?Set BASE_RPC_URL in your shell (e.g. https://mainnet.base.org)}"
: "${PRIVATE_KEY:?Set PRIVATE_KEY in your shell (dedicated deployer key — this broadcasts on MAINNET)}"
: "${BASESCAN_API_KEY:?Set BASESCAN_API_KEY for source verification}"
# The mined CREATE2 address depends on the initcode (PoolManager + owner args).
# Get it from a dry run first:
#   cd contracts && forge script script/DeployStableProtection.s.sol --rpc-url base
# then export the printed "Mined hook address" before broadcasting.
: "${STABLE_PROTECTION_EXPECTED_ADDRESS:?Set STABLE_PROTECTION_EXPECTED_ADDRESS (mined address from a dry run)}"

EXPECTED_ADDRESS="$STABLE_PROTECTION_EXPECTED_ADDRESS"

# Strip leading 0x if present, since cast wallet expects hex without prefix
PRIVATE_KEY_HEX="${PRIVATE_KEY#0x}"

echo "→ Confirming deployer wallet has Base ETH..."
DEPLOYER=$(cast wallet address --private-key "0x${PRIVATE_KEY_HEX}")
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$BASE_RPC_URL")
BALANCE_ETH=$(cast --to-unit "$BALANCE" ether)
echo "  Deployer: $DEPLOYER"
echo "  Balance:  $BALANCE_ETH ETH"

if [ "$(echo "$BALANCE < $MIN_BALANCE_WEI" | bc 2>/dev/null || echo 0)" = "1" ]; then
  echo ""
  echo "ERROR: deployer has < 0.005 ETH (not enough for hook deploy + verify)."
  echo "Bridge or transfer ETH to the deployer address on Base Mainnet first."
  exit 1
fi

# ── Confirm before broadcast ──────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "ABOUT TO BROADCAST DEPLOYMENT TO BASE MAINNET (chain 8453)"
echo "═══════════════════════════════════════════════════════════════════"
echo "  Deployer:           $DEPLOYER"
echo "  Expected address:   $EXPECTED_ADDRESS"
echo "  Available balance:  $BALANCE_ETH ETH"
echo "  Source verify:      yes (--verify flag)"
echo ""
echo "  This will spend REAL ETH and put a contract on Base Mainnet."
echo "  The deploy script enforces address == mined-address via require()."
echo "  Confirm security sign-off (docs/security/sign-off.md) is complete."
echo "═══════════════════════════════════════════════════════════════════"
read -r -p "Type 'yes' to broadcast, anything else to abort: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted by operator."
  exit 0
fi

# ── Broadcast ─────────────────────────────────────────────────────────

echo ""
echo "→ Broadcasting deployment..."
cd contracts
forge script script/DeployStableProtection.s.sol \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "0x${PRIVATE_KEY_HEX}" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY" \
  -vvvv
cd ..

# ── Post-deploy verification ──────────────────────────────────────────

echo ""
echo "→ Confirming bytecode is present at expected address..."
DEPLOYED_CODE=$(cast code "$EXPECTED_ADDRESS" --rpc-url "$BASE_RPC_URL")

if [ "$DEPLOYED_CODE" = "0x" ] || [ -z "$DEPLOYED_CODE" ]; then
  echo ""
  echo "ERROR: no bytecode at $EXPECTED_ADDRESS"
  echo "The deployment did not land where expected. Investigate before"
  echo "recording the deployment. Check forge script output above for errors."
  exit 1
fi

BYTECODE_SIZE=$(( (${#DEPLOYED_CODE} - 2) / 2 ))
echo "  ✓ Bytecode present ($BYTECODE_SIZE bytes)"
echo "  ✓ Address: $EXPECTED_ADDRESS"

echo ""
echo "→ Running verify:hooks to record the deployment..."
if [ -f "package.json" ] && grep -q '"verify:hooks"' package.json; then
  STABLE_PROTECTION_HOOK_ADDRESS="$EXPECTED_ADDRESS" npm run verify:hooks
else
  echo "  (skipped — package.json or verify:hooks script not found)"
fi

# ── Summary ───────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════════"
echo "  Address:   $EXPECTED_ADDRESS"
echo "  BaseScan:  https://basescan.org/address/$EXPECTED_ADDRESS"
echo ""
echo "Next steps:"
echo "  1. Verify BaseScan source is verified (green checkmark on the page)."
echo "     If --verify failed, run: forge verify-contract $EXPECTED_ADDRESS"
echo "     <ContractName> --chain-id 8453 --etherscan-api-key \$BASESCAN_API_KEY"
echo "  2. Set STABLE_PROTECTION_HOOK_ADDRESS in the server env and record"
echo "     the address in docs/security/hook-deployments.md via verify:hooks."
echo "  3. Send the deployed address, tx hash, and verify:hooks bytecode"
echo "     hash to the reviewer."
echo "═══════════════════════════════════════════════════════════════════"
