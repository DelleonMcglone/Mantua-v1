# Become a seller — the Mantua x402 go-live runbook

> Phase 17 (MP-003). **This is the code-side deliverable.** Flipping the
> seller env on and submitting Circle's intake form are **human steps, gated
> on counsel sign-off** (D-012 seller-revenue posture, owner-locked fork:
> build now, go-live gated). Nothing in this runbook authorizes an
> operational flip; the runbook exists so the operator who does flip it has
> everything checked and in one place.
>
> Sources, fetched 2026-09-19: Circle's become-a-seller and get-listed guides
> (developers.circle.com), and the shipped paywall (`server/src/middleware/x402-paywall.ts`)
>
> - catalog (`server/src/lib/x402/catalog.ts`). Seller setup context:
>   `docs/x402-setup.md` covers the buyer side and the legacy analyst brief.

## Prerequisites checklist

Work these before any marketplace thought — every intake rejection so far in
Circle's flow traces to one of them:

- [ ] **Dedicated payout wallet.** A controlled EOA that receives USDC on
      Base Mainnet. Options, in order of preference:
  1. A **fresh dedicated EOA** whose key lives in a secrets manager and is
     used for nothing else — cleanest sanctions-screening story, cleanest
     accounting (every `agent_x402_sale` row maps to one wallet).
  2. The **existing admin EOA** (`MANTUA_ADMIN_PRIVATE_KEY`) — acceptable
     (it is already the default buyer key, so seller revenue funds buyer
     spend by construction), but it co-mingles the two roles; the dedicated
     key (`X402_BUYER_PRIVATE_KEY`) then separates buyer from seller again.
     Never the **Circle agent wallet** (the D-008/D-110 custody boundary —
     x402 never draws on the agent-wallet budget) and never a **user Privy
     wallet** (D-106 non-goal).
- [ ] **Node.js v22.6+** locally and in the deployment target (Circle's
      become-a-seller requirement; the repo's CI already pins Node 22).
- [ ] **Facilitator configuration.** The dual-rail paywall reads
      `X402_GATEWAY_FACILITATOR_URL` (default
      `https://gateway-api.circle.com`, the mainnet Gateway facilitator;
      testnet runs `https://gateway-api-testnet.circle.com`). The vanilla
      rail settles via the default public facilitator — no config. Both
      rails settle to `X402_SELLER_ADDRESS`.
- [ ] **Published OpenAPI spec per service.** Circle's review requires it;
      Mantua serves each service's spec **unpaid** at
      `GET /api/x402/openapi/<serviceId>.json` with a machine-readable index
      at `GET /api/x402/v1/services.json` (lands with the OpenAPI PR), and a
      parity test fails CI when a spec drifts from the catalog.
- [ ] **The 402 handshake verified.** From a cold, dark deployment this
      returns 503 — that is correct (dark by default). After the env flip
      (counsel-gated, below) it must return 402:
      `curl -i https://<deployment>/api/x402/v1/markets/discover`

## Operator to-dos (pre-existing, out of Phase 17 build scope)

Two environmental blockers were surfaced by the Phase 17 research and are
noted here because they will bite any go-live rehearsal; neither is a
marketplace code step:

1. **Actions `CRON_SECRET` is unset** — both scheduled workflows
   (`live-sync`, `social-posts`) currently fail in CI for lack of it.
2. **The `test-mantua.vercel.app` deployment is stale** —
   `/api/cron/live-sync` 404s there; redeploy before using it as the
   rehearsal target.

## The counsel gate

The owner-locked fork is **build now, gate go-live**: every seller surface
ships env-gated dark, and two steps are deliberately reserved for humans —

1. **Flipping the seller env on** (`X402_SELLER_ADDRESS` +
   `X402_SELLER_SERVICES` in the production/Vercel env), and
2. **Submitting the Circle intake form** (below).

Both wait on counsel sign-off of the **D-012 seller-revenue posture** (the
D-012 legal-review record: "legal review before fee collection — YES,
non-negotiable"), as resolved under D-106 open question (c). The pricing
defaults in the catalog are owner-adjustable up to that moment — after it,
they are contract terms.

## Circle intake form — what it asks for

Circle's get-listed flow (manual review today; a self-serve flow is coming)
takes, per service:

| Field                 | Mantua's value                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Endpoint URL          | the service's mounted path, e.g. `https://<deployment>/api/x402/v1/markets/discover` (one submission per service id) |
| Payout wallet address | the dedicated wallet from the prerequisites — `X402_SELLER_ADDRESS`                                                  |
| Short description     | the listing copy per service in `docs/marketplace/offerings.md`                                                      |

Prerequisites Circle states for submission: the service returns `402`
unpaid and serves when paid; a **published OpenAPI spec**; the confirmed
payout wallet. Confirm the live form before submitting — the field list
above is as of 2026-09-19.

## Sanctions screening (what review does to you)

The payout wallet address submitted with the form is **sanctions-screened
during review**. Practical consequences: submit a wallet whose ownership and
source of funds are clean and documentable (the dedicated-EOA option exists
for exactly this), expect the screening to take review latency (manual
queue), and do not rotate the payout wallet mid-review — a changed address
restarts the screen.

## After approval — staying listed

Go-live is not the end of the relationship: Circle **continuously
health-checks** every approved listing, and a service stays listed only
while it is reachable. For Mantua that means: keep the seller env on, keep
the OpenAPI specs served unpaid (they are part of the listing), keep the
deployment's cron flows healthy (see the operator to-dos above — a stale
deployment that 404s is a listing risk, not just a hygiene issue), and keep
discovery metadata accurate so agents can filter to the services in the
Discovery API.

## Earnings: checking the Gateway balance and withdrawing

Gateway-rail payments accumulate in the seller's **Gateway balance** and
batch-settle onchain. Check and withdraw with `GatewayClient` from the
already-installed `@circle-fin/x402-batching` package (chain name for Base
Mainnet is `"base"`):

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";

// The payout EOA's private key — the dedicated seller wallet, never the
// agent wallet's keys (D-008/D-110 boundary).
const client = new GatewayClient({
  chain: "base",
  privateKey: process.env.X402_SELLER_PRIVATE_KEY as `0x${string}`,
});

// All balances (wallet + gateway) in one call.
const balances = await client.getBalances();
console.log(`Available: ${balances.gateway.formattedAvailable} USDC`);

// Withdraw the available Gateway balance to the wallet on the same chain.
await client.withdraw(balances.gateway.formattedAvailable);
```

`getBalances(address?)` also takes an address to check any wallet;
`withdraw(amount, { chain?, recipient?, maxFee? })` can target another
chain/recipient. Vanilla-rail payments skip the Gateway entirely — they
settle directly onchain to `X402_SELLER_ADDRESS` (EIP-3009), so nothing to
withdraw. Either way, every settled sale wrote its `agent_x402_sale` audit
row (payer, service, price, network) — that audit trail is the revenue
ledger.

> The snippet reads `X402_SELLER_PRIVATE_KEY` for illustration; the variable
> name is the operator's choice — the paywall itself never needs a private
> key (settlement goes through the facilitator), only the earnings
> withdrawal does. Keep it out of the repo, obviously.

## Go-live sequence (human, after counsel sign-off)

1. Counsel sign-off on the D-012 seller-revenue posture — recorded in the
   D-106 record before step 2.
2. Set `X402_SELLER_ADDRESS` and `X402_SELLER_SERVICES` (a comma-separated
   list of the service ids from `docs/marketplace/offerings.md`; the list
   can grow service by service) in the production env. For the pilot, set
   `X402_SPORTS_INTEL_ALLOWLIST` with the partner addresses — it stays dark
   without it (fail-closed).
3. Redeploy; verify the 402 handshake per service and one paid round trip.
4. Submit the intake form per service (payout wallet = the screened one).
5. On approval, confirm each service appears in the catalog + Discovery API.
6. Record go-live in `docs/tasks/073-phase-17-agent-marketplace.md` and the
   roadmap's Phase 17 section.
