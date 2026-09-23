# Dynamic Market Hook — deploy runbook and records

Deploys the Dynamic Market Hook stack: a dedicated Uniswap v4 `PoolManager`, the
`MarketStateRegistry`, and the hook itself at a mined CREATE2 address.

**Spec:** [`docs/specs/dynamic-market-hook.md`](../../docs/specs/dynamic-market-hook.md)
§37–§42.
**Task:** B2-005.
**Status: hook stack and periphery deployed and BaseScan-verified on Base
Mainnet (8453), 2026-09-23** — see [Deployment record](#deployment-record). Wired into
`server/src/lib/v4-contracts.ts` / `markets-contracts.ts` (PR #79). Next:
deploy the settlement layer (`DeployMarkets.s.sol`), then register the
first market.

**Pre-deploy gate, run 2026-09-12 (H-009 prep):** with `contracts/lib`
populated per the prerequisites, the full suite passed locally against the
live Base Mainnet fork — 238 passed / 0 failed / 8 skipped (the skips are
the StableProtection / DynamicFee E2Es and baselines, which skip while
those hooks have no configured address; every dynamic-market suite, the
128k-call invariant sweeps, `SaltMineTest`, and `MarketLifecycleForkE2E`
ran). A no-key fork simulation of `DeployDynamicMarket.s.sol` ran end to
end: permission bits `10432` (= `0x28C0`), estimated gas `8,163,960`,
≈ 0.00008 ETH at 0.01 gwei — budget 0.01 ETH still stands for headroom
plus the periphery step. The earlier "blocked locally by RPC egress" note
no longer applies from a machine that can reach `mainnet.base.org`.
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
- A Base Mainnet deployer funded with ETH for gas (bridge or transfer —
  budget ~0.01 ETH for the three-contract deploy plus verification).

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
export MARKET_OPERATOR=0x...  MARKET_RESOLVER=0x...  BASESCAN_API_KEY=...
export BASE_RPC_URL=https://<dedicated-provider>/...   # optional; default is the public host
deploy/dynamic-market/deploy.sh hook
# then, with the PoolManager the hook step printed:
POOL_MANAGER=0x... deploy/dynamic-market/deploy.sh periphery
```

**By hand**, from the repo root (the script lives inside the Foundry project
at `contracts/script/`; running it from anywhere else can't resolve the
remappings):

```bash
cd contracts && forge script script/DeployDynamicMarket.s.sol \
  --rpc-url https://mainnet.base.org \
  --account mantua-deployer \
  --sender "$(cast wallet address --account mantua-deployer)" \
  --broadcast \
  --verify --etherscan-api-key "$BASESCAN_API_KEY"
```

(`--via-ir --optimizer-runs 200` are already the project defaults in
`contracts/foundry.toml`, so they're not repeated on the command line.)

`--account` reads the encrypted keystore and prompts for its password; the key is
never passed as an argument. `--sender` is required alongside it so the script
simulates against the right address.

`--via-ir --optimizer-runs 200` matches the rest of the repo (spec §39).
BaseScan verification needs `BASESCAN_API_KEY` exported (spec §40; the
`[etherscan] base` entry in `contracts/foundry.toml` covers chain 8453).

The script asserts the mined address matches the deployed one and that the
permission bits equal `0x28C0`, so a bad deploy fails in the transaction rather
than at the first pool initialize.

---

## Deployment record

Deployed 2026-09-23 18:40 UTC, blocks 51699745–51699746, total gas
6,170,342 (0.0000349 ETH at 0.00566 gwei). Periphery 20:22 UTC, block
51702795, gas 13,539,743 (0.0000756 ETH). Filled in from the script logs and on-chain probes (`hook.poolManager()`,
`hook.registry()`, code sizes) — trust the script's own logs over
Foundry's receipt banner, whose contract labels have been observed
scrambled.

| Field                   | Value                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain                   | Base Mainnet                                                                                                                                                                                                   |
| Chain ID                | `8453`                                                                                                                                                                                                         |
| RPC                     | `https://mainnet.base.org`                                                                                                                                                                                     |
| Explorer                | <https://basescan.org>                                                                                                                                                                                         |
| PoolManager             | `0xee196B3F83Fe6f57E074C399DBdeFe07e1407636`                                                                                                                                                                   |
| PositionManager         | `0x17a69A23F3c0F7F0dCA6391f967C020BaC0906da`                                                                                                                                                                   |
| StateView               | `0x8F76Bba1695798E9ddDb0Da6c67c2900fe0f5deF`                                                                                                                                                                   |
| V4Quoter                | `0x1791972C76a8Bcb9da83E50B9435612590a0102f`                                                                                                                                                                   |
| PoolSwapTest            | `0x76578c4EA626bEe114e5B72939e7927eF5f1CAbF`                                                                                                                                                                   |
| PoolModifyLiquidityTest | `0x0cd79B383c3f10F786bF9B942F791283dFB4d6e6`                                                                                                                                                                   |
| PositionDescriptor      | `0x6A8Ce701aB14a2909F22a18063426fEE016A36da`                                                                                                                                                                   |
| MarketStateRegistry     | `0xEA8c2f329E7eBD9a67FA7E502CEcc938bE3ec7a6`                                                                                                                                                                   |
| DynamicMarketHook       | `0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0`                                                                                                                                                                   |
| Deployment salt         | `0x…94a3` (`0x00000000000000000000000000000000000000000000000000000000000094a3`)                                                                                                                               |
| Hook permission bits    | `0x28C0` (asserted in-tx; re-checked on-chain)                                                                                                                                                                 |
| Operator                | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3` (also the deployer and PoolManager owner)                                                                                                                         |
| Keeper                  | `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3`                                                                                                                                                                   |
| Verification status     | All 10 verified on BaseScan (2026-09-23): periphery except PositionManager by the deploy's `--verify`; PoolManager, registry, hook, and PositionManager via `deploy/dynamic-market/verify.sh` (see note below) |

> **Periphery is a second step.** `DeployDynamicMarket.s.sol` deploys the
> `PoolManager` only; the periphery above came from
> `contracts/script/DeployMarketPeriphery.s.sol` against it (`POOL_MANAGER`).
> Every periphery contract's `poolManager()` / `manager()` was checked
> on-chain to return this stack's PoolManager.

> **Verification.** `forge --verify` fails for any contract that imports
> solmate through v4-core/v4-periphery: forge resolves the import with the
> global `solmate/=lib/solmate/src/` remapping instead of the
> `lib/v4-*/:solmate/=lib/solmate/` context one, drops the file from the
> submitted sources, and BaseScan reports `Source "lib/solmate/..." not found`.
> `verify.sh` works around it: it completes forge's standard-JSON input with
> `fix_std_json.py` and submits to the Etherscan V2 API directly. The completed
> inputs were compiled locally with solc 0.8.26 and match the on-chain
> bytecode byte for byte, metadata hash included.

---

## After deploying

1. **Register a market** before initializing its pool — `beforeInitialize`
   rejects an unregistered pool (spec §8):

   ```bash
   cast send $REGISTRY \
     "registerPool(bytes32,uint64,uint64,bool,uint8,bool)" \
     $MARKET_ID $KICKOFF $RESOLUTION $YES_IS_TOKEN0 6 $PLAYOFFS \
     --rpc-url https://mainnet.base.org
   ```

   - `MARKET_ID` — from `server/src/lib/market-id.ts` (spec §0.4 / B0-004).
   - `YES_IS_TOKEN0` — whether YES sorts below USDC by address. **Getting this
     wrong does not revert**; it inverts every probability the hook reads, so a
     25% market prices as a near-certainty. Compute it, do not guess it.
   - `6` — outcome-token decimals, confirmed in spec §0.1.
   - `PLAYOFFS` — the D-105 season switch: `true` for a postseason game
     (dynamic 0.10%–0.70% fee), `false` for the regular season (0%). **Once
     only** — there is no setter; a wrong value means pause + a new market.
     The sync cron takes it from the provider's season type
     (`PlannedMarket.playoffs`), never by hand.

2. **Initialize the pool** with `fee = 0x800000` (`DYNAMIC_FEE_FLAG`). A static
   fee is rejected: without the flag the PoolManager ignores the hook's fee
   override and the pool would silently run at a fixed tier.

3. **Feed the keeper state.** Until the first `updateMarket`, the market reads
   as stale, so a playoff pool's rate sits at `MAX_RATE` (0.70%) and the cap
   at `MIN_TRADE_CAP` ($100); a regular-season pool stays at 0%. That is the
   intended fail-closed posture (spec §22 / D-105), not a bug.

4. **Probe the fee model** before opening the market to traders:

   ```bash
   # (fee, breakdown, notional, cap) for a $1 exact-input buy of YES.
   cast call $HOOK \
     "quoteFee((address,address,uint24,int24,address),(bool,int256,uint160))" \
     "($CURRENCY0,$CURRENCY1,8388608,60,$HOOK)" "($ZERO_FOR_ONE,-1000000,0)" \
     --rpc-url https://mainnet.base.org
   ```

   Expect `fee == 0` and `breakdown.playoffs == false` on a regular-season
   pool; on a playoff pool `fee == breakdown.rate × (10000 − p) / 10000`
   with `1000 ≤ rate ≤ 7000`. The server's trade build calls exactly this.

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
