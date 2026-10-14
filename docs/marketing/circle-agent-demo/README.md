# Circle Sports Agent — product demo video

A Mantua take on the Public.com "Agents" spot: the same beat sheet (app
demo → create an agent in plain language → activate → the agent runs on its
own → chapter cards → closing), re-cut around the **Circle Sports Agent**:
the Daily Brief, the user's standing instruction, and the autonomous run
that follows from it. The "text spots" sit on the owner-supplied nebula art
(`assets/nebula-bg.jpg`); the closing text is **Find Your Edge — only at
Mantua.AI**.

Output: `out/mantua-circle-agent-demo.mp4` — 1280×720, 30 fps, 47 s, silent
(see the voiceover script below if a voice track is wanted).

## Render

```bash
# from this folder; needs node >= 20, ffmpeg on PATH and playwright
node render.mjs                 # full render → out/mantua-circle-agent-demo.mp4
node render.mjs --still 21      # one PNG frame at t = 21 s → out/still-21.png
MANTUA_DEMO_CHROMIUM=/opt/pw-browsers/chromium node render.mjs   # reuse a preinstalled Chromium
```

Playwright resolves from this folder, the repo root or the global
`node_modules`. The page is deterministic: every frame is drawn from an
absolute time by `window.seek(t)`, so the same storyboard renders the same
file every run.

Preview in a browser: `npx http-server .` then open `index.html`; without the
renderer the page plays back in real time and loops.

## Layout

| Path                  | Role                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `index.html`          | Stage + cursor; loads the stylesheets and `js/engine.js`                      |
| `js/timeline.js`      | **The storyboard**: scene order, absolute start/end times, all on-screen copy |
| `js/engine.js`        | Mounts scenes, crossfades them, exposes `window.seek(t)`                      |
| `js/util.js`          | Pure timing helpers (`tween`, `typed`, `reveal`, easing)                      |
| `js/scenes/art.js`    | Nebula text spots: opening title, chapter cards, outro wordmark               |
| `js/scenes/shell.js`  | The Mantua shell (top bar, Sports Agent panel, Ask bar) and card atoms        |
| `js/scenes/brief.js`  | Daily Brief chip → tool step → Daily Brief card → narration                   |
| `js/scenes/create.js` | Standing instruction typed → recurring workflow → "Activate your Agent"       |
| `js/scenes/live.js`   | The live agent card ("Live · Currently running")                              |
| `js/scenes/run.js`    | Sunday 9:00 AM autonomous run: brief → analyze → simulate → place             |
| `css/*.css`           | Tokens mirror `client/src/styles/tokens.css` (dark theme)                     |
| `render.mjs`          | Playwright frame capture piped into ffmpeg (libx264, crf 18)                  |
| `assets/`             | `nebula-bg.jpg` (owner art), `mantua-mark.svg` (copy of the app logo)         |

To change copy or timing, edit `js/timeline.js` only; the scene builders
read everything from it.

## Beat sheet

| t (s)       | Scene   | What the viewer sees                                                                                                                                                                                                                                                        |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 – 3.4     | title   | Nebula art · "Introducing — Your Circle Sports Agent — A daily brief, an edge, and an agent that acts on it."                                                                                                                                                               |
| 3 – 13      | brief   | The Sports Agent panel; cursor clicks **Daily Brief**; "Assembling the brief" → the Daily Brief card (wallet, positions, track record, policy, markets worth a look) → the agent narrates the KC vs BUF edge                                                                |
| 12.6 – 23   | create  | Ask bar: "Every Sunday at 9 AM, run my brief and take $10 YES on any game where the edge is 5+ points" → "I can set this up as a recurring workflow that runs under your policy caps." → **Edge Hunter: NFL Sundays**, steps 1–4 → cursor presses **Activate your Agent →** |
| 22.8 – 26.6 | live    | Agent card on an aurora wash: Edge Hunter · Trading Strategy · **Live · Currently running**                                                                                                                                                                                 |
| 26 – 32.4   | chapter | Three text spots on the art: `< Daily Brief >`, `< Automated trading >`, `< Policy-capped risk >`                                                                                                                                                                           |
| 32 – 40.4   | run     | **AUTONOMOUS RUN · Sun 9:00 AM ET**: Assembling the brief ✓ → Analyzing the matchup ✓ (+6.0 pts) → Simulating the trade ✓ (policy ok) → Placing the trade ✓ → "Trade placed under your policy" with the tx                                                                  |
| 40 – 43.2   | title   | "Find Your **Edge**"                                                                                                                                                                                                                                                        |
| 42.8 – 47   | outro   | "only at" + the Mantua.AI wordmark · "Agent-native prediction markets for sports"                                                                                                                                                                                           |

The in-app copy is the product's own: the chips, the Daily Brief rows and
the tool-step verbs come from `client/src/features/agent/CircleAgentChat.tsx`
and `agent-cards.ts`; the run follows the A-043 flow (brief → analyze →
simulate → execute) and the per-trade cap is the D-109 policy. Numbers are
illustrative and the footer says so.

## Voiceover script (optional, ~45 s)

> Meet your Circle Sports Agent. Every morning it hands you a brief: your
> wallet, your positions, your record, and the games where the price and
> the evidence disagree.
>
> Tell it what to do in plain language. "Every Sunday at nine, run my brief
> and take ten dollars of YES wherever the edge is five points or more."
> It becomes a workflow, it runs under the caps you set, and you activate it
> with one press.
>
> Then it works. Sunday, nine a.m.: the brief, the analysis, the simulation
> against your policy, and the trade — settled in USDC on Arc, gas sponsored.
>
> Find your edge. Only at Mantua.AI.
