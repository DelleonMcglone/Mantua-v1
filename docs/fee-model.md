# Mantua trading fees

Mantua charges trading fees on its sports prediction markets according to
the league calendar. This page is the user-facing description; the numbers
below are the ones the Dynamic Market Hook enforces on-chain.

## Regular season: 0%

Every trade on a regular-season game is free. No Mantua fee, no LP fee. The
pool still moves the price, so what you pay is the market price and nothing
else.

## Playoffs: a dynamic fee between 0.10% and 0.70%

When a game is a playoff game, a dynamic fee applies. The rate moves within
a fixed band:

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

## The formula

```
Fee = C × fee_rate × p × (1 − p)
```

- `C` — number of contracts traded (a contract pays $1 if the outcome
  happens).
- `fee_rate` — the dynamic rate above (0% in the regular season).
- `p` — the contract's price, which is the market's probability, read from
  the pool at the moment you trade.

`p × (1 − p)` is largest at `p = 0.50`, so a coin-flip contract carries the
highest fee, and the fee falls away toward $0 and $1: near-certain outcomes
cost almost nothing to trade.

### Worked examples (playoffs, at the 0.70% ceiling)

| Price `p` | 100 contracts cost | Fee per contract | Fee on 100 contracts |
| --------- | ------------------ | ---------------- | -------------------- |
| $0.05     | $5.00              | $0.00033         | $0.03                |
| $0.25     | $25.00             | $0.0013          | $0.13                |
| **$0.50** | $50.00             | **$0.00175**     | **$0.18**            |
| $0.75     | $75.00             | $0.0013          | $0.13                |
| $0.95     | $95.00             | $0.00033         | $0.03                |

At the 0.10% floor every number above is one seventh as large.

### What the trade ticket shows

For a buy the ticket lists **Position**, **Estimated fee**, and **Total**.
Uniswap takes the fee out of the USDC you send, so Total is what leaves
your wallet, Position is what actually buys contracts, and they differ by
exactly the fee. For a sell the ticket shows the fee taken from the YES
tokens you sell, valued at the current price.

The fee on the ticket is the hook's own quote for your exact trade in the
current pool state — the same function that prices the swap when it
executes — so there is no gap between what you see and what you pay. If the
pool moves between the quote and your confirmation, the ticket re-quotes.

## Where this is enforced

- `contracts/src/hooks/dynamic-market/RiskPolicy.sol` — the 0% / 0.10% /
  0.70% constants.
- `contracts/src/hooks/dynamic-market/MarketFeeFormula.sol` — the formula
  and how it maps onto a Uniswap v4 fee.
- `contracts/src/hooks/dynamic-market/MarketFeeCalculator.sol` — the four
  drivers and the season gate.
- Whether a market is a playoff market is fixed when its pool is created,
  from the league schedule, and cannot be changed afterwards.
