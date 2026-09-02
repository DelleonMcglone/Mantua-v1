# Phase 4e — Permit2 + critical bugfixes

This slice does three things:

1. **Fixes a critical action-encoding bug**: `Action.BURN_POSITION` was `0x05` in our code but the canonical value in v4-periphery's `Actions.sol` is `0x03`. `0x05` is `MINT_POSITION_FROM_DELTAS`, a deprecated, sandwich-vulnerable action. Phase 4d's full-exit remove path emitted the wrong action and would have reverted on-chain on first real-world use.

2. **Replaces the dead `IERC20.approve(positionManager, ...)` flow with `IERC20.approve(permit2, max)`**. PositionManager's `_pay` (verified in `v4-periphery/src/PositionManager.sol`) always routes through `permit2.transferFrom` — it never calls `IERC20.transferFrom` itself. The previous Phase 4c flow worked only for users who happened to have Permit2 → PM allowance from another Uniswap product. Fresh wallets would have hit `TRANSFER_FROM_FAILED` on settle.

3. **Adds the EIP-712 PermitBatch signature flow** — one signature per add (or skipped entirely if the user's existing Permit2 → PM allowance is fresh enough). Wrapped with `PositionManager.multicall` so `permitBatch + modifyLiquidities` execute atomically.

## Setup

Same as `phase-4-liquidity.md`. No new env vars.

## Permit2 typed-data fields (reference)

- **Domain**: `{ name: "Permit2", chainId: 8453, verifyingContract: 0x000000000022D473030F116dDEE9F6B43aC78BA3 }` — three fields (no `version`). Permit2's EIP-712 deliberately omits version; signing with it would fail to verify.
- **Spender**: PositionManager (`0x7c5f5a4bbd8fd63184577525326123b519429bdc`). Multicall is `delegatecall`, so when `permitBatch` forwards to Permit2, Permit2 sees `msg.sender == PositionManager`. PM is the spender that gets approved.
- **Amount**: `type(uint160).max` — Permit2 caps at uint160. Coupled with a 30-min expiration this is "infinite for the next 30 min".
- **Expiration / sigDeadline**: now + 30 min. Long enough for slow Base blocks + retries; short enough that a leaked sig can't drain a wallet days later.
- **Nonce**: per (owner, token, spender). Read fresh from `permit2.allowance(owner, token, PM).nonce` on every signing — Permit2 increments on `permit()`, NOT on `transferFrom`. Stale nonce → revert.

## E2E checklist

After server + client are up and the user is logged in via Privy:

- [ ] **Fresh wallet, first add to a non-native pool** (e.g. USDC/cbBTC):
  - Wallet prompts: ERC-20 `approve(permit2, max)` for USDC. One tx, expect ~50k gas.
  - Wallet prompts: ERC-20 `approve(permit2, max)` for cbBTC. One tx.
  - Wallet prompts: PermitBatch typed-data signature (no gas).
  - Wallet prompts: tx — calldata is `multicall([permitBatch, modifyLiquidities])` to PositionManager. Inspect via DevTools or BaseScan: function selector should be `0xac9650d8` (`multicall(bytes[])`).
  - Receipt: success, position appears in Positions tab.
  - DB: `portfolio_transactions.params` has the standard fields; `mantua_audit_log` has `action=add_liquidity / outcome=success`.

- [ ] **Same wallet, second add within 30 minutes**:
  - No ERC-20 approve prompts (Permit2 already infinite-approved).
  - No typed-data signature prompt — server sees `permit2.allowance(...).expiration > now + 5 min` and returns `permit2: null`.
  - Single tx: bare `modifyLiquidities` (selector `0xdd46508f`), no multicall wrapper. Inspect via BaseScan to confirm.

- [ ] **Same wallet, second add after 30 minutes** (force expiration):
  - No ERC-20 approves (still infinite).
  - PermitBatch signature prompt comes back.
  - Multicall tx as in step 1.

- [ ] **Native ETH side** (e.g. ETH/USDC):
  - Only USDC triggers ERC-20 → Permit2 approval (ETH doesn't go through Permit2).
  - PermitBatch has 1 element (the USDC entry); no native side in `details[]`.
  - `msg.value` on the multicall equals `amount0Max` if currency0 is ETH (or `amount1Max` if currency1 is ETH).
  - The `SWEEP` action (existing) refunds dust ETH to the user.

- [ ] **Full-exit remove (post-bugfix)**:
  - Open Positions, click Remove, set 100% → confirm.
  - Wallet signs a `modifyLiquidities` whose `actions` blob starts with byte `0x03` (`BURN_POSITION`), then `0x11` (`TAKE_PAIR`), then optionally `0x14` (`SWEEP`) for native side. Verify on BaseScan calldata decoder.
  - Receipt success. The PositionManager NFT is burned (Transfer event with `to == address(0)`).
  - DB: `portfolio_transactions.params.isFullExit=true`, `positions.status=closed`.

- [ ] **Server verification**:
  - `curl -X POST .../api/liquidity/add/calldata -d '{...valid body...}'` returns `permit2: { typedData, permitBatch, permit2Address }` for any wallet without a fresh Permit2 → PM allowance, or `permit2: null` when the allowance is fresh.
  - The `typedData.domain` has exactly three fields.
  - The `typedData.message.details` excludes any zero-address entries (native side filtered).

## What this slice deliberately does NOT cover

- Unifying the same Permit2 flow into the **swap** path. Phase 3's Universal Router integration uses its own Permit2 plumbing and is outside this slice.
- v4 subgraph indexing for pre-Mantua positions — last remaining Phase 4e item.
- A "stuck Permit2 nonce" recovery flow. If a user's signed permit fails to mine and they sign again, the second signature uses the next nonce — first stale signature is dead. No UI for "force re-sign" today; they'd just retry from the modal.
