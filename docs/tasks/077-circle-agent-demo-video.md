# Task 077 — Circle Sports Agent demo video (marketing)

> Owner request 2026-10-14: replicate the Public.com "Agents" product spot
> as a Mantua version that demos the automated process with the Circle
> Sports Agent — the Daily Brief and the user flow into the automated
> process — with the supplied nebula art behind the text spots and the
> closing line **Find Your Edge, only at Mantua.AI**. Owner correction the
> same day: demo **the real app only**, no reconstructed UI.

**Branch:** `claude/gracious-brown-8wm5k7` (the session's designated branch;
the task number is carried here rather than in the branch name).
**Prompt history:** `docs/promptHistory/2026-10-14-circle-agent-demo-video.md`
**Deliverable:** `client/e2e/demo/circle-agent/` (recorder + cut) →
`out/mantua-circle-agent-demo.mp4` (rendered, git-ignored).

## Task description

The reference is a 34 s screen-recorded spot: presenter → portfolio app →
an agent created from one chat prompt → a workflow → activation → a live
agent card → category cards on dark art → closing lines and logo. The
Mantua version is recorded from the real client the way the landing-page
demo was (`client/e2e/demo/`, 2026-10-04): the shimmed dev server, the
suite's scripted API, and the agent stream served frame by frame so the
words arrive the way a model's do. One continuous take:

1. The board → **Create / Manage Sports Agent** → the Sports Agent panel.
2. The **Daily Brief** chip → "Assembling the brief" → the Daily Brief card
   (A-014) → the agent names the edge.
3. The instruction typed into the dock ("Take $10 of YES on the Chiefs if
   the edge holds. Preview it first.") → the analysis source pill → the
   **Preview** card with its **Confirm trade** button (A-043, D-114).
4. The Confirm press → "Placing the trade" → the execution card with the
   transaction and Explorer link.

Text spots on the owner's art cut between the sections (Daily Brief ·
Automated trading · Policy-capped risk), then "Find Your Edge" and the
close with the wordmark and "only at Mantua.AI".

A first cut built as a reconstructed motion page was rejected by the owner
("only the real app, not made-up UIs") and removed in the same PR.

## Success criteria

- [x] Every in-app frame is the real client (the components deployed at mantua.ai), not a mock-up
- [x] Same beat structure as the reference (app → instruction → preview → confirm → executed → category cards → closing)
- [x] Demos the Daily Brief chip and the card it renders
- [x] Shows the user flow from a plain-language instruction to the agent's automated analysis, sizing, preview and execution under the policy cap
- [x] Text spots use the supplied nebula background
- [x] Ends on "Find Your Edge" → "only at Mantua.AI"
- [x] Reproducible from the repo with the documented three commands; every source file ≤ 150 lines; typecheck, lint and Prettier green
- [x] The closing card labels the figures illustrative

## Failure conditions

- Any frame that is not the product's own UI, or that shows money moving
  without the preview → confirm gate.
- A stream frame the real cards cannot render (the data types are the
  client's own, so the typecheck catches a drift).

## Edge cases handled

- The Daily Brief chip sits below the fold of the panel: the pointer
  helper scrolls a target into view before measuring and pressing it.
- A headless recording has no pointer: a small overlay follows the real
  mouse events so clicks read on screen.
- Kickoff times render in the viewer's zone: the context is pinned to
  America/New_York and the brief's kickoff is the board fixture's own.
- The live site is not reachable from the sandbox's network policy and the
  agent needs a signed-in Circle wallet: the recording uses the suite's
  auth shim and scripted API, as the landing-page demo did.

## Implementation checklist

- [x] Extract the reference's beats (contact sheets + key frames)
- [x] `data.ts` — typed tool results for the real cards
- [x] `turns.ts` — the three turns in the stream's wire format (helpers exported from `e2e/demo/turns.ts`)
- [x] `record.ts` — one continuous take with cut points and a visible pointer
- [x] `cards.py` — nebula text spots in Inter
- [x] `assemble.py` — the cut with crossfades
- [x] Take reviewed frame by frame; final cut reviewed on a contact sheet
- [x] README with the three commands and the file roles
- [x] Reconstructed-UI generator removed; lint ignore and layout entry reverted

## Review notes

The owner's process asks for an o3 pre-implementation review and a Gemini
code review through the `llm` CLI; neither CLI is installed in this
environment, so the review was a self-review against the reference frames
and the product code the demo drives. The video is silent; a voiceover
script is in the README of the previous cut's PR description if a voice
track is wanted.
