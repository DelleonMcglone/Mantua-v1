# x402 nanopayments (agent marketplace access) — setup

The conversational agent can pay tiny USDC fees per call to Circle's **x402
agent marketplace** ([agents.circle.com/services](https://agents.circle.com/services)) —
the full catalog, not just data: web search, news, weather, sports stats,
prediction-market odds, social lookups, academic papers, SMS/communication APIs,
domain lookups, and more. When the agent lacks a capability, it searches the
marketplace before declining.

The buyer is **HTTP-native (x402 v2)** — no CLI, no separate login — so it works
everywhere the server runs, **including the Vercel deployment**. When x402 is
disabled (or no buyer key is configured), the agent's `search_paid_services` /
`call_paid_service` tools report "unavailable" and the agent falls back to the
free `get_market_data` / `get_signals` tools — nothing breaks; the paid path
simply stays dark.

## How it works

- `server/src/lib/x402-buyer.ts`:
  - **Discovery** — the x402 **Bazaar** index (public, no auth) on the CDP
    facilitator, paged and keyword-filtered server-side.
  - **Payment** — a bare request draws HTTP 402 + `PAYMENT-REQUIRED` (base64
    JSON `accepts[]`); `wrapFetchWithPayment` (`@x402/fetch`) signs an
    **EIP-3009 `transferWithAuthorization`** with the buyer EOA and retries.
    The facilitator settles on-chain — the buyer wallet needs **USDC only, no
    gas**. Rail: Base Mainnet (`eip155:8453`).
- Two agent tools in `server/src/lib/agent-chat.ts`:
  - `search_paid_services({ keyword })` — discover paid endpoints (no payment).
  - `call_paid_service({ url, data?, method? })` — price pre-flight → budget
    check → pay → return data + the USD cost.
- Guardrails: per-call cap (`X402_MAX_CALL_USD`), a daily cap
  (`X402_DAILY_CAP_USD`) summed from the audit log, and an
  `logAudit({ action: "agent_x402", ... })` row per payment.

The buyer EOA is **separate** from the app's agent wallet; x402 spend never
touches the agent wallet's balances or its daily cap.

## Setup

1. **Buyer wallet** — defaults to `MANTUA_ADMIN_PRIVATE_KEY` (the same EOA the
   x402 seller is paid to, so seller revenue funds buyer spend). To use a
   dedicated key instead, set `X402_BUYER_PRIVATE_KEY`.
2. **Fund it** with USDC on Base Mainnet. No ETH needed — the facilitator
   settles the EIP-3009 authorization on-chain. Most marketplace services cost
   $0.001–0.05/call, so a few dollars of USDC goes a long way.
3. **Enable it** — in `server/.env` (and the Vercel env for prod):
   ```bash
   X402_ENABLED=1
   X402_MAX_CALL_USD=0.10       # per-call hard ceiling (USDC)
   X402_DAILY_CAP_USD=1.00      # daily ceiling (USDC), summed from the audit log
   ```
4. Restart / redeploy. Ask the agent a premium-data question (e.g. "what are
   the current mentions of @circle on X"); it will `search_paid_services`,
   then `call_paid_service`, and report the cost it paid.

## Agent-to-agent demo — Mantua SELLS its analysis via x402

Mantua is also an x402 **seller**: `GET /api/x402/analyst-brief` returns the
agent's live analyst brief (pegs, market pulse, narratives, TVL movers) for a
**$0.01 USDC** micro-payment, settled on Base Mainnet via the facilitator at
`X402_FACILITATOR_URL`. Payment is the auth — no login. Enable by setting
`X402_SELLER_ADDRESS` (the 0x address that receives the USDC) in the server env;
unset → the endpoint reports 503.

> **Facilitator must serve Base Mainnet.** With `X402_FACILITATOR_URL` unset the
> paywall uses the public x402.org facilitator, which serves **testnets only**
> (`eip155:84532`) and rejects scheme `exact` on `eip155:8453`. The server then
> logs a boot warning and the brief answers 503 `X402_FACILITATOR_UNSUPPORTED`
> (it never throws). Check a candidate with
> `curl <url>/supported` — it must list `exact` on `eip155:8453`.

1. **See the paywall** (no payment):
   ```bash
   curl -i https://mantua.ai/api/x402/analyst-brief
   # → HTTP 402 with an accepts[] payment requirement (exact / eip155:8453 / USDC)
   ```
2. **Agent-to-agent via chat**: tell the Mantua agent
   `call the paid service at https://mantua.ai/api/x402/analyst-brief`
   — the agent (buyer) pays the Mantua service (seller): one agent paying
   another in USDC, end to end. (With the default buyer key, buyer = the
   seller's payout EOA, so the $0.01 round-trips.)
3. **Or from any external x402 buyer** (Circle CLI, another agent, a script
   using `@x402/fetch`) — payment settles to `X402_SELLER_ADDRESS`.

## Notes

- Sub-cent micropayments don't require explicit confirmation; the per-call +
  daily caps bound risk. The agent states the cost it paid in its reply.
- Free (non-paywalled) endpoints short-circuit: the tool returns their
  response with `usdCost: 0` and nothing is signed.
- Leave `X402_ENABLED` unset (off) to keep the feature disabled; the agent
  uses free data.
