# Dynamic Market Hook — deploy runbook and records

Deploys the Dynamic Market Hook stack: a dedicated Uniswap v4 `PoolManager`, the
`MarketStateRegistry`, and the hook itself at a mined CREATE2 address.

**Spec:** [`docs/specs/dynamic-market-hook.md`](../../docs/specs/dynamic-market-hook.md)
§37–§42.
**Task:** B2-005.
**Status: Base Mainnet (8453) deployment pending** — see
`docs/tasks/v2-roadmap.md`. The runbook below is what you follow for
that deploy; record the addresses under
[Deployment record](#deployment-record) once it lands.

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

From the repo root (the script lives inside the Foundry project at
`contracts/script/`; running it from anywhere else can't resolve the
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

_No Base Mainnet deployment yet._ When the deploy lands, fill in this
table from the script logs and on-chain probes (`hook.poolManager()`,
`hook.registry()`, code sizes) — trust the script's own logs over
Foundry's receipt banner, whose contract labels have been observed
scrambled.

| Field                | Value                       |
| -------------------- | --------------------------- |
| Chain                | Base Mainnet                |
| Chain ID             | `8453`                      |
| RPC                  | `https://mainnet.base.org`  |
| Explorer             | <https://basescan.org>      |
| PoolManager          | _pending_                   |
| PositionManager      | _pending_                   |
| StateView            | _pending_                   |
| V4Quoter             | _pending_                   |
| PoolSwapTest         | _pending_                   |
| MarketStateRegistry  | _pending_                   |
| DynamicMarketHook    | _pending_                   |
| Deployment salt      | _pending_                   |
| Hook permission bits | must equal `0x28C0` (asserted in-tx) |
| Operator             | _pending_                   |
| Keeper               | _pending_                   |
| Verification status  | _pending_                   |

> **Periphery is a second step.** This script deploys the `PoolManager` only.
> `PositionManager`, `StateView`, `V4Quoter`, and `PoolSwapTest` follow via
> `contracts/script/DeployMarketPeriphery.s.sol` against this stack's
> PoolManager (pass its address as `POOL_MANAGER`). Until they exist,
> `getV4StackForHook` will throw for this hook rather than route to a
> half-built stack.

---

## After deploying

1. **Register a market** before initializing its pool — `beforeInitialize`
   rejects an unregistered pool (spec §8):

   ```bash
   cast send $REGISTRY \
     "registerPool(bytes32,uint64,uint64,bool,uint8)" \
     $MARKET_ID $KICKOFF $RESOLUTION $YES_IS_TOKEN0 6 \
     --rpc-url https://mainnet.base.org
   ```

   - `MARKET_ID` — from `server/src/lib/market-id.ts` (spec §0.4 / B0-004).
   - `YES_IS_TOKEN0` — whether YES sorts below USDC by address. **Getting this
     wrong does not revert**; it inverts every probability the hook reads, so a
     25% market prices as a near-certainty. Compute it, do not guess it.
   - `6` — outcome-token decimals, confirmed in spec §0.1.

2. **Initialize the pool** with `fee = 0x800000` (`DYNAMIC_FEE_FLAG`). A static
   fee is rejected: without the flag the PoolManager ignores the hook's fee
   override and the pool would silently run at a fixed tier.

3. **Feed the keeper state.** Until the first `updateMarket`, the market reads
   as stale, so the fee sits at `MAX_FEE` (5%) and the cap at `MIN_TRADE_CAP`
   ($100). That is the intended fail-closed posture (spec §22), not a bug.

4. **Record addresses** in the table above, then wire them into the
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
