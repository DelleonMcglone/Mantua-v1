# Prompt History — Sports Pivot, Phase B0

**Date:** 2026-08-16
**Branch:** `sports-pivot`
**Task:** B0-007 — prompt history captured.
**Covers:** the landing/legal/docs rewrite that preceded the plan, and phase B0.

---

## Session shape

Two halves. The first rewrote the public surfaces for the sports positioning
before the pivot plan existed. The second filed the plan and worked B0.

### Part 1 — public surfaces (before the plan)

Delivered iteratively from owner copy, one instruction at a time:

- Landing header: Arc/Circle badge replaced with the league nav; "Launch Demo"
  → "Launch App"; nav moved inline with the wordmark; nav text set to full
  white with visible `|` separators.
- Hero, all five feature cards, and all four FAQ answers replaced with
  owner-supplied copy. "Uniswap v4 hooks" renamed to "Mantua hooks"
  everywhere in user-facing content.
- Demo video replaced with a 16:9 placeholder pending a re-cut.
- Footer restructured: Documentation, Social Media with brand icons, and a
  copyright line carrying Privacy · Terms of Use · Market Integrity.
- Three legal pages and a GitBook-shaped documentation site added, all
  standalone public routes.

### Part 2 — pivot plan and B0

- Plan filed at `docs/tasks/sports-pivot.md`.
- Owner closed DM-105 (NFL + WNBA), DM-108 (testnet implied, not marketed),
  and confirmed the landing page stays.
- Header nav extended to the in-app shell.
- B0-001 … B0-007 worked; see below.

---

## Decisions the owner made directly

| Decision | Owner instruction                                           |
| -------- | ----------------------------------------------------------- |
| DM-105   | "Cover NFL and WNBA, and the other leagues say Coming Soon" |
| DM-108   | "Its implied that its a testnet, do not market in the UI"   |
| B5-001   | "The landing page stays"                                    |
| Terms    | Governing law → Delaware; disputes left general             |
| Contact  | `info@mantua.ai` for privacy, terms, and integrity          |

## Decisions accepted from the plan's own defaults

DM-101, DM-102, DM-104, DM-106, DM-107, DM-112 — recorded with reasoning and
rejected alternatives in `docs/decisions/sports-pivot-decisions.md`. These were
the plan's proposed defaults, accepted rather than independently chosen; the
owner was told so and can revise any of them.

## Still open

- **DM-103** — resolution authority. Needs owner sign-off: single resolver key
  vs. multisig, and whether UI disclosure substitutes for a dispute window.
- **DM-110** — Dynamic Market Hook spec. Never supplied. Blocks B0-003 and all
  six P0 tasks in B2.
- **DM-111** — agent wallet path. Contingent on B8-001.

---

## Notes worth carrying forward

**Copyright refusals.** Two requests asked for content modelled on other
products — Polymarket's privacy policy and integrity policy. Both were written
from scratch instead of copied: the documents are copyrighted, and a privacy or
integrity policy is a set of factual claims about one operator's practices, so
adopting another company's text would have had Mantua asserting things that
aren't true of it. The owner was told each time. The Alphix reference for the
docs site was treated as a structural model only.

**Two privacy drafts existed.** `docs/legal/PRIVACY-POLICY-DRAFT.md` predated
this session and was not discovered until after the published page was written.
Merged 2026-08-16 — the markdown is the source of truth and carries the counsel
checklist; the TSX renders it. They must be kept in step.

**Sport and social glyphs are generic.** League wordmarks and brand marks are
trademarked, so the nav icons are generic ball shapes rather than league logos.
Swap in licensed assets if they are ever obtained.

**Dynamic Fee's described mechanics are unverified.** The Chainlink/Nezlobin
description came from the owner and is now on the landing page and in the docs,
but that hook's Solidity is not in this repo and nothing in the tree references
either. Confirm against the deployed contract.
