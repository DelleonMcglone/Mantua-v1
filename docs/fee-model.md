# Mantua trading fees

Mantua charges a dynamic trading fee on every trade on its sports
prediction markets, in the regular season and the playoffs alike. This
page is the user-facing description; the numbers below are the ones the
Dynamic Market Hook enforces on-chain.

> **Change of 2026-10-10.** Until this date the regular season was free and
> the dynamic fee applied only to playoff games. The owner withdrew the
> regular-season exemption (task 076); the fee structure itself is
> unchanged.

## Every season: a dynamic fee between 0.10% and 0.70%

A dynamic fee applies to every trade. The rate moves within a fixed band:

| Bound       | Rate  |
| ----------- | ----- |
| Floor       | 0.10% |
| **Ceiling** | 0.70% |

The ceiling is written into the hook as a constant. There is no setting,
key, or vote that can raise it; only a new deployment could.

Inside the band the rate responds to four things, each adding at most a
quarter of the room between floor and ceiling:

- **Liquidity** — thinner pools cost more to trade.
- **Volatility** — a price that has been jumping costs more.
- **Trading activity** — heavy one-sided flow costs more, and the side that
  pushes the market further off balance pays a little more than the side
  that brings it back.
- **Market uncertainty** — how far Mantua's model disagrees with the pool,
  weighted by the model's own confidence, plus the state of the game (a
  live, decisive moment is riskier than pre-game).

If the game-state feed goes quiet for 15 minutes, the rate sits at the
ceiling until it returns. Trading never stops because of a fee.

Whether a game is a regular-season or a playoff game is still recorded
when its market is created, and the ticket shows it, but it no longer
changes the fee.

## The formula

```
Fee = C × fee_rate × p × (1 − p)
```

- `C` — number of contracts traded (a contract pays $1 if the outcome
  happens).
- `fee_rate` — the dynamic rate above.
- `p` — the contract's price, which is the market's probability, read from
  the pool at the moment you trade.

`p × (1 − p)` is largest at `p = 0.50`, so a coin-flip contract carries the
highest fee, and the fee falls away toward $0 and $1: near-certain outcomes
cost almost nothing to trade.

### Worked examples (at the 0.70% ceiling)

| Price `p` | 100 contracts cost | Fee per contract | Fee on 100 contracts |
| --------- | ------------------ | ---------------- | -------------------- |
| $0.05     | $5.00              | $0.00033         | $0.03                |
| $0.25     | $25.00             | $0.0013          | $0.13                |
| **$0.50** | $50.00             | **$0.00175**     | **$0.18**            |
| $0.75     | $75.00             | $0.0013          | $0.13                |
| $0.95     | $95.00             | $0.00033         | $0.03                |

At the 0.10% floor every number above is one seventh as large.

### What the trade ticket shows

For a buy the ticket lists **Position**, **Fee**, **Fee rate**, and
**Total**. Uniswap takes the fee out of the USDC you send, so Total is
what leaves your wallet, Position is what actually buys contracts, and
they differ by exactly the fee. For a sell the ticket shows the contracts
sold and the fee taken from them, valued at the current price. A "How
fees work" toggle under the lines opens this structure in five sentences.

Two checks the ticket makes on every quote: a $100 buy at 50/50 and the
0.70% ceiling shows a $0.35 fee, and 100 contracts at that price show
$0.18 — both asserted in the client tests — and a quote whose rate exceeds
0.70% is refused and reported as an error instead of being displayed.

The fee on the ticket is the hook's own quote for your exact trade in the
current pool state — the same function that prices the swap when it
executes — so there is no gap between what you see and what you pay. If the
pool moves between the quote and your confirmation, the ticket re-quotes.

## Where this is enforced

- `contracts/src/hooks/dynamic-market/RiskPolicy.sol` — the 0.10% /
  0.70% constants.
- `contracts/src/hooks/dynamic-market/MarketFeeFormula.sol` — the formula
  and how it maps onto a Uniswap v4 fee.
- `contracts/src/hooks/dynamic-market/MarketFeeCalculator.sol` — the four
  drivers. There is no season gate.
- Whether a market is a playoff market is fixed when its pool is created,
  from the league schedule, and cannot be changed afterwards. It is a
  label on the quote and the fee telemetry, not an input to the rate.
