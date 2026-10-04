# Landing-page demo video

Reproduces `public/assets/demo.mp4` (and its poster) from the real client UI.

```bash
# 1. the shimmed dev server (same as the e2e suite)
VITE_E2E_AUTH=shim VITE_PRIVY_APP_ID=e2e-shim npx vite --port 5173 --strictPort
# 2. record the three turns (serves the scripted agent stream on :3001)
npx tsx e2e/demo/record.ts
# 3. cards, then the cut (needs ffmpeg/ffprobe on PATH or FFMPEG/FFPROBE set)
python3 e2e/demo/cards.py && python3 e2e/demo/assemble.py
```

The turns live in `turns.ts`: the real Week 5 slate, authored analysis,
labelled illustrative on the closing card.
