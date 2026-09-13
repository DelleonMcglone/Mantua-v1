# Mantua — Terms of Use (DRAFT, NOT REVIEWED)

> **Status: DRAFT** · Developer-authored counsel copy for the published
> page `client/src/components/legal/TermsPage.tsx` (+ `TermsProductSections.tsx`).
> The page is what users accept; this file carries the same text in
> plain form with the counsel-review markers `[REVIEW: …]`. It is **not**
> legal advice. Version **2026-09-13** (task 067, G-012) — the version
> users accept is recorded per `docs/tasks/launch-gate.md` G-014.

**Effective date:** September 13, 2026 (the page's `EFFECTIVE_DATE`).

## 1. Agreement and eligibility

These terms are an agreement between you and Mantua Intelligence covering
the website, application, and related services. Using them means you
accept the terms; before your first trade the app asks you to accept the
current version and records that acceptance.

You must be at least 18 and legally able to enter this agreement. You may
not use the service from a jurisdiction where it is prohibited, or if you
appear on a sanctions list. You are responsible for knowing whether
trading event contracts is lawful where you are.

`[REVIEW: clickwrap sufficiency of the in-ticket acceptance; age gate; restricted-jurisdiction list and geo posture (DM-108: implied, not surfaced).]`

## 2. What the service is

A non-custodial interface to smart contracts on a public blockchain:
sports prediction markets (yes/no contracts on scheduled games), token
swaps, and liquidity provision. We never take possession or control of
your assets; you hold your keys and sign every transaction; submitted
transactions generally cannot be reversed by you or by us.

## 3. Markets and settlement

- A winning contract pays one dollar; a losing contract pays nothing.
- Buy or sell before **and during** the game; trading closes when the
  game goes final, and no later than twelve hours after the scheduled
  start (contract-enforced backstop). Prices are set by trading in the
  market's pool.
- **Resolution.** A Mantua-operated resolver reads live sports data and
  submits results. Every resolution passes a mandatory review window
  before it is final; results whose sources disagree may be held; a
  manual override exists for missing, delayed, or contradictory data.
  Final resolutions are irreversible and publicly recorded with source
  and signer.
- **Voids.** Postponed, cancelled, abandoned, or tied (no tie outcome)
  games void the market; both sides settle at $0.50 per contract.
- **Pauses and halts.** New buys on a live game are refused while the
  live feed is behind (sells stay open); platform-wide trading may be
  paused under pre-defined conditions; held positions settle normally.

`[REVIEW: whether the review window / override language creates duties; description of the resolver's discretion; void-at-0.50 disclosure adequacy.]`

## 4. Fees and costs

- Regular-season games: no trading fee.
- Playoff games: a dynamic fee between 0.10% and 0.70% of the amount
  traded (liquidity, volatility, activity, uncertainty); 0.70% is a
  contract-level ceiling. The exact fee is shown before confirmation
  and is the fee paid.
- Sponsored transactions cost nothing beyond the shown amount; where
  sponsorship is unavailable the wallet pays the network cost, which
  never flows to us. Bank transfers may carry a disclosed partner fee.

`[REVIEW: fee-change notice requirements; sponsored-gas characterisation.]`

## 5. Funding your account

USDC by wallet transfer, or dollars via a connected bank account that
licensed partners convert to USDC and deliver to the wallet. Partners
hold bank credentials and dollars under their own terms; we hold neither.
Transfers may take business days and may be reversed by the partner
before landing.

`[REVIEW: partner-terms incorporation by reference; money-transmission posture of the partner arrangement.]`

## 6. Agents and automated activity

An optional autonomous agent researches, trades, hedges, and manages
liquidity from its own wallet, held by a regulated custodian under that
custodian's terms. The user funds it and sets its daily limit, per-trade
ceiling, leagues, and whether it may act unprompted. The user is
responsible for the agent's actions within those limits; its analysis is
an estimate, never a guarantee; paid data it buys is charged to its
wallet and recorded; the user can stop it at any time.

`[REVIEW: agency/authorisation language for autonomous execution; custodian terms reference (Circle).]`

## 7. Acceptable use, market integrity, and conflicts

No manipulation, trading on material non-public information, money
laundering or sanctions evasion, multi-accounting or location disguise,
interference with the service, or misrepresentation. The Market Integrity
policy is incorporated. Persons with access to or influence over an event
should assume they may not trade its markets.

## 8. No advice; risk

Nothing is financial, investment, legal, or tax advice. Trading and
liquidity provision can lose everything committed; a losing contract pays
nothing; prices move sharply in play and a trade on live data may execute
at a stale price; thin markets move against large orders; smart-contract,
data-source, network, stablecoin, and third-party risks apply.

`[REVIEW: enforceability of disclaimers in target markets.]`

## 9. Third parties, IP, suspension, disclaimers, liability, indemnity

As on the page: third-party services under their own terms; limited
licence to the interface; suspension for breach or legal necessity
(interface-level only — the contracts are permissionless); "as is"
disclaimers; limitation of liability; indemnification.

`[REVIEW: liability cap amount; consumer-law carve-outs.]`

## 10. Governing law, changes, contact

Delaware law; informal resolution first; **no forum or arbitration
clause yet — counsel to add.** Material changes are re-accepted before the
next trade and the accepted version is recorded. Contact via the Discord
channel until a support inbox exists.

## Counsel review checklist

- [ ] Jurisdictional opt-in and geo posture (DM-108)
- [ ] Clickwrap sufficiency of the recorded in-ticket acceptance
- [ ] Event-contract regulatory characterisation in target markets
- [ ] Resolver discretion, review window, override, void settlement
- [ ] Fee model disclosure and change notice
- [ ] Bank-rail partner terms and money-transmission posture
- [ ] Agent authorisation and custodian (Circle) terms
- [ ] Forum / arbitration; liability cap; consumer carve-outs
