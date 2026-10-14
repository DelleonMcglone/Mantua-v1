# Task 077 — Circle Sports Agent demo video (marketing)

> Owner request 2026-10-14: replicate the Public.com "Agents" product spot
> as a Mantua version that demos the automated process with the Circle
> Sports Agent — the Daily Brief and the user flow into the automated
> process — with the supplied nebula art behind the text spots and the
> closing line **Find Your Edge, only at Mantua.AI**.

**Branch:** `claude/gracious-brown-8wm5k7` (the session's designated branch;
the task number is carried here rather than in the branch name).
**Prompt history:** `docs/promptHistory/2026-10-14-circle-agent-demo-video.md`
**Deliverable:** `docs/marketing/circle-agent-demo/` (generator) →
`out/mantua-circle-agent-demo.mp4` (rendered, git-ignored).

## Task description

The reference is a 34 s screen-recorded spot: presenter → portfolio app →
an agent created from one chat prompt → a numbered workflow → "Activate your
Agent" → a live agent card → three category cards on dark art → a second
prompt → closing lines and logo. Mantua has no presenter footage, so the
presenter beats become text spots on the owner's art and the rest is a
faithful re-cut around the product's real agent surface:

1. The **Daily Brief** chip in "Your Sports Agent" and the Daily Brief card
   it renders (A-014: wallet, positions, track record, policy, markets).
2. The **user flow into automation**: a standing instruction typed into the
   Ask bar becomes a recurring workflow (trigger → brief → analyze → act
   within the per-trade cap) and is activated with one press.
3. The **automated process**: a Sunday 9:00 AM run streams the A-043 tool
   steps (brief → analyze → simulate → execute) and places the trade under
   policy.

Built as a deterministic HTML motion page rendered frame by frame (Playwright
→ ffmpeg) rather than a screen recording, so every cut, cursor move and typed
character is reproducible and the copy is editable in one file.

## Success criteria

- [x] Same beat structure as the reference (app demo → create agent → activate → live card → category cards → closing)
- [x] Demos the Daily Brief with the product's own card rows and tool-step verbs
- [x] Shows the user flow from a plain-language instruction to an activated recurring agent
- [x] Shows the automated run end to end, including the policy cap and the transaction
- [x] Text spots use the supplied nebula background
- [x] Ends on "Find Your Edge" → "only at Mantua.AI"
- [x] Brand-faithful: dark tokens from `tokens.css`, Inter, the app's logo mark, the agent teal
- [x] Reproducible render from the repo with one command; copy and timing live in `js/timeline.js`
- [x] Every source file ≤ 150 lines; Prettier-formatted; typed lint scoped away from the plain-JS page
- [x] Disclaimer footer on every in-app frame (illustrative numbers, not advice)

## Failure conditions

- A frame that misrepresents the product (money moving without a policy or
  preview step; a feature Mantua does not have).
- Copy or timing changes that require editing scene code rather than the
  storyboard.
- A render that differs between runs (non-deterministic animation).

## Edge cases handled

- Module scripts need an origin: the renderer serves the folder over
  loopback HTTP instead of `file://`.
- Playwright's browser download may be unavailable: `MANTUA_DEMO_CHROMIUM`
  points the renderer at a preinstalled Chromium.
- The art is portrait (843×1264): scenes pan it (background-position) so
  the embedded logo is never half-cropped and the closing lands on the
  city horizon.
- The chat column overflows as the conversation grows: the create scene
  anchors to the bottom like the real chat's scroll-into-view, and earlier
  turns fade out as the workflow appears.
- Narration must finish before a cut: typing speeds are derived from the
  copy length (`typeDuration`) and checked against the scene end.

## Implementation checklist

- [x] Extract the reference's beats (1 fps contact sheets + key frames)
- [x] Storyboard (`js/timeline.js`) with absolute times and all copy
- [x] Stage, tokens and the art/chapter/outro stylesheets
- [x] Shell (top bar, Sports Agent panel, wallet strip, Ask bar, footer)
- [x] Brief, create, live and run scenes
- [x] Engine with crossfades and `window.seek(t)`; real-time preview fallback
- [x] Renderer: loopback server + Playwright frame capture → ffmpeg (libx264, crf 18, faststart)
- [x] Stills reviewed at every beat; full render reviewed on a contact sheet
- [x] `README.md` with render steps, layout, beat sheet and a voiceover script
- [x] `eslint.config.js` ignore for `docs/marketing/**`; Prettier pass; lint + format:check green
- [x] Architecture layout updated with `docs/marketing/`

## Review notes

The owner's process asks for an o3 pre-implementation review and a Gemini
code review through the `llm` CLI; neither CLI is installed in this
environment, so the review was a self-review against the reference frames
and the product code the demo mirrors. Flagged for the owner: the video is
silent — the voiceover script in the README can be recorded or synthesized
(the session's Descript connector can add an AI voice) if a voice track is
wanted.
