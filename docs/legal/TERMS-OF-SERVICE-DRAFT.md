# Mantua — Terms of Service (DRAFT, NOT REVIEWED)

> **Status: DRAFT** · This document is a developer-authored starting
> point for crypto-counsel review per Phase 9 / P9-009. It is **not**
> legal advice and **must not** be published before counsel sign-off.
> Specific risk areas flagged inline as `[REVIEW: …]`.

**Effective date:** TBD (set on counsel-approval merge)

## 1. About these Terms

These Terms of Service ("Terms") govern your access to and use of
Mantua (the "Service"), an interface for interacting with Uniswap v4
liquidity pools and Mantua's Liquidity Hooks ("Stable
Protection" and "Dynamic Fee") on **Base Mainnet, a public Ethereum
Layer 2 network**. By
connecting a wallet to the Service or otherwise using it, you accept
these Terms.

`[REVIEW: jurisdictional opt-in language; clickwrap vs. browsewrap; minor age gate.]`

## 2. What Mantua is and isn't

The Service is a **non-custodial interface**. Mantua does not hold your
private keys, route any of your funds through accounts we control, or
custody assets at any point. Every transaction originates from a
wallet you control and is broadcast to **Base Mainnet, a public
Ethereum Layer 2 network**. Assets on Base Mainnet have real-world
value — deposit only what you can afford to place at risk.

The Service exposes:

- A user interface for creating Uniswap v4 pools, providing liquidity,
  swapping tokens, and viewing pool / portfolio information.
- An optional "agent wallet" feature backed by a third-party custodian
  (Coinbase Developer Platform). When you provision an agent wallet,
  the keys are held by that third party under their terms; we do not
  hold them. See § 6.
- AI-assisted natural-language tools for navigating the Service. The
  AI responses are advisory; they do not execute transactions
  automatically and do not constitute trading or investment advice.

`[REVIEW: AI advisory language; whether AI outputs need a separate disclaimer surface in-app.]`

## 3. Eligibility and prohibited use

You agree that you:

1. Are at least 18 years old.
2. Are not a resident of, located in, or accessing the Service from a
   jurisdiction subject to comprehensive U.S. economic sanctions
   (currently Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk,
   and Luhansk regions of Ukraine).
3. Are not on the U.S. Treasury OFAC Specially Designated Nationals
   list or any equivalent list maintained by other governments.
4. Will not use the Service to launder funds, evade sanctions,
   manipulate markets, or commit fraud.

`[REVIEW: jurisdictional carve-outs; whether to add a residency self-attestation at wallet connect.]`

## 4. Risks you accept

You understand and accept that:

- **Smart contracts can fail.** Uniswap v4 and Mantua's hooks have
  undergone AI-assisted security review (per `docs/security/`), but
  no audit eliminates risk. Bugs, reentrancy, oracle manipulation, or
  governance attacks may cause partial or total loss of deposited
  assets.
- **Market risk applies in full.** Token prices, liquidity depth, and
  pool composition can move dramatically. Impermanent loss, slippage,
  and front-running may erode your position. Mantua's hooks are
  designed to mitigate certain risks (e.g. peg drift) but do not
  guarantee outcomes.
- **Network risk applies.** Base or Ethereum congestion, chain
  reorganizations, sequencer downtime, or RPC failures may delay or
  prevent your transactions from confirming.
- **The Service is provided "as is."** We make no warranties about
  uptime, correctness, or fitness for any particular purpose.
- **You are solely responsible** for the security of your wallet,
  your private keys, your transaction parameters (slippage, deadline,
  amount), and the tax / regulatory consequences of your activity in
  your jurisdiction.

`[REVIEW: enforceability of "as is" / disclaimer-of-warranties in target markets; consumer protection laws may override.]`

## 5. Fees

The current beta does **not** charge protocol fees. A Mantua service
fee (capped at 25 bps) may be introduced later with notice. Network gas
fees are paid in ETH to Base sequencers; nothing flows to Mantua while
fee collection is off.

`[REVIEW: confirm "no fees" stays accurate through the fee turn-on; notice requirements when it changes.]`

## 6. Agent wallets (Coinbase Developer Platform)

If you opt to provision a Mantua agent wallet, that wallet is created
and held by Coinbase Developer Platform under their
[Developer Platform Terms](https://www.coinbase.com/legal). Mantua
acts as a UI layer on top of CDP for these flows and does not have
direct custody of the resulting wallet's keys.

You authorize Mantua to:

- Provision an agent wallet keyed to your Mantua user identity.
- Submit transactions you sign or instruct on behalf of that wallet.
- Read public on-chain state about that wallet's balances and
  positions.

You retain the right to revoke this authorization by disconnecting
your Mantua user, terminating your CDP account, or moving the agent
wallet's funds to a wallet you control.

`[REVIEW: pass-through liability vs. CDP terms; whether Mantua's agent UI creates additional fiduciary duty.]`

## 7. Intellectual property

The Mantua interface (this Service) is licensed under the terms in the
repository's `LICENSE` file. Mantua's hook contracts have their own
licenses listed in the contract source headers. The Mantua brand,
logo, and copy on this website are owned by [legal entity TBD].

You receive a non-exclusive, non-transferable, revocable license to
use the Service in accordance with these Terms.

`[REVIEW: confirm legal entity name; trademark filings; open-source vs. proprietary boundary on UI vs. contracts.]`

## 8. Termination

We may suspend or terminate your access at any time, with or without
notice, if we believe you have violated these Terms or applicable law.
We may also suspend the Service entirely (the "kill switch" — see
[`docs/INCIDENT-RUNBOOK.md`](../INCIDENT-RUNBOOK.md)) during a security
incident. On-chain assets remain in your wallet regardless; the
Service has no power to seize, freeze, or claw back funds.

You may stop using the Service at any time by disconnecting your
wallet.

## 9. Disputes and governing law

`[REVIEW: arbitration vs. court; class action waiver; choice of law (Delaware? UK? offshore?); jurisdiction for injunctive relief.]`

## 10. Changes to these Terms

We may update these Terms by posting a new version to this URL and
updating the effective date. Material changes will be announced
in-app and on the project's official communication channels at least
14 days before they take effect, except in cases of urgent legal
compliance.

## 11. Contact

[Contact channel TBD — likely a privacy@ alias and an in-app feedback link.]

---

## Counsel review checklist

Before publishing, counsel must:

- [ ] Confirm legal entity, jurisdiction, and registered agent.
- [ ] Confirm jurisdictional eligibility carve-outs (§3) match the
      product's actual geo-blocking posture.
- [ ] Confirm the "as is" / risk language (§4) is enforceable in the
      target consumer markets.
- [ ] Confirm fee disclosure (§5) and AI advisory language (§2)
      meet applicable consumer-protection / financial-promotions
      standards.
- [ ] Confirm CDP pass-through (§6) doesn't create additional
      fiduciary duty.
- [ ] Specify dispute resolution clause (§9): arbitration provider,
      seat, language, governing law.
- [ ] Specify the contact mechanism (§11) and confirm it accepts
      legal process.
- [ ] Coordinate with the Privacy Policy (`PRIVACY-POLICY-DRAFT.md`)
      so the two documents don't contradict.
