# Prompt History — Circle Sports Agent demo video (task 077)

**Date:** 2026-10-14
**Branch:** `claude/gracious-brown-8wm5k7`
**Task:** 077 — marketing demo video, Mantua version of the Public.com "Agents" spot.

## Original prompt (owner)

> I want to replicate this video but a Mantua version, demoing the automated
> process with the Circle Sports Agent, it should be demoing the daily brief
> and user flow to the automated process. The text spots should have the
> attached background the ending text should be Find Your Edge only at
> Mantua.AI

Attachments: the reference MP4 (Public.com "Agents", 34 s, 1108×720) and a
portrait nebula image with the Mantua mark (843×1264).

Follow-up (owner, same day), after a first cut built as a reconstructed
motion page:

> This is wrong! You should only be demoing the real app
> https://www.mantua.ai/ not made up UIs

## Refined prompt

Produce a ~50 s, 1280×720 product spot that follows the reference's beat
sheet, **recorded from the real Mantua client** with the repo's demo
pipeline (`client/e2e/demo/`: shimmed auth, scripted API, the agent stream
served frame by frame). One continuous take: the board → the Sports Agent
panel → the **Daily Brief** chip and the card it renders → an instruction
typed into the dock → the agent's analysis and the **Preview** card →
the **Confirm trade** press → the execution card with its transaction.
Replace the presenter beats with text spots on the supplied nebula art
(chapter cards: Daily Brief · Automated trading · Policy-capped risk).
Close on "Find Your Edge" then "only at Mantua.AI" with the wordmark. No
UI that is not the product's own; the closing card labels the figures
illustrative.

## Why the refined prompt is better

- It pins "real app" to a concrete mechanism the repo already uses for its
  landing-page demo, so every frame is the shipped UI and the cut is
  reproducible in CI-like conditions.
- It maps the owner's three asks (brief, user flow, automated process) to
  product surfaces that exist (A-014 card, A-043 flow, D-114 gate).
- It makes "replicate" testable: each reference beat maps to a take segment
  or a text spot.
