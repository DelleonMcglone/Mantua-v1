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

## Refined prompt

Produce a ~45 s, 1280×720 product spot that follows the reference's beat
sheet — app demo → agent created from one chat prompt → numbered workflow →
"Activate your Agent" → live agent card → category text cards → closing —
re-cut around Mantua's Circle Sports Agent. Replace the presenter beats
with text spots on the supplied nebula art. Scene 1 demos the **Daily
Brief** exactly as the product renders it (chip → "Assembling the brief" →
the Daily Brief card rows → the agent's narration). Scene 2 is the **user
flow into automation**: a standing instruction typed into the Ask bar
becomes a recurring workflow under the user's policy cap and is activated.
Scene 3 is the **automated process**: a scheduled run streaming the real
tool steps (brief → analyze → simulate → execute) and placing the trade.
Chapter cards name Daily Brief, Automated trading and Policy-capped risk.
Close on "Find Your Edge" then "only at Mantua.AI" with the wordmark.

Build it as a deterministic HTML motion page in the repo, rendered frame by
frame with Playwright and ffmpeg, so the copy and timing are editable in one
storyboard file and the render is reproducible. Use the dark design tokens,
Inter and the app's logo mark; keep a disclaimer footer on in-app frames.

## Why the refined prompt is better

- It pins the three things the owner asked to see (brief, user flow,
  automated process) to concrete product surfaces that exist in the code,
  so nothing on screen misrepresents Mantua.
- It makes "replicate" testable: the beat sheet is enumerated, so each
  reference beat maps to a Mantua beat.
- It chooses a reproducible build over a screen recording, which keeps the
  asset editable and reviewable in a PR.
