# 031 — UniversalRouter/Permit2 swap execution path

**Status:** ✅ done 2026-09-05
**Branch:** `031-universal-router-swaps`

## Scope

Closes the swap-module audit's last big code item (`docs/architecture.md`
→ "v2 reusability audit" → Swap module): the swap execution path was dead
on Base Mainnet. `buildPoolSwapTestCalldata` targeted v4-core's
PoolSwapTest helper, which does not exist in the canonical mainnet
deployment (`poolSwapTest: null` on 8453) — so `/api/v4/swap/calldata`
502'd and every agent swap failed. Worse, the design had **zero slippage
protection in the transaction**: the min-out was computed and then
discarded (client-advisory only), `sqrtPriceLimitX96` was pinned to the
extremes, and there was no deadline. `UNIVERSAL_ROUTER` and `PERMIT2`
were declared in `v4-contracts.ts` but wired to nothing.

Token swaps (user route + agent) now execute through the canonical
UniversalRouter with the min-out **and** deadline enforced on-chain, and
bounded per-trade Permit2 approvals replace the old infinite
approve-to-test-router.

## Encoding verification (do-not-trust-memory evidence)

The repo has no vendored `contracts/lib/v4-periphery` / universal-router
sources, so every constant and struct layout was verified against the
Solidity of the **deployed** contracts on GitHub — specifically the
universal-router **2.0.0** tag (the release deployed at Base's canonical
`0x6fF5693b99212Da76ad316178A184AB56D299b43`) and the v4-periphery
commit that tag pins as its submodule
(`444c526b77d804590f0d7bc5a481af5a3277c952`, per
`universal-router/lib@2.0.0`):

| Fact                                                                                                                                                                                                                                | Source file (at pin)                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `V4_SWAP = 0x10` (COMMAND_TYPE_MASK 0x7f, FLAG_ALLOW_REVERT 0x80)                                                                                                                                                                   | `universal-router/contracts/libraries/Commands.sol`                                                                |
| `execute(bytes,bytes[],uint256)` wraps `execute(bytes,bytes[])` behind `checkDeadline`; `block.timestamp > deadline` → `TransactionDeadlinePassed()`                                                                                | `universal-router/contracts/UniversalRouter.sol`                                                                   |
| V4_SWAP branch forwards `inputs[i]` verbatim to `_executeActions`                                                                                                                                                                   | `universal-router/contracts/base/Dispatcher.sol`                                                                   |
| The V4_SWAP input decodes as abi `(bytes actions, bytes[] params)`                                                                                                                                                                  | `v4-periphery/src/base/BaseActionsRouter.sol` (+ `CalldataDecoder`)                                                |
| `SWAP_EXACT_IN_SINGLE = 0x06`, `SETTLE_ALL = 0x0c`, `TAKE_ALL = 0x0f`                                                                                                                                                               | `v4-periphery/src/libraries/Actions.sol`                                                                           |
| `ExactInputSingleParams = (PoolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`                                                                                                                   | `v4-periphery/src/interfaces/IV4Router.sol`                                                                        |
| SETTLE_ALL decodes `(Currency, uint256 maxAmount)` → `V4TooMuchRequested`; TAKE_ALL decodes `(Currency, uint256 minAmount)` → `V4TooLittleReceived`; `_swapExactInputSingle` reverts `V4TooLittleReceived` below `amountOutMinimum` | `v4-periphery/src/V4Router.sol`                                                                                    |
| Input settled via `PERMIT2.transferFrom(msgSender, poolManager, amount, token)` → needs ERC-20→Permit2 + Permit2→router allowances                                                                                                  | `universal-router/contracts/modules/Permit2Payments.sol` + `modules/uniswap/v4/V4SwapRouter.sol` (`_pay` override) |

Pitfall caught by pinning: v4-periphery **main** adds a
`minHopPriceX36` field to `ExactInputSingleParams` that does NOT exist
in the deployed router. Encoding against main would produce calldata the
live contract mis-decodes. The builder encodes the 5-field deployed
layout.

## What changed

- **`server/src/lib/v4-universal-router.ts`** (new) —
  `buildUniversalRouterSwapCalldata` (pure): one `V4_SWAP` command whose
  input is actions `[SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]`;
  `amountOutMinimum` is a first-class field enforced on-chain twice
  (router min-out check + TAKE_ALL floor); deadline = now +
  `SWAP_DEADLINE_SECONDS` (10 min, constant). Fails closed on
  `amountOutMinimum <= 0` and on uint128 overflow. Native-ETH input
  rides as `value`. `planSwapApprovals` (pure) emits only the approvals
  the live allowance state still needs, **bounded to the trade amount —
  never MaxUint** (C-022/D-110), with a 30-min Permit2 expiry
  (`PERMIT2_EXPIRATION_SECONDS`); each planned approval carries both a
  raw `{to,data,value}` (user wallet) and the Circle
  `{abiFunctionSignature,abiParameters}` shape (agent wallet), encoding
  the identical call. `readSwapAllowanceState` reads
  ERC20→Permit2 and Permit2→router allowances;
  `buildUniversalRouterSwap` composes calldata + approval plan;
  `minOutFromQuote` derives min-out from the fresh quote.
- **`server/src/routes/v4-swap.ts`** — `/api/v4/swap/calldata` swaps the
  builder; `slippageBps` now hard-capped at `MAX_SLIPPAGE_BPS` (500)
  from `lib/constants.ts` (was 10000 — a 100% slippage request used to
  validate); response carries
  `to/data/value/deadline/approvals[]/amountOutMinimum/quote`.
  `HookNotDeployedError` maps to 400 `HOOK_NOT_DEPLOYED` on the quote
  and calldata routes.
- **`server/src/lib/v4-onchain-swap.ts`** — `resolveHookAddress` fails
  CLOSED: a named hook without a live deployment throws
  `HookNotDeployedError` instead of silently substituting the no-hook
  pool (which quoted — and would have swapped — a different pool than
  the user selected). `buildPoolSwapTestCalldata` **stays**: the
  sports-market periphery legitimately ships its own PoolSwapTest
  (`getV4StackForHook` → market periphery; `sports/market-trade-build.ts`
  imports it); its docblock now says it is not the token-swap path.
- **`server/src/lib/agent-swap.ts`** — `swapFromAgentWallet` uses the
  router builder with an on-chain min-out. `slippageTolerance` was
  validated by the route's zod and then **silently dropped** (the args
  interface had no such field — the spread discarded it); it is now a
  declared arg, converted via `agentSlippageBps` (fractional percent →
  bps, default `DEFAULT_SLIPPAGE_BPS`, re-asserts `MAX_SLIPPAGE_BPS` via
  `assertSlippageBounds` so non-route callers — chat tool, intents,
  rebalance — get the same cap). Approvals go through
  `planSwapApprovals`, bounded per-trade, executed via
  `executeAgentAbiCall` (mirrors agent-liquidity's
  `planMintApprovals` style).
- **`server/src/lib/circle/allowed-targets.ts`** — `UNIVERSAL_ROUTER`
  added to the agent execution allowlist (PERMIT2 was already listed).
- **`client/src/features/swap/use-swap.ts`** — executes the
  server-planned approvals in order (each confirmed before the next),
  then the router tx. The MaxUint `approve` + client-side allowance
  heuristic is gone; the client sends exactly what the server built —
  the min-out and deadline are already inside the signed calldata.
- **`client/src/features/swap/SwapPanel.tsx`** (one memo, sanctioned by
  scope item 5) — the hook venue is offered only when the recommended
  hook is actually deployed (`getHookAddress(...) !== null`);
  undeployed hooks degrade the switcher to No Hook | Bridge instead of
  tripping the server's new fail-closed 400.

## Tests (node:test)

- `server/src/lib/v4-universal-router.test.ts` — calldata layout decoded
  with viem against the same ABIs: selector pinned to `0x3593564c`
  (cross-checked via `toFunctionSelector`), command byte `0x10`, action
  bytes `0x060c0f` in order, `ExactInputSingleParams` round-trip
  (poolKey/direction/amountIn/min-out/hookData), SETTLE_ALL cap =
  amountIn on the input currency, TAKE_ALL floor = min-out on the output
  currency, direction flip, native-value handling, deadline = now+600
  present in the decoded args, fail-closed rejects (zero/overflow
  amounts, zero min-out). `minOutFromQuote` math + range.
  `planSwapApprovals`: bounded-to-trade (never MaxUint/uint160-max),
  skip-when-covered, re-issue-on-expiring, raw-vs-Circle encodings
  decode to the identical call.
- `server/src/routes/v4-swap.test.ts` — clamp: 400 above
  `MAX_SLIPPAGE_BPS` (501/1000/10000), negative and non-integer; exactly
  500 passes validation (reaches the deterministic WALLET_REQUIRED 401).
  Real router on an ephemeral express app (agent-wallets.test.ts style).
- `server/src/lib/agent-swap.test.ts` — `agentSlippageBps` default,
  percent→bps conversion, SafetyError above the cap / on garbage.
- `server/src/lib/v4-onchain-swap.test.ts` — `resolveHookAddress`:
  null → zero address; named-but-undeployed hook throws
  `HookNotDeployedError` (adaptive: passes through when an env override
  deploys the hook); unknown hook name refused.
- `server/src/lib/circle/allowed-targets.test.ts` — UniversalRouter
  allowlisted (case-insensitively).

## Verification status — honest split

**Compile/unit-verified in this worktree** (no live RPC or signer
available here):

- `npm run typecheck`, `npm run lint` — clean.
- `npm test -w @mantua/server` with the CI stub env
  (`DATABASE_URL`/`PRIVY_APP_ID`/`PRIVY_APP_SECRET` stubs, per
  `.github/workflows/ci.yml`) — 411 pass / 0 fail (1 pre-existing skip).
  Without those stubs the suite fails at env parse, as on main.
- `npm test -w @mantua/client` — 118 pass. `npm run build -w
@mantua/client` — builds (pre-existing >500 kB chunk warning).
- Byte-level layout (selector, command, actions, struct order, deadline
  position) is decoded back with viem in the unit tests, and the
  constants were read from the deployed-tag Solidity, not memory.

**Needs a fork/live check before this is called production-verified:**

- An actual swap through `0x6fF5693b…9b43` on a Base fork (or small
  live trade): approve→Permit2→execute sequencing, gas, and that the
  quote-derived min-out doesn't revert healthy swaps
  (`V4TooLittleReceived` tolerance under real pool movement).
- Circle DCW execution of the two approval calls + execute calldata
  (`executeAgentAbiCall` sends `approve(address,address,uint160,uint48)`
  to Permit2 for the first time on this path).
- Native-ETH input path (no registry token is native today — the branch
  is defensive and untested against a live pool).
- Behavior when a Permit2 allowance expires between plan and execution
  (the 300 s validity buffer should prevent it; only a live race can
  confirm).
