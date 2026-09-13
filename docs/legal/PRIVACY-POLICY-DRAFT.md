# Mantua — Privacy Policy (DRAFT, NOT REVIEWED)

> **Status: DRAFT** · This document is a developer-authored starting
> point for crypto-counsel review per Phase 9 / P9-009. It is **not**
> legal advice and **must not** be published before counsel sign-off.
> Specific risk areas flagged inline as `[REVIEW: …]`.
>
> **This file is the source of truth.** The published version renders from
> `client/src/components/legal/PrivacyPage.tsx`, reached from the landing
> footer. The two were written independently and merged on 2026-08-16 —
> keep them in step: any change here needs the matching edit there.

**Effective date:** August 15, 2026 (matches `EFFECTIVE_DATE` in
`client/src/components/legal/LegalPage.tsx`)

**Updated 2026-08-16** for the sports-prediction-market pivot: market
positions and resolution records added to §2, sports data providers added to
§3, chain references per DM-104 (now Base Mainnet).

## 1. Scope

This Privacy Policy describes how Mantua handles information when you
use the Service — an agent-driven sports prediction market where you open
positions, provide liquidity, and run automated strategies. Mantua is a
non-custodial interface — see the
[Terms of Service](./TERMS-OF-SERVICE-DRAFT.md) for the relationship
between you, Mantua, and the underlying smart contracts.

We try to collect as little as possible. The principle below applies
end-to-end: **if we don't need it to make the Service work, we don't
collect it.**

`[REVIEW: confirm scope; in particular whether GDPR / CCPA / LGPD apply to the deployed audience and trigger additional rights disclosures.]`

## 2. What we collect, why, and how long we keep it

| Category              | What                                                                          | Why                                                                                         | Retention                                                               |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Wallet address        | The public address you connect via Privy                                      | Required to authenticate API requests, build calldata, and read your on-chain balances      | Until you delete your account or 2 years of inactivity, whichever first |
| Privy user ID         | The opaque DID Privy issues for your authenticated session                    | Required to bind your wallet to server-side records (positions, agent wallet, preferences)  | Same as above                                                           |
| Transaction records   | Hash, timestamp, action, USD value at submission                              | Power the in-app activity history + portfolio analytics                                     | 2 years                                                                 |
| Position records      | Pool key, tick range, liquidity at mint time                                  | Power the Positions tab + add / remove flows                                                | Until you close the position, then archived for 2 years                 |
| Market positions      | Market ID, outcome side, size, entry price                                    | Power the portfolio's open-position view and P/L                                            | Until the market settles, then archived for 2 years                     |
| Hedging strategies    | Trigger, action, size, cap, expiry, arm/execute timestamps                    | Run the strategy and give you its audit trail                                               | Until you disarm it, then archived for 1 year                           |
| Preferences           | Slippage tolerance, hide-small-balances toggle, etc.                          | Persist your settings across sessions                                                       | Until you change them or delete your account                            |
| Agent wallet metadata | The agent wallet's address and Circle wallet id (custodied by Circle)         | Power the agent surface                                                                     | Until you delete the agent wallet or your Mantua account                |
| Bank connection       | Opaque partner token, bank label (name + last digits), transfer status/amount | Fund the account from a bank; show transfer status (task 067)                               | Until you disconnect the bank, then archived 2 years                    |
| Terms acceptances     | Document, version, timestamp                                                  | Prove which Terms version you accepted (task 067, G-014)                                    | For as long as the account exists                                       |
| AI conversations      | Your questions to the analyst/agent, the conversation, market data            | Answer the question / run the agent (sent to the language-model provider; not for training) | Conversation lifetime; audit log entries 1 year                         |
| Server logs           | IP address, request path, status code, response time                          | Operational health + abuse detection                                                        | 30 days                                                                 |
| Audit log             | Action attempted, outcome, reason (e.g. slippage rejection)                   | Security review + incident postmortems                                                      | 1 year                                                                  |

We do **not** collect: your private keys, the contents of your other
wallets, your real-world identity (we have no KYC), your IP-derived
location for any purpose other than rate-limiting / fraud detection.

**Market-integrity monitoring.** We analyse on-chain and interface activity
for patterns consistent with manipulation — clustered wallets, self-matching,
timing anomalies around news and resolution, coordinated flow. This uses the
records above plus public chain data; it is not a separate collection
category. See the Market Integrity policy for what the analysis is for.

`[REVIEW: confirm the legal basis for integrity monitoring (legitimate interest vs. contract necessity) and whether it needs its own disclosure under the applicable regime.]`

`[REVIEW: confirm retention windows match counsel's recommendation for the target jurisdictions and the residual-risk posture in P5-026.]`

`[REVIEW (task 067): bank-connection data — Plaid and the transfer partner are the controllers of bank credentials; confirm the disclosure and the partner-privacy-policy references. AI processing — confirm the provider's data-use terms (no training) are accurately represented.]`

## 3. Third parties we share data with

The Service depends on third parties to function. The list below is
exhaustive at the time of writing; if we add new providers we'll
update this document and announce the change in-app.

| Provider                                                               | What they see                                                                                       | Their privacy policy                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Privy                                                                  | Your wallet address, the email you sign in with (if you use email login)                            | https://www.privy.io/privacy                                                         |
| Coinbase Developer Platform (CDP)                                      | Your Mantua user ID, the agent wallet's address                                                     | https://www.coinbase.com/legal/privacy                                               |
| CoinGecko                                                              | Token symbols + amounts (for USD pricing requests)                                                  | https://www.coingecko.com/en/privacy                                                 |
| DefiLlama                                                              | Pool IDs (for analytics requests)                                                                   | https://defillama.com/privacy                                                        |
| Hosting providers (Vercel / Railway / Neon — exact set TBD per P9-004) | Whatever an HTTPS request to Mantua's API surfaces                                                  | TBD                                                                                  |
| Anthropic / OpenAI (only when AI features are invoked)                 | The natural-language question you typed; never your wallet contents                                 | https://www.anthropic.com/legal/privacy / https://openai.com/policies/privacy-policy |
| Sports data providers (ESPN primary, second provider per DM-107)       | Nothing about you — we request schedules, scores, and team marks; requests carry no user identifier | Provider-published                                                                   |
| x402 marketplace services (only when an agent buys a call)             | The query the agent sends, and a USDC payment from the agent wallet                                 | Per service                                                                          |

Sports data flows **inbound only**: we fetch public schedules and scores, and
no user identifier is attached to those requests. A provider cannot learn who
holds a position from our traffic.

The swap path for market pools uses the **on-chain v4 Quoter** on Base
Mainnet. No third-party trading API is in the data flow for market pools;
base pairs route per DM-112.

We never sell your data. We never share it with advertisers.

`[REVIEW: confirm the AI-vendor exposure language; ensure the questions sent to LLMs don't include identifiers that turn the request into a personal data transfer.]`

Added 2026-09-13 (task 067) — parties the shipped product uses that the
2026-08 draft did not list:

| Party                       | What they receive                                             | Why                                        |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Circle (Developer Wallets)  | Agent wallet provisioning and transaction requests            | The agent's custodied wallet               |
| Plaid                       | Your bank login (directly, in their widget) → an opaque token | Bank connection                            |
| Licensed transfer partner   | Transfer instructions (amount, direction) keyed to that token | Dollar ↔ USDC transfers                    |
| Anthropic                   | Analyst/agent questions, conversation, market + game data     | Language-model answers and agent reasoning |
| Sportradar / ESPN (inbound) | Nothing about you — requests carry no user identifier         | Schedules, scores, resolution data         |
| Vercel, Neon, Upstash       | Hosting, database, rate-limit/kill-switch state               | Running the service                        |

`[REVIEW: sub-processor list completeness; cross-border transfer basis for each.]`

## 4. Cookies and local storage

The Service uses:

- **Privy session cookies** to keep you logged in.
- **localStorage breadcrumbs** for UX (recently-touched
  pools and positions). These never leave your browser; they're
  used only to make the LP list and Positions tab feel populated
  while server-side reads are warming up.
- **No third-party advertising cookies, analytics pixels, or session
  replay tools.**

`[REVIEW: ePrivacy / cookie banner requirements for UK / EU; whether Privy's session cookie counts as "strictly necessary" or needs consent.]`

## 5. Your rights

Depending on your jurisdiction, you may have rights to:

- **Access** the data we hold about you (request via the contact
  channel below).
- **Correct** inaccurate data.
- **Delete** your account and associated server-side records.
  On-chain transactions and the wallet address itself are public
  blockchain data and cannot be deleted; we will delete the
  server-side records that link your wallet to a Mantua user.
- **Export** your data in a machine-readable format.
- **Object** to processing on legitimate-interest grounds (we'll
  evaluate and respond per applicable law).

`[REVIEW: confirm rights enumeration matches the strictest applicable regime — GDPR Art. 15-22, CCPA §1798.105–110, etc.]`

## 6. International transfers

Mantua is operated by [legal entity TBD]. Server infrastructure runs
in [region TBD per P9-004]. Some third parties (e.g. AI vendors) may
process data in the United States. By using the Service, you consent
to international transfer of the limited data described in §2.

`[REVIEW: SCCs vs. adequacy decisions for EU↔US transfer; UK IDTA; data-transfer impact assessment if material.]`

## 7. Security

We follow the practices documented in [`docs/INCIDENT-RUNBOOK.md`](../INCIDENT-RUNBOOK.md)
and the security review under [`docs/security/`](../security/). Our
deployed hooks have undergone AI-assisted security analysis (per
P5-017 → P5-026). We rotate API keys quarterly. We log access
patterns to our audit table for incident review.

That said: nothing online is perfectly secure. If we discover a
breach affecting your data, we'll notify affected users without
undue delay per applicable law.

## 8. Children

The Service is not directed to anyone under 18. We do not knowingly
collect data from minors. If you believe a minor has connected to
the Service, please contact us and we will delete the associated
records.

## 9. Changes

We may update this Policy. Material changes will be announced in-app
and on the project's official channels at least 14 days before they
take effect, except for urgent legal compliance changes.

## 10. Contact

Privacy requests, questions about this Policy, and market-integrity reports
all go to **info@mantua.ai**.

`[REVIEW: confirm a single shared inbox is acceptable for privacy requests, or whether a dedicated privacy@ alias is needed; postal address for legal process; DPO contact if required by GDPR Art. 37.]`

---

## Counsel review checklist

- [ ] Confirm legal entity name + registered address (§6, §10).
- [ ] Confirm whether GDPR / CCPA / LGPD / PIPEDA apply (§5).
- [ ] Confirm SCCs / IDTA template if EU/UK data flows to US-based
      vendors.
- [ ] Confirm cookie posture (§4) against ePrivacy / national CMP
      requirements.
- [ ] Confirm retention windows (§2) — particularly the 30-day
      server-log window — against your incident response timeline.
- [ ] Confirm the AI-vendor list (§3) covers everything we use and
      what we exclude (e.g. confirm no model fine-tuning on user
      questions).
- [ ] Coordinate with the Terms of Service so cross-references work.
- [ ] Confirm the integrity-monitoring basis (§2) and whether the published
      commitment to monitor matches what we can actually perform.
- [ ] Confirm this file and `client/src/components/legal/PrivacyPage.tsx` say
      the same thing before either is treated as final.
- [ ] Resolution and settlement are not covered here or in the published
      page — decide whether the resolver's role belongs in the Terms
      (B4-006) or needs a privacy disclosure of its own.
