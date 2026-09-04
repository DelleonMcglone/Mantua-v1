# 022 — Privy custody verification (C-002) + custody posture doc (C-009)

**Status:** ✅ done 2026-09-04 · **Branch:** `022-privy-custody-verification`

## Task

- **C-002** — verify that user custody per D-110 (Privy stays; no
  RainbowKit/wagmi) survived the mainnet + chainless passes, checking the
  live Privy config against D-005/D-006/D-007, and that the chain lock is
  Base-only at the SDK boundary. Fix genuine mismatches.
- **C-009** — document the custody posture as a reference subsection in
  `docs/architecture.md`.

## C-002 verification table

| Decision | Code point | Verdict |
| --- | --- | --- |
| D-005 — login methods email + Google + Apple + passkey + wallet, **no SMS** | `client/src/lib/privy/config.ts` → `loginMethods: ["google", "email", "wallet"]` | ✅ PASS as superseded — B6-001 (sports pivot, ✅ done, `docs/tasks/sports-pivot.md` row B6-001) deliberately narrowed the list to Google + email + wallet; the config comment records the supersession. The load-bearing half of D-005 — **SMS excluded** — holds. Not a chainless/mainnet regression; no fix. |
| D-006 — `createOnLogin: 'users-without-wallets'` | `config.ts` → `embeddedWallets.ethereum.createOnLogin: "users-without-wallets"` | ✅ PASS |
| D-007 — WalletConnect enabled | `config.ts` → `walletConnectCloudProjectId: cleanEnv(VITE_WALLETCONNECT_PROJECT_ID)`; `"wallet_connect"` present in `appearance.walletList` | ✅ PASS |
| D-110(1) — Privy only; no RainbowKit/wagmi | `client/package.json` and `client/src` have zero `wagmi` / `@rainbow-me` deps or imports; `wallet-client.ts` bridges Privy → viem directly (P2-013) | ✅ PASS |
| Chain lock — Base Mainnet only at the SDK boundary | `config.ts` → `defaultChain: base`, `supportedChains: [base]` (8453, `testnet: false`, from `client/src/lib/chains.ts`; `SUPPORTED_CHAIN_IDS = [8453]`); `wallet-client.ts` pins `BASE_CHAIN_ID` and asserts/`switchChain`s a mismatched wallet | ✅ PASS |
| Chainless pass intact | No chain-switcher UI in `client/src/lib/privy/**`; `chains.ts` `NetworkKey` is `"base"` only | ✅ PASS |
| Provider guard intact | `provider.tsx` renders the actionable `VITE_PRIVY_APP_ID` missing-config screen instead of crashing | ✅ PASS |

## Fixes made

None required — every live config point matches its governing decision
(D-005 as superseded by B6-001). `client/src/lib/privy/**` unchanged.

## C-009 summary

Added **"Custody posture (C-009)"** under "Circle agent wallet (Phase 6)" in
`docs/architecture.md`: (1) user custody = Privy non-custodial
embedded/external wallets, keys never server-side, Base-locked; (2) agent
custody = Circle DCW SCA on BASE, entity secret as env-only custody root,
wallet-set pinning, Gas Station sponsorship; (3) the D-008 two-wallet
segregation — funds cross only user→agent with a user signature, per-wallet
caps, execute + allowlist funnel; (4) the x402 buyer EOA as a third,
deliberately separate key with its own caps (D-106); (5) what Mantua never
holds. All points cite file paths.
