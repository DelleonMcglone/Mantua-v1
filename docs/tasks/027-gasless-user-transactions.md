# 027 — Gasless user transactions (C-005 / C-006, D-111)

> Decision record: `docs/decisions/v2-open-decisions.md` → D-111
> Branch: `027-gasless-user-transactions`
> Status: **C-005 🟡 code-complete behind flag** (`VITE_GASLESS_ENABLED`, OFF by
> default) — pending operator paymaster provisioning. **C-006 ⬜ not run** —
> the live walkthrough requires a funded paymaster policy; the verification
> script below is ready to execute once it exists. Nothing here is claimed
> end-to-end verified.

## Decision summary (D-111)

Users must never acquire, hold, or manage ETH. Agent transactions are already
gasless (Circle Gas Station sponsors the Circle SCA wallets — C-017 wave).
For **user** transactions the accepted path is **Privy smart wallets**:
`@privy-io/react-auth@3.22.2` ships a `./smart-wallets` entrypoint that
provisions an ERC-4337 smart account over the user's **embedded** signer and
routes writes as sponsored user operations through a bundler + paymaster
configured **per chain in the Privy Dashboard**. Paymaster preference:
Circle Paymaster (gas paid in USDC — matches the USDC-native platform), with
a bundler provider's sponsoring policy (Pimlico / Alchemy / Coinbase) as the
operator-funded alternative; the client code is identical either way.

Rejected: Circle Modular Wallets for users (conflicts with D-110 — "Privy
stays"; a custody migration to solve a sponsorship problem) and status-quo
ETH-funding UX (fails C-005 verbatim and cannot be built chainlessly).

Known scope limits (why the flag ships OFF — full detail in D-111):

- Smart wallets cover **embedded-wallet** users only; external-wallet logins
  stay on the EOA path and pay their own gas.
- The smart account has a **different address** than the embedded EOA;
  existing balances/positions live on the EOA. Before default-ON: one-time
  funds sweep + an address-reconciliation pass on portfolio/receive surfaces.

## What is implemented (this branch)

All new logic lives in `client/src/lib/gasless/`; the existing EOA path is
untouched and remains the default. Two clearly-marked, minimal hook points
were added to existing files (both no-ops while the flag is off).

| File                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/src/lib/gasless/config.ts`                    | Pure config resolution: `VITE_GASLESS_ENABLED` strict-truthy flag; optional `VITE_GASLESS_PAYMASTER_CONTEXT` JSON (malformed JSON degrades to "no context", never throws).                                                                                                                                                                                                                                                           |
| `client/src/lib/gasless/bridge.ts`                    | Pure EIP-1193 bridge over the smart-account client: `eth_sendTransaction` → sponsored `sendTransaction` (calldata/to/value pass through verbatim; caller gas fields dropped — fees are the bundler's job), signing → smart account, reads → the hardened public transport. Lets `createWalletClient({ transport: custom(bridge) })` produce the **same viem client type** the EOA path produces, so feature hooks need zero changes. |
| `client/src/lib/gasless/use-gasless-wallet-client.ts` | `useGaslessWalletClient()` — async getter resolving to the sponsored WalletClient, or `null` (flag off / no smart wallet / provisioning failure → EOA fallback; a gasless failure can never block trading). Hook implementation selected once at module load from the build-time flag.                                                                                                                                               |
| `client/src/lib/gasless/provider.tsx`                 | `GaslessProvider` — mounts Privy's `SmartWalletsProvider` (with optional `paymasterContext`) when the flag is on; renders children untouched when off.                                                                                                                                                                                                                                                                               |
| `client/src/lib/privy/provider.tsx`                   | Hook point: wraps children in `GaslessProvider` inside `PrivyProvider`.                                                                                                                                                                                                                                                                                                                                                              |
| `client/src/lib/privy/wallet-client.ts`               | Hook point: `useChainWalletClient()` first asks the gasless getter; `null` falls through to the existing EOA path.                                                                                                                                                                                                                                                                                                                   |
| `client/package.json`                                 | `permissionless@0.2.57` (exact-pinned) — the optional peer dep the `smart-wallets` entrypoint requires.                                                                                                                                                                                                                                                                                                                              |
| `client/.env.example`                                 | The two new (optional) vars, documented.                                                                                                                                                                                                                                                                                                                                                                                             |

Unit tests (node runner, in-module): `config.test.ts` (flag gating, context
parsing) and `bridge.test.ts` (calldata pass-through, gas-field dropping,
local vs. smart vs. public routing, deployment refusal). Gates green:
`npm run typecheck`, `npm run lint`, `npm test -w @mantua/client` (105 pass),
`npm run build -w @mantua/client`.

**Not implemented / not claimed:** live sponsorship (no paymaster policy
exists), approve+trade batching into one user operation, funds
sweep / address reconciliation for existing users, external-wallet coverage.

## Operator steps to turn it on

1. **Privy Dashboard → Wallet infrastructure → Smart wallets:** enable smart
   wallets for the app; pick the smart account implementation (any of the
   offered types works with this integration — the client consumes the
   generic smart-wallet client).
2. **Provision a paymaster on Base (8453)** — one of:
   - **Circle Paymaster** (preferred, D-111): create/enable the paymaster in
     the Circle console for the app's chain and copy its ERC-4337 paymaster
     URL. Users' gas is charged in USDC from the smart account, so the smart
     account must hold USDC (it will — it is the trading balance).
   - **Bundler-provider sponsorship** (Pimlico sponsorship policy / Alchemy
     Gas Manager / Coinbase): create a **funded** sponsorship policy with
     sane caps (per-user-op and monthly), copy the paymaster URL.
3. **Back in the Privy Dashboard,** configure the app's chain entry (Base 8453) with the bundler URL and the paymaster URL from step 2. This is
   dashboard-side only — the client never sees these URLs.
4. **Deploy env:** set `VITE_GASLESS_ENABLED=true` on the client build. Set
   `VITE_GASLESS_PAYMASTER_CONTEXT` only if the chosen paymaster requires a
   per-request context object (e.g. `{"policyId":"…"}` — Circle Paymaster
   and Pimlico policies generally need none).
5. Run the C-006 verification script below. Do not flip the flag on for the
   default production build until it passes AND the address-reconciliation
   work (above) is scheduled — existing users' funds sit on the EOA address.

Rollback: unset `VITE_GASLESS_ENABLED` (or set to anything non-truthy) and
redeploy — the EOA path is fully preserved and needs no other state.

## C-006 verification script (run once a funded policy exists)

Preconditions: flag ON in the target deploy; a **fresh** email/Google login
(embedded wallet, no prior funds); the smart account funded with a few USDC
(deposit flow or direct transfer to the smart-account address); **zero ETH
anywhere** — that is the point.

| #   | Step                                                                                                    | Expected observation                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Log in with a fresh email account; open the browser console                                             | No smart-wallet provisioning errors; `useWallets` shows the embedded wallet                                                                                                                                                              |
| 2   | Confirm ETH balances are zero: check the embedded EOA **and** the smart account address on the explorer | Both `0 ETH`; smart account holds test USDC                                                                                                                                                                                              |
| 3   | Select a market → choose a position → enter a USDC amount                                               | Quote renders; no copy anywhere names chains, gas, or ETH                                                                                                                                                                                |
| 4   | Confirm the trade (first trade includes the USDC approval leg)                                          | Approval and trade both complete; UI reaches its normal "done" state with a tx hash; no wallet ETH-balance error, no "insufficient funds for gas"                                                                                        |
| 5   | Open the tx hash on the explorer                                                                        | The transaction is a **user operation** (bundler `handleOps` entry); `from` is the bundler, the smart account is the sender inside the op; gas paid by the paymaster (or in USDC via Circle Paymaster) — **not** by the user's addresses |
| 6   | Re-check both user addresses                                                                            | Still exactly `0 ETH`; USDC decreased by trade amount (+ USDC gas if Circle Paymaster); YES tokens credited to the **smart account** address                                                                                             |
| 7   | Sell/close the position the same way                                                                    | Same observations as 4–6                                                                                                                                                                                                                 |
| 8   | Negative check: pause/underfund the sponsorship policy, attempt a trade                                 | The trade fails with the app's normal error surface (no hang, no white screen); console shows the gasless path degrading — the app remains usable                                                                                        |
| 9   | Flag-off regression: redeploy with the flag unset, repeat step 3–4 with an ETH-funded wallet            | Original EOA path works unchanged                                                                                                                                                                                                        |

Record results (tx hashes, screenshots of the zero-ETH balances) in this file
when run; only then may C-005 flip to ✅ and C-006 to run/✅ in
`docs/tasks/circle-custody-wave.md`.
