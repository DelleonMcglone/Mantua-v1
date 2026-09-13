# Task 050 — Market quotes must not burn daily-cap headroom

> Follows C-019 (task 024 / circle-custody wave) and 033. C-019 closed the
> `/api/markets/trade/calldata` skip by wrapping the buy leg in `guardSpend`,
> which records a provisional spend intent on the daily ledger the moment
> executable calldata leaves the server. That is the right rule for
> calldata — and the wrong rule for the number the trade ticket re-fetches
> on every keystroke. This lane separates the two.
>
> Gates: server typecheck ✅, lint ✅; client typecheck ✅, lint ✅,
> 135 pass / 0 fail; server suite 765 pass / 0 fail (trade + E2E files: 14).

## The defect

`client/src/features/markets/use-market-trade.ts` re-quoted on every amount
change (400 ms debounce) by calling `POST /api/markets/trade/calldata`. For a
buy that route runs `guardSpend` — check → build → **record** — so every
re-quote inked the ledger. A user who tried 10, 25, 40, 60 and 80 USDC before
committing had consumed 215 USDC of a 100 USDC cap without trading, and the
route never called `reverseSpending`. The intent stayed until the UTC reset.

## Options weighed

| Option                                                                                 | Verdict                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) TTL-reverse** the intent when the calldata is not executed within a short window | Rejected. The ledger is a per-(wallet, day) aggregate with no per-intent rows, so a TTL needs a new table plus a sweep on a serverless runtime; and any TTL is a bypass window — calldata held past its TTL is still signable, so the cap would no longer bind on what was actually issued. Breaks C-019.     |
| **(b) check at quote, record only on the verified fill**                               | Rejected as stated. N quotes each pass the check because nothing is recorded between them; the user holds N signable calldata blobs whose sum exceeds the cap, and the fill records after the money moved. The cap would be advisory again — exactly what C-019 closed.                                       |
| **(c) a separate quote-only path** (shipped)                                           | The quote route returns nothing signable and runs a read-only cap check; the calldata route keeps `guardSpend` and is called once, when the user commits. Mirrors the token-swap split that already exists (`/api/quote` checks, `/api/swap/calldata` checks + records, `/api/swap/record` never re-records). |

## What changed

| Location                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/lib/sports/market-trade-build.ts`     | `MarketTradeQuote` (the built trade minus `to`/`data`/`value`/`approvalTarget`/`sqrtPriceLimitX96`), `toMarketTradeQuote`, `quoteMarketTrade`. Same builder, same quoter, same hook fee — one place still knows how to quote a market swap.                                                                                                                                                                                                             |
| `server/src/routes/market-trade.ts`               | New `POST /api/markets/trade/quote`: buys run `checkSpendingCap` (read-only) then build, and the response is a `MarketTradeQuote`; sells touch no cap. `POST /api/markets/trade/calldata` unchanged in semantics (buys: `guardSpend`, one record at issuance). Both share parsing and the typed error surface. Router is now `createMarketTradeRouter(deps)` with `build` / `checkCap` / `spendIo` seams; `marketTradeRouter` is the production wiring. |
| `server/src/routes/market-fills.ts`               | `createMarketFillsRouter(deps)` with `rpc` / `swapRouterFor` / `hookFor` / `insertFill` / `recordArtifacts` seams; behaviour unchanged. Docblock now states the rule: the fill confirms, it never re-records the ledger (the intent was inked at issuance; a second write or a replayed report would double-count).                                                                                                                                     |
| `client/src/features/markets/use-market-trade.ts` | The debounced re-quote calls the quote route (`TradeQuote`, nothing signable). `execute` fetches calldata once, at commit, for the quoted `amountIn`, then approves/signs/confirms as before. New `building` phase between `quoted` and `approving`.                                                                                                                                                                                                    |
| `client/src/features/markets/LeaguePage.tsx`      | Reads the quote from `phase.quote` (quoted/building) or `phase.calldata` (done); "Preparing your trade…" during `building`.                                                                                                                                                                                                                                                                                                                             |

## Tests

`server/src/routes/market-trade.test.ts` (033 tests kept; 050 added) and
`server/src/routes/market-trade-cap-e2e.test.ts` (agent-e2e.test style:
the shipped routers on an ephemeral express app, fakes only at the seams
they expose — the builder, a running SpendGuardIo ledger, the receipt
reader, the fill store):

- **Repeated quotes leave the ledger unchanged.** Five buy quotes (10 → 80
  USDC against a 100 USDC cap) produce five `check` calls and zero
  `record` calls; `spent` stays 0; a full-cap buy still quotes afterwards;
  no quote body carries `to`/`data`/`value`/`approvalTarget`/`sqrtPriceLimitX96`.
- **A buy over the cap is refused at the quote** with `spending_cap_exceeded`,
  before the builder runs, with no ink.
- **Sells touch no cap** on either route, even with a $0 cap.
- **Calldata inks exactly once**: `check → build → record`; a failed build
  leaves `check` only.
- **The lifecycle** quote ×5 → calldata → sign → verified fill → replayed
  fill ends with exactly one `record`, at calldata issuance; the fill row
  and the P-011/P-006 bookkeeping run once; the replay writes nothing.
- **After a trade the next quote sees the spent headroom** — the intent
  cannot be quoted or signed around (the C-019 property).
- **Fills the chain contradicts** (reverted, wrong target, unknown tx) are
  refused and, like every fill, write no ledger.

The trade test file stays under the write limiter's 20 requests/minute
(the limiter counts per process in tests); the "next quote sees the intent"
journey therefore lives in the E2E file.

## Deliberately left

- **Abandoned calldata still holds its intent until the UTC reset.** After
  this lane that only happens when the user clicks Trade and then rejects
  the wallet prompt — a user action, not a keystroke — and it is the
  conservative direction (an intent that overcounts is safe). A
  receipt-verified release for a _reverted_ market trade would need the
  input amount decoded from `tx.input` rather than taken from the client's
  `usdcRaw` (otherwise a cheap reverted tx to the router could release an
  arbitrary amount); that is a separate lane.
- `docs/tasks/circle-custody-wave.md`'s C-019 row is historical record and
  is not edited.
