# Dynamic Market Hook — deploy runbook and records

Deploys the Dynamic Market Hook stack: a dedicated Uniswap v4 `PoolManager`, the
`MarketStateRegistry`, and the hook itself at a mined CREATE2 address.

**Spec:** [`docs/specs/dynamic-market-hook.md`](../../docs/specs/dynamic-market-hook.md)
§37–§42.
**Task:** B2-005.
**Status: deployed on Arc Mainnet (5042) 2026-09-30 — see the
[Deployment record](#deployment-record).** The launch chain moved to Arc on
2026-09-29 (B-005); the 2026-09-23 Base Mainnet run is **superseded** (same
deployer, same nonces and salt, so the same addresses — but the Base
contracts are no longer registered anywhere). Arc pre-checks passed 2026-09-29: transient
storage works (tested live), the CREATE2 factory and Permit2 are present,
there is no canonical Uniswap v4 on Arc (this stack brings its own
`PoolManager`), gas is ~20 gwei paid in USDC (whole stack under $1), and
Arcscan is Blockscout (`--verifier blockscout`, no API key). The deploy
tooling below targets Arc; the Base-era notes are kept as history.

**Arc fork gate, run 2026-09-30:** `MarketLifecycleForkE2E` passes against
the live Arc Mainnet fork twice over — with a 6-decimal mock collateral
under vanilla Foundry (what CI runs), and with **Arc's real USDC**
(`0x3600…0000`) under Circle's
[`arc-foundry`](https://github.com/circlefin/arc-foundry) v0.8.0-2, whose
EVM routes the token's transfers through the native balance (vanilla anvil
reverts them with `TRANSFER_FROM_FAILED`). Install the prebuilt binaries as
`arc-forge` / `arc-anvil` / `arc-cast` (the release README's steps), then:

```bash
FORK_REAL_USDC=1 FOUNDRY_PROFILE=arc arc-forge test --root contracts --match-contract MarketLifecycleForkE2E
```

`FORK_REAL_USDC=1` swaps the collateral for the real token and funds the
actors with `vm.deal` (the ERC-20 view is the native balance at 18dp);
`FOUNDRY_PROFILE=arc` selects the Arc EVM (`[profile.arc]` in
`contracts/foundry.toml`).

**Pre-deploy gate (Base era, run 2026-09-12 — historical):** with `contracts/lib`
populated per the prerequisites, the full suite passed locally against the
live Base Mainnet fork — 238 passed / 0 failed / 8 skipped (the skips are
the StableProtection / DynamicFee E2Es and baselines, which skip while
those hooks have no configured address; every dynamic-market suite, the
128k-call invariant sweeps, `SaltMineTest`, and `MarketLifecycleForkE2E`
ran). A no-key fork simulation of `DeployDynamicMarket.s.sol` ran end to
end: permission bits `10432` (= `0x28C0`), estimated gas `8,163,960`,
≈ 0.00008 ETH at 0.01 gwei — budget 0.01 ETH still stands for headroom
plus the periphery step. The earlier "blocked locally by RPC egress" note
no longer applies from a machine that can reach `rpc.mainnet.arc.io`.
`deploy.sh` wraps the preflight, the dry run, an explicit confirmation,
and the broadcast.

---

## Why the salt mine is the load-bearing step

Uniswap v4 does not store a hook's permissions — it reads them from the hook's
**address**. The low 14 bits are the permission bitmap. So the hook has to be
deployed to an address that already encodes exactly the four callbacks it
implements:

```
BEFORE_INITIALIZE    1 << 13
BEFORE_ADD_LIQUIDITY 1 << 11
BEFORE_SWAP          1 << 7
AFTER_SWAP           1 << 6
                     ------
                     0x28C0
```

The deployed address must satisfy `uint160(addr) & 0x3FFF == 0x28C0`.

`HookMiner.find` brute-forces a CREATE2 salt until the predicted address has
those bits. Because CREATE2 derives the address from
`(proxy, salt, keccak(initcode))` and **not** from the deployer's nonce, the
result is reproducible: same salt and same initcode always give the same
address, on any chain, regardless of deploy order.

**The initcode includes the constructor arguments.** A salt mined against one
`(poolManager, registry)` pair is worthless for another, so the registry and
PoolManager must be deployed _before_ mining. The script does this in order.

This is verified in [`SaltMine.t.sol`](../../contracts/test/hooks/dynamic-market/SaltMine.t.sol),
which mines against the real initcode, deploys through a CREATE2 proxy, and
asserts the deployed address equals the mined one and carries the right bits.

> **Getting this wrong is not recoverable in place.** Adding a callback later
> changes the required bitmap, which changes the address, which means a
> redeploy and re-pointing every pool. The four permissions are fixed before
> deployment, not discovered during it.

---

## Prerequisites

- Foundry, and `contracts/lib/` populated — it is gitignored, so a fresh
  checkout has no dependencies:
  ```bash
  cd contracts && mkdir -p lib
  git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
  git clone --depth 1 https://github.com/transmissions11/solmate lib/solmate
  git clone --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
  git clone --depth 1 https://github.com/Uniswap/v4-core lib/v4-core
  git clone --depth 1 https://github.com/Uniswap/v4-periphery lib/v4-periphery
  (cd lib/v4-core && git submodule update --init --recursive --depth 1)
  (cd lib/v4-periphery && git submodule update --init --recursive --depth 1)
  ```
- An Arc Mainnet deployer funded with **USDC — Arc's gas token**. Its
  native balance is its USDC balance; ~2 USDC covers the whole stack with
  headroom (the hook step is ~8.2M gas at ~20 gwei ≈ $0.17). Bridge via
  CCTP or withdraw from an exchange that supports Arc.

- **The deployer key in an encrypted keystore, not a plaintext variable.**
  `--interactive` prompts for the key so it never lands in shell history, a
  dotfile, or a repo file:

  ```bash
  cast wallet import mantua-deployer --interactive
  cast wallet address --account mantua-deployer   # fund this
  ```

  > Do not put a private key in `PRIVATE_KEY=`, in a command line, in a chat, or
  > anywhere it is stored as text. A key that has been pasted somewhere is spent:
  > rotate it and move the funds rather than hoping. Only the two **public**
  > addresses below belong in environment variables.

- Environment — public addresses only:
  ```bash
  export MARKET_OPERATOR=0x...   # registers pools, pauses, rotates roles
  export MARKET_RESOLVER=0x...   # the keeper — same key as the market resolver (spec §0.1)
  ```

---

## Run

**One command (recommended):** exports first, then the wrapper. It checks the
chain id, prints the deployer address and balance (keystore password
prompted, never read from env), runs the salt-mine and hook suites, shows
the fork dry run with the gas estimate, and only broadcasts after you type
`yes`:

```bash
export MARKET_OPERATOR=0x...  MARKET_RESOLVER=0x...
export ARC_RPC_URL=https://<dedicated-provider>/...    # optional; default is the public host
deploy/dynamic-market/deploy.sh hook
# then, with the PoolManager the hook step printed:
POOL_MANAGER=0x... deploy/dynamic-market/deploy.sh periphery
```

**By hand**, from the repo root (the script lives inside the Foundry project
at `contracts/script/`; running it from anywhere else can't resolve the
remappings):

```bash
cd contracts && forge script script/DeployDynamicMarket.s.sol \
  --rpc-url https://rpc.mainnet.arc.io \
  --account mantua-deployer \
  --sender "$(cast wallet address --account mantua-deployer)" \
  --broadcast \
  --verify --verifier blockscout --verifier-url https://explorer.arc.io/api
```

If `--verify` fails for a contract that imports solmate (PoolManager,
PositionManager — forge drops the file from the standard-JSON input), run
`deploy/dynamic-market/verify.sh <path:Name> <address> [ctor-args]`, which
completes the input and submits it to Blockscout directly.

(`--via-ir --optimizer-runs 200` are already the project defaults in
`contracts/foundry.toml`, so they're not repeated on the command line.)

`--account` reads the encrypted keystore and prompts for its password; the key is
never passed as an argument. `--sender` is required alongside it so the script
simulates against the right address.

`--via-ir --optimizer-runs 200` matches the rest of the repo (spec §39).
Arcscan (Blockscout) verification needs no API key (spec §40; the
`[etherscan] arc` entry in `contracts/foundry.toml` covers chain 5042).

The script asserts the mined address matches the deployed one and that the
permission bits equal `0x28C0`, so a bad deploy fails in the transaction rather
than at the first pool initialize.

---

## Deployment record

**Arc Mainnet.** Hook stack deployed 2026-09-30 12:23 UTC, block 23538167,
gas 6,170,342 (0.1234 USDC at 20 gwei). Periphery 12:27 UTC, blocks
23538534–23538535, gas 13,539,743 (0.2708 USDC). Filled in from the
script logs and on-chain probes (`hook.poolManager()`, `hook.registry()`,
every periphery contract's `poolManager()`/`manager()`, code sizes) —
trust the script's own logs over Foundry's receipt banner, whose contract
labels have been observed scrambled. The hook's on-chain bytecode hashes
to `0x103be191c9c6fed41d1efa950f4249b97ec33b27d0377d83af1491b82d25880c`
(7,793 B), identical to the pinned solc 0.8.26 build and to the superseded
Base deploy of 2026-09-23 (blocks 51699745–51699746 / 51702795).

| Field                   | Value                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain                   | Arc Mainnet                                                                                                                                                                                                                            |
| Chain ID                | `5042`                                                                                                                                                                                                                                 |
| RPC                     | `https://rpc.mainnet.arc.io`                                                                                                                                                                                                           |
| Explorer                | <https://explorer.arc.io> (Arcscan / Blockscout)                                                                                                                                                                                       |
| PoolManager             | `0xee196B3F83Fe6f57E074C399DBdeFe07e1407636`                                                                                                                                                                                           |
| PositionManager         | `0x17a69A23F3c0F7F0dCA6391f967C020BaC0906da`                                                                                                                                                                                           |
| StateView               | `0x8F76Bba1695798E9ddDb0Da6c67c2900fe0f5deF`                                                                                                                                                                                           |
| V4Quoter                | `0x1791972C76a8Bcb9da83E50B9435612590a0102f`                                                                                                                                                                                           |
| PoolSwapTest            | `0x76578c4EA626bEe114e5B72939e7927eF5f1CAbF`                                                                                                                                                                                           |
| PoolModifyLiquidityTest | `0x0cd79B383c3f10F786bF9B942F791283dFB4d6e6`                                                                                                                                                                                           |
| PositionDescriptor      | `0x6A8Ce701aB14a2909F22a18063426fEE016A36da`                                                                                                                                                                                           |
| MarketStateRegistry     | `0xEA8c2f329E7eBD9a67FA7E502CEcc938bE3ec7a6`                                                                                                                                                                                           |
| DynamicMarketHook       | `0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0`                                                                                                                                                                                           |
| Deployment salt         | `0x…94a3` (`0x00000000000000000000000000000000000000000000000000000000000094a3`)                                                                                                                                                       |
| Hook permission bits    | `0x28C0` (asserted in-tx; re-checked on-chain)                                                                                                                                                                                         |
| Operator                | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3` (also the deployer and PoolManager owner)                                                                                                                                                 |
| Keeper                  | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3`                                                                                                                                                                                           |
| Verification status     | All 11 verified on Arcscan (2026-09-30) — exact matches on Sourcify (chain 5042) via `verify.sh`, which Arcscan imports; the hook (CREATE2, no creation tx indexed) was submitted through the explorer's web form. See the note below. |

> **Fee model amendment (task 076, 2026-10-10).** The hook at
> `0xb23d…28c0` was compiled from the D-105 source with the regular-season
> gate: a pool registered with `playoffs == false` pays 0% on this
> deployment. The source now charges the dynamic fee in every season, so
> charging regular-season pools requires a **new hook deployment** (mined
> salt, same `0x28C0` permission bits, same registry) and new markets
> whose pools point at it; the `MarketStateRegistry` is unchanged and can
> be reused. Open markets on the old hook keep their 0% regular-season
> pricing until they resolve. Re-run `npm run verify:hooks`, the security
> suite and the sign-off for the new address before any pool is created.

> **Periphery is a second step.** `DeployDynamicMarket.s.sol` deploys the
> `PoolManager` only; the periphery above came from
> `contracts/script/DeployMarketPeriphery.s.sol` against it (`POOL_MANAGER`).
> Every periphery contract's `poolManager()` / `manager()` was checked
> on-chain to return this stack's PoolManager.

> **Verification.** `forge --verify` fails for any contract that imports
> solmate through v4-core/v4-periphery: forge resolves the import with the
> global `solmate/=lib/solmate/src/` remapping instead of the
> `lib/v4-*/:solmate/=lib/solmate/` context one, drops the file from the
> submitted sources, and the explorer reports `Source "lib/solmate/..." not found`.
> `verify.sh` works around it: it completes forge's standard-JSON input with
> `fix_std_json.py` and submits it to **Sourcify** (`sourcify.dev`, which
> lists Arc Mainnet 5042); Arcscan imports a Sourcify match the next time
> the contract page is opened. Arcscan's own API sits behind a Cloudflare
> challenge that rejects any non-browser client, which is why the script
> does not talk to it directly. Two things to know: the settlement
> contracts (`^0.8.26` pragma) compile with the newest installed solc, so
> pass `SOLC=0.8.35` when the artifact under `out/` is a different
> version; and a CREATE2-deployed contract (the hook) has no creation
> transaction Arcscan can index, so its Sourcify match is not auto-imported
> — submit it through the explorer's web form ("Solidity (Standard JSON
> input)", compiler `v0.8.26+commit.8a97fa7a`, the standard-JSON that
> `verify.sh` saves to `/tmp/<Name>.std-input.json`). All 11 inputs match
> the on-chain bytecode byte for byte, metadata hash included.

### Settlement layer

`contracts/script/DeployMarkets.s.sol`, broadcast 2026-09-30 12:31 UTC on
Arc Mainnet, blocks 23539320–23539321 (Resolver, MarketFactory,
`resolver.setFactory` in one broadcast; gas 3,105,548 = 0.0621 USDC at
20 gwei). Compiled with solc 0.8.35. The superseded Base run of 2026-09-23
(block 51704405) landed at the same addresses.

| Field         | Value                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Resolver      | `0x448E16702C19fF0b0AF7b51D675Cc40f1b2D5281`                                          |
| MarketFactory | `0x52e8c370Ff772408b925f8524f49BFd1B96Beb93`                                          |
| Collateral    | USDC `0x3600000000000000000000000000000000000000` (6-decimal view of Arc's gas token) |
| Operator      | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3`                                          |
| Signer        | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3`                                          |
| On-chain      | `resolver.factory()` ↔ `factory.resolver()`, `factory.collateral()`, operator, signer |
| Verification  | Resolver ✅ MarketFactory ✅ (Sourcify exact match at solc 0.8.35 → Arcscan)          |

**Opening markets** is a config change, not a deploy: set
`MARKET_SIGNER_PRIVATE_KEY` in production to the operator's key
(`0x4EF8…12C3` — `marketSignerWallet` refuses any other) and fund it with
USDC for seeding (`MARKET_SEED_USDC` per market, default 10 USDC); on Arc
the same USDC balance pays gas. The next sync-cron run creates, registers, initializes, and seeds.

---

## After deploying

1. **Register a market** before initializing its pool — `beforeInitialize`
   rejects an unregistered pool (spec §8):

   ```bash
   cast send $REGISTRY \
     "registerPool(bytes32,uint64,uint64,bool,uint8,bool)" \
     $MARKET_ID $KICKOFF $RESOLUTION $YES_IS_TOKEN0 6 $PLAYOFFS \
     --rpc-url https://rpc.mainnet.arc.io
   ```

   - `MARKET_ID` — from `server/src/lib/market-id.ts` (spec §0.4 / B0-004).
   - `YES_IS_TOKEN0` — whether YES sorts below USDC by address. **Getting this
     wrong does not revert**; it inverts every probability the hook reads, so a
     25% market prices as a near-certainty. Compute it, do not guess it.
   - `6` — outcome-token decimals, confirmed in spec §0.1.
   - `PLAYOFFS` — the D-105 season label: `true` for a postseason game,
     `false` for the regular season. Since task 076 (2026-10-10) the
     dynamic 0.10%–0.70% fee applies either way; the flag rides into the
     fee breakdown and the telemetry as a label. **Once only** — there is
     no setter; a wrong value means pause + a new market. The sync cron
     takes it from the provider's season type (`PlannedMarket.playoffs`),
     never by hand.

2. **Initialize the pool** with `fee = 0x800000` (`DYNAMIC_FEE_FLAG`). A static
   fee is rejected: without the flag the PoolManager ignores the hook's fee
   override and the pool would silently run at a fixed tier.

3. **Feed the keeper state.** Until the first `updateMarket`, the market reads
   as stale, so every pool's rate sits at `MAX_RATE` (0.70%) and the cap
   at `MIN_TRADE_CAP` ($100), whatever its season. That is the intended
   fail-closed posture (spec §22 / D-105), not a bug. The server's
   keeper (`server/src/lib/sports/registry-keeper.ts`, K-01) writes the three
   fields on every live-sync tick once `MARKET_SIGNER_PRIVATE_KEY` is set;
   `npm run keeper:fork-proof -w @mantua/server` rehearses it against the
   deployed registry on an `arc-anvil` fork (opening → refresh → LIVE → FINAL)
   without any key leaving the keystore.

4. **Probe the fee model** before opening the market to traders:

   ```bash
   # (fee, breakdown, notional, cap) for a $1 exact-input buy of YES.
   cast call $HOOK \
     "quoteFee((address,address,uint24,int24,address),(bool,int256,uint160))" \
     "($CURRENCY0,$CURRENCY1,8388608,60,$HOOK)" "($ZERO_FOR_ONE,-1000000,0)" \
     --rpc-url https://rpc.mainnet.arc.io
   ```

   Expect `fee == breakdown.rate × (10000 − p) / 10000` with
   `1000 ≤ rate ≤ 7000` on every pool; `breakdown.playoffs` only reports the
   season label. The server's trade build calls exactly this.

5. **Record addresses** in the table above, then wire them into the
   server's env-driven contract registry (`server/src/lib/v4-contracts.ts`)
   and extend `HOOK_NAMES` with `"dynamic-market"` if not already present.

---

## Keeper permissions

The keeper may write exactly three fields, via one function:

```
updateMarket(poolId, modelProbability, confidence, eventState)
```

Both bps values are bounds-checked before storage and revert above `10_000`. The
keeper cannot register pools, pause, move a kickoff timestamp, change risk
limits, or rotate any role — those are the operator's, and the split is what
contains a compromised keeper (spec §25).

Nothing the keeper writes can breach the immutable bounds in `RiskPolicy`. The
halt does depend on the keeper's `eventState = FINAL` write, which is why there
is a second path that does not: `kickoff + MAX_EVENT_DURATION` (12 h) reads the
registration timestamp, so swaps halt whether or not the keeper is alive — the
same instant `Market.freeze()` turns permissionless (D-103).

## Fee decomposition event

Every swap emits, for the UI market-adaptation panel (spec §29):

```solidity
event MarketFeeUpdated(PoolId indexed poolId, Breakdown breakdown, uint24 effectiveFee);
```

`Breakdown` carries `baseFee`, `volatilityPremium`, `imbalancePremium`,
`liquidityPremium`, `eventRiskPremium`, `deviationPremium`, and
`directionalAdjustment`. It is emitted as a struct rather than seven flat
parameters so adding a premium later does not change the signature.
