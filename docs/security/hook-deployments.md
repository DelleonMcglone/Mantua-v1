# Hook deployment verification (P5-001)

Last run: 2026-10-10T20:57:37.200Z

| Hook                | Chain      | Address                                      | Deployed | Bytecode size | Bytecode hash         | Permissions                                                      | Match |
| ------------------- | ---------- | -------------------------------------------- | -------- | ------------: | --------------------- | ---------------------------------------------------------------- | ----- |
| `DynamicMarketHook` | Arc (5042) | `0x5E9a32fb180A2ACE6a17D85eB696a27Ce5C028c0` | ✅       |        7781 B | `0x5ca87865b1bb2c5d…` | BEFORE_INITIALIZE, BEFORE_ADD_LIQUIDITY, BEFORE_SWAP, AFTER_SWAP | ✅    |

## Pinned source commits

- `DynamicMarketHook` — [DelleonMcglone/Mantua-v1@49fbc60](https://github.com/DelleonMcglone/Mantua-v1/commit/49fbc602569010c34c53505dd9eb427887f67ee9)

## Notes

Mantua targets Arc Mainnet (5042) only. Hooks marked pending have no Arc deployment yet — deploying them, then re-running this verification with the address env vars set, is a launch-gating step.
