# Circle Sports Agent — product demo video

A Mantua take on the Public.com "Agents" spot, recorded from the **real
client**: the board, the Sports Agent panel, the Daily Brief chip and card,
an instruction typed into the dock, the trade preview and the Confirm
press, then the execution card with its transaction. Only the agent's
stream is scripted (`turns.ts`, served frame by frame); every pixel is the
app's own UI. The text spots between sections sit on the owner's nebula art
(`nebula-bg.jpg`) and the spot closes on **Find Your Edge → only at
Mantua.AI**.

```bash
# 1. the shimmed dev server (same as the e2e suite), from client/
VITE_E2E_AUTH=shim VITE_PRIVY_APP_ID=e2e-shim npx vite --port 5173 --strictPort
# 2. the take (one continuous recording; serves the scripted stream on :3001)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx tsx e2e/demo/circle-agent/record.ts
# 3. the text spots, then the cut (ffmpeg on PATH or FFMPEG set)
python3 e2e/demo/circle-agent/cards.py && python3 e2e/demo/circle-agent/assemble.py
```

Output: `out/mantua-circle-agent-demo.mp4` (1280×720, 30 fps, ~52 s,
silent). `out/` is git-ignored.

| File          | Role                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| `data.ts`     | The tool results the real cards render: Daily Brief, analysis, preview, execution |
| `turns.ts`    | The three turns in the agent stream's wire format, with their pauses              |
| `record.ts`   | Playwright take of the real client with a visible pointer; writes the cut points  |
| `cards.py`    | The nebula text spots: opener, three chapter cards, "Find Your Edge", the close   |
| `assemble.py` | Cards and the take's segments, crossfaded, into the MP4                           |

The featured game is the suite's fixture matchup (Chiefs at Raiders, kickoff
today) so the board and the brief agree; the figures are authored for the
demo and the closing card says so.
