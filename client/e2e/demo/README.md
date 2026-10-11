# Walkthrough demo video

A ≤ 60 s cut of the real client UI, in three shots: today's games board,
the non-transactional prompt (the analyst, no trade), and the create /
manage agent flow. Output: `e2e/demo/out/demo.mp4` (silent, 1280×720).

```bash
# 0. today's real games — fetch once, from a machine that can reach ESPN
curl -sS "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261011" \
  -o e2e/demo/espn-20261011.json
# 1. the shimmed dev server (same as the e2e suite)
VITE_E2E_AUTH=shim VITE_PRIVY_APP_ID=e2e-shim npx vite --port 5173 --strictPort
# 2. the three shots (serves the scripted chat streams on :3001)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx tsx e2e/demo/record.ts   # or: board | analyze | agent
# 3. cards, then the cut (needs ffmpeg/ffprobe on PATH or FFMPEG/FFPROBE set; aborts over 60 s)
python3 e2e/demo/cards.py && python3 e2e/demo/assemble.py
```

How it stays accurate: `snapshot.ts` converts the ESPN file into the slate
the board renders (statuses, scores, records, the posted lines), the
browser's clock is pinned inside that snapshot's day (`clock.ts`), and the
analyst's answer (`turns-analyze.ts`) is generated from the same events.
Without the file the recorder falls back to `week5Slate()` — the schedule
as fetched on 2026-10-04, every game scheduled, no scores — and says so.
The agent wallet, policy and armed strategy are scripted (`mocks.ts`,
`mocks-strategies.ts`) and labelled illustrative on the closing card.
