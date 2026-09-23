# Hook deployment verification (P5-001)

## Base Mainnet (8453) — current target

**Status: `DynamicMarketHook` deployed 2026-09-23** on its own PoolManager
(`0xee196B3F83Fe6f57E074C399DBdeFe07e1407636`; full stack in
[`deploy/dynamic-market/README.md`](../../deploy/dynamic-market/README.md#deployment-record)).
`StableProtectionHook` and `DynamicFee` are not deployed yet.
Until a hook is deployed and wired, its address resolves to `null` (env-overridable via
`STABLE_PROTECTION_HOOK_ADDRESS` / `DYNAMIC_FEE_HOOK_ADDRESS`) and the app
degrades gracefully. Mainnet launch checklist:

1. Deploy `StableProtectionHook`, `DynamicFee`, and `DynamicMarketHook` against
   the canonical Base Mainnet Uniswap v4 stack (PoolManager
   `0x498581fF718922c3f8e6A244956aF099B2652b2b`).
2. Verify each deployment: bytecode size + hash against the pinned source
   commit, and the hook permission bits encoded in the address.
3. Record the verified addresses in the table below and set the env overrides.
4. Re-run this verification and update "Last run".

| Hook                   | Chain               | Address                                      | Deployed   | Bytecode size | Bytecode hash        | Permissions                                                                 | Match                                           |
| ---------------------- | ------------------- | -------------------------------------------- | ---------- | ------------: | -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| `StableProtectionHook` | Base Mainnet (8453) | pending                                      | —          |             — | —                    | BEFORE_INITIALIZE, BEFORE_SWAP, AFTER_SWAP                                  | —                                               |
| `DynamicFee`           | Base Mainnet (8453) | pending                                      | —          |             — | —                    | BEFORE_SWAP, AFTER_SWAP                                                     | —                                               |
| `DynamicMarketHook`    | Base Mainnet (8453) | `0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0` | 2026-09-23 |         7,793 | `0x103be191…d25880c` | BEFORE_INITIALIZE, BEFORE_ADD_LIQUIDITY, BEFORE_SWAP, AFTER_SWAP (`0x28C0`) | ✓ solc 0.8.26 rebuild matches on-chain bytecode |

## Pinned source commits

- `StableProtectionHook` — [DelleonMcglone/stableprotection-hook@8190d50](https://github.com/DelleonMcglone/stableprotection-hook/commit/8190d5032bea6a1e85fea969156eb708d1cef266)
- `DynamicFee` — [DelleonMcglone/dynamic-fee@d34af93](https://github.com/DelleonMcglone/dynamic-fee/commit/d34af93025ae998474883eac81596edb7e37c159)
- `DynamicMarketHook` — [DelleonMcglone/Mantua-v1@49fbc60](https://github.com/DelleonMcglone/Mantua-v1/commit/49fbc602569010c34c53505dd9eb427887f67ee9) — the D-105 fee-model build (`MarketFeeFormula.sol`, `RiskPolicy.MAX_RATE = 7000`) the 2026-09-23 mainnet deploy was made from. Full bytecode hash `0x103be191c9c6fed41d1efa950f4249b97ec33b27d0377d83af1491b82d25880c`.

## Historical (superseded) deployments

Earlier verified deployments on the pre-launch test networks (Base Sepolia
84532 and Arc Testnet 5042002, last run 2026-08-22T15:06:40.144Z) are
superseded now that Mantua targets Base Mainnet only; those networks are no
longer supported and their addresses must not be wired into the app.
