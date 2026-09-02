# Spec — Market ID Scheme

**Task:** B0-004 in `docs/tasks/sports-pivot.md`.
**Implementation:** `server/src/lib/market-id.ts` (+ `market-id.test.ts`).

---

## Definition

```
marketId = keccak256(abi.encode(
    normalize(providerEventId),   // string
    marketType,                   // string
    outcomeIndex                  // uint8
))
```

`normalize` trims surrounding whitespace and lowercases.

| Field             | Type     | Source                                                            |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `providerEventId` | `string` | The primary provider's event ID (ESPN game ID per DM-107)         |
| `marketType`      | `string` | `"moneyline"` at launch (DM-106)                                  |
| `outcomeIndex`    | `uint8`  | Which outcome the YES token represents. Moneyline: 0 home, 1 away |

---

## Why it is shaped this way

**Deterministic, so the generator is idempotent.** The market generator
(B3-006) runs on every slate refresh. Deriving the ID from the game rather than
from a counter means re-running it over the same slate is a no-op — the row
already exists — instead of creating a duplicate market with its own pool and
its own collateral.

**Derivable off-chain and on-chain.** `abi.encode` is what Solidity produces,
so a contract can recompute the ID from the same fields and check it. No
separate registry mapping is needed to agree on what a market is called.

**ABI-encoded, not concatenated.** String concatenation with a separator
collides as soon as a provider ID contains that separator: with `-`, the pairs
`("nfl-1", 2)` and `("nfl", 12)` both flatten to `nfl-1-moneyline-2`. ABI
encoding length-prefixes each field, so they cannot. There is a test for
exactly this case.

**Normalised, so trivial provider variation does not fork a market.** ESPN
returning `NFL-401671789` in one response and `nfl-401671789` in another must
not produce two markets for one game.

---

## Consequences

**The primary provider's ID is load-bearing.** A market ID is tied to ESPN's
event ID. If the primary provider changes (DM-107 names a second provider for
disagreement detection, not for identity), existing market IDs cannot be
recomputed from the new provider's IDs. The `events` table therefore keeps
`provider_event_id` alongside its own canonical UUID, and provider-agnostic
identity (B3-004) belongs to the event row, not to the market ID.

**Outcome index must come from the canonical event row.** If `outcomeIndex`
were assigned from the order a provider returned teams in, an API change could
silently swap home and away and produce a market whose YES token means the
opposite of what it meant yesterday. B3-004's normalisation assigns home and
away; the market ID consumes that assignment.

**Adding a market type is additive.** Totals and spreads (deferred, DM-106)
get their own `marketType` string, so their IDs cannot collide with an existing
moneyline. Adding one does not invalidate anything already deployed.

**Multi-outcome markets do not fit yet.** `outcomeIndex` supports more than two
outcomes at the ID level, but DM-102's binary token pair does not. A three-way
soccer result needs the token model revisited first.
