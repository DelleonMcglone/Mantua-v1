# Hook deployment verification (P5-001)

## Base Mainnet (8453) — current target

**Status: deployment pending.** No Mantua hooks are deployed on Base Mainnet yet.
Until they are, hook addresses resolve to `null` (env-overridable via
`STABLE_PROTECTION_HOOK_ADDRESS` / `DYNAMIC_FEE_HOOK_ADDRESS`) and the app
degrades gracefully. Mainnet launch checklist:

1. Deploy `StableProtectionHook`, `DynamicFee`, and `DynamicMarketHook` against
   the canonical Base Mainnet Uniswap v4 stack (PoolManager
   `0x498581fF718922c3f8e6A244956aF099B2652b2b`).
2. Verify each deployment: bytecode size + hash against the pinned source
   commit, and the hook permission bits encoded in the address.
3. Record the verified addresses in the table below and set the env overrides.
4. Re-run this verification and update "Last run".

| Hook                   | Chain               | Address | Deployed | Bytecode size | Bytecode hash | Permissions                                                      | Match |
| ---------------------- | ------------------- | ------- | -------- | ------------: | ------------- | ---------------------------------------------------------------- | ----- |
| `StableProtectionHook` | Base Mainnet (8453) | pending | —        |             — | —             | BEFORE_INITIALIZE, BEFORE_SWAP, AFTER_SWAP                       | —     |
| `DynamicFee`           | Base Mainnet (8453) | pending | —        |             — | —             | BEFORE_SWAP, AFTER_SWAP                                          | —     |
| `DynamicMarketHook`    | Base Mainnet (8453) | pending | —        |             — | —             | BEFORE_INITIALIZE, BEFORE_ADD_LIQUIDITY, BEFORE_SWAP, AFTER_SWAP | —     |

## Pinned source commits

- `StableProtectionHook` — [DelleonMcglone/stableprotection-hook@8190d50](https://github.com/DelleonMcglone/stableprotection-hook/commit/8190d5032bea6a1e85fea969156eb708d1cef266)
- `DynamicFee` — [DelleonMcglone/dynamic-fee@d34af93](https://github.com/DelleonMcglone/dynamic-fee/commit/d34af93025ae998474883eac81596edb7e37c159)
- `DynamicMarketHook` — [DelleonMcglone/Mantua-Intelligence@07f6f16](https://github.com/DelleonMcglone/Mantua-Intelligence/commit/07f6f169fb79172c01f4a7d1dd68e9850a132ace)

## Historical (superseded) deployments

Earlier verified deployments on the pre-launch test networks (Base Sepolia
84532 and Arc Testnet 5042002, last run 2026-08-22T15:06:40.144Z) are
superseded now that Mantua targets Base Mainnet only; those networks are no
longer supported and their addresses must not be wired into the app.
