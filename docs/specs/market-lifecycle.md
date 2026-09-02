# Spec — Market Lifecycle

**Task:** B0-002 in `docs/tasks/sports-pivot.md`.
**Depends on:** DM-101 (outcome-token AMM), DM-102 (binary ERC-20 pair),
DM-104 (Base Mainnet), DM-106 (moneyline only). Reasoning for each in
`docs/decisions/sports-pivot-decisions.md`.
**Open:** DM-103 (resolution authority) — the resolver's identity and signer
arrangement are unresolved. This spec describes what the resolver _does_; who
holds the key is still the owner's call.

---

## 1. Model

One scheduled game produces one market per market type. At launch that is the
moneyline only (DM-106), so one game → one market.

Each market owns:

- a **YES token** and a **NO token**, both ERC-20, minted by `MarketFactory`
- a **collateral vault** holding USDC 1:1 against outstanding token sets
- a **YES/USDC Uniswap v4 pool** carrying the Dynamic Market Hook
- a **state**, one of `OPEN → FROZEN → RESOLVED → SETTLED`, plus `INVALID`

**The invariant that matters:** USDC held as collateral is always ≥ the
outstanding redeemable supply. Every state transition and every entry point
below preserves it, and B1-007's solvency test and B1-008's fuzz harness exist
to prove it.

YES trades against USDC in the pool. NO is minted and redeemed but does not get
its own pool at launch — a NO position is expressed by holding NO tokens
obtained through `split`. Price maps to probability through the shared
`price ↔ probability` module (B1-010), which is the only place that conversion
is allowed to live.

---

## 2. States

| State      | Trading | Split / merge | Redeem   | Entered when                            |
| ---------- | ------- | ------------- | -------- | --------------------------------------- |
| `OPEN`     | yes     | yes           | no       | market created                          |
| `FROZEN`   | no      | no            | no       | scheduled start time reached (B4-002)   |
| `RESOLVED` | no      | no            | yes      | resolver submits an outcome (B4-001)    |
| `SETTLED`  | no      | no            | yes      | all outstanding sets redeemed           |
| `INVALID`  | no      | no            | yes, 1:1 | game postponed, cancelled, or abandoned |

Transitions are one-way. `RESOLVED → OPEN` does not exist; a mis-resolution is
handled by the incident runbook (B10-009), not by a state change.

`SETTLED` is bookkeeping, not a gate — redemption stays open indefinitely so a
user who never claims can still claim later. It marks the point where
outstanding supply reaches zero.

---

## 3. Lifecycle

### 3.1 Create

Triggered by the market generator (B3-006) when the ingest worker sees a newly
scheduled game for a covered league.

1. Derive the market ID (B0-004) — deterministic, so the same game cannot
   produce two markets.
2. Deploy the YES/NO ERC-20 pair via `MarketFactory` (B1-001).
3. Write the `markets` row with state `OPEN` and the scheduled start time.

Creation is idempotent on market ID. Re-running the generator over the same
slate must be a no-op.

### 3.2 Seed

1. Compute the opening implied probability from the provider's odds, or fall
   back to 0.5 where none is available.
2. Initialise the YES/USDC v4 pool at the tick corresponding to that
   probability (B1-009), with the Dynamic Market Hook attached.
3. Seed initial liquidity from the protocol's own collateral: `split` USDC into
   sets, add the YES side plus USDC to the pool, retain the NO side.

A market with no liquidity is not tradeable and must not be listed. Listing
happens after seeding succeeds, not after creation.

### 3.3 Trade

Users reach a position two ways:

- **Buy YES** — swap USDC for YES in the pool.
- **Take the other side** — `split` USDC into a YES/NO set, sell the YES into
  the pool, keep the NO. Net effect is a NO position funded by the sale.

`split` and `merge` are always available while `OPEN`, independent of pool
liquidity. They are the arbitrage floor that keeps the pool price inside
[0, 1]: if YES trades above 1 USDC, splitting and selling is profitable, which
pushes it back down.

- `split(usdcAmount)` — 1 USDC in → 1 YES + 1 NO out (B1-002)
- `merge(setAmount)` — 1 YES + 1 NO in → 1 USDC out (B1-003)

Both are exact and fee-free. Fees are the hook's job, on the swap path only.

### 3.4 Freeze

At the scheduled start time the market moves to `FROZEN` (B4-002). Two
mechanisms enforce it, and both are required:

1. The **hook** rejects swaps once the market is frozen (B2-003). This is the
   binding one — it holds even if the interface is bypassed.
2. The **interface** stops offering the market for trading.

Freezing also disarms any hedging strategy attached to the market (B9-007) —
a strategy that cannot execute must not sit armed waiting to fire.

`split` and `merge` close at freeze. Allowing them while the outcome is being
determined would let someone mint sets against a known result.

> **Note.** Freezing at scheduled start means no in-play trading at launch.
> Live in-game markets are deferred past Sept 16, and moving to in-play
> trading changes this step rather than adding to it.

### 3.5 Resolve

1. The ingest worker captures the final (B3-005).
2. The resolution service derives the outcome and submits it to the `Resolver`
   contract, which checks signer authority and emits `MarketResolved`
   (B4-001, B4-003).
3. The market moves to `RESOLVED` and the DB is reconciled against the event.

Guards, all of which are load-bearing:

- **Resolve-before-freeze is rejected** (B1-007). An outcome cannot be
  submitted while trading is open.
- **A missing or failed feed does not auto-settle** (B4-004). Absence of data
  is never evidence of an outcome; the market stays frozen and waits.
- **Provider disagreement flags for manual review** (B3-008) instead of
  resolving on the first source to answer.
- **Manual override exists** (B4-004) and is the escape hatch for all of the
  above.

The chain is the record. The DB reflects the `MarketResolved` event; it never
leads it.

### 3.6 Redeem

Once `RESOLVED`:

- winning token → 1 USDC each
- losing token → 0
- a full set → 1 USDC, since one side is the winner

Redemption burns the tokens (B1-004). Double-redeem is rejected (B1-007).
There is no deadline.

### 3.7 Void

A postponed, cancelled, or abandoned game moves the market to `INVALID`
(B4-005). Both tokens then redeem at 0.5 USDC per token — equivalently, every
full set returns the 1 USDC it was minted with, and anyone who bought YES in
the pool at a price other than 0.5 realises the difference against whoever took
the other side.

> **Open question for B4-005.** "Everyone redeems at cost" in the task list is
> ambiguous for pool traders: someone who bought YES at 0.70 did not pay 0.50.
> Paying 0.5/0.5 returns exactly the collateral that exists and keeps the
> solvency invariant, but it is not "at cost" for a pool buyer. The alternative
> — refunding traders at their entry price — requires per-user entry tracking
> and more collateral than the vault holds. **Recommend 0.5/0.5**; flagging
> because the phrasing implies otherwise.

---

## 4. Failure modes

| Failure                            | Behaviour                                                          |
| ---------------------------------- | ------------------------------------------------------------------ |
| Provider down at scheduled start   | Freeze still fires — it is time-based, not data-based              |
| Provider down after final          | Market stays `FROZEN`; resolution waits; manual override available |
| Providers disagree on the final    | Flagged for review (B3-008); no automatic resolution               |
| Game postponed                     | `INVALID` per §3.7                                                 |
| Pool has no liquidity              | Market is not listed; `split`/`merge` still work                   |
| Resolver submits the wrong outcome | Not recoverable on-chain. Incident runbook (B10-009)               |

The last row is the residual risk behind DM-103 and the plan's Risk 2. No
dispute window exists at v1, which is why the resolver's identity is worth
deciding deliberately.

---

## 5. What this spec does not cover

- **Dynamic Market Hook internals** — fee curve, game-state inputs, freeze
  read. Blocked on DM-110; see `docs/specs/dynamic-market-hook.md`.
- **Totals and spreads** — deferred (DM-106). Both need a line value per market
  and push handling, which adds a state this machine does not have.
- **Multi-outcome markets** — three-way soccer results do not fit a binary
  pair (DM-102). Needs a revisit before soccer leaves "Coming soon".
