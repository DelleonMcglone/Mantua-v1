# Phase B5 — Landing, Board & Chat

> Master: `docs/tasks/sports-pivot.md` — PHASE B5 (W3, 🔴 P0)
> Snapshot: 2026-09-03 · 10 ✅

## Success Criteria

- [ ] The landing page stays as the public marketing surface; home behind it is the Polymarket-style board scoped to covered sports only (B5-001, DM-105)
- [ ] Header sport buttons route to that sport's live page with the current slate (B5-002)
- [ ] Sport pages render matchup cards with team marks, start time, live status, and implied odds per outcome (B5-003)
- [ ] Clicking a matchup seeds the analyst view inline, readable logged out (B5-004)
- [ ] The chat dock persists at the page bottom on every route (B5-005)
- [ ] Analysis renders in the right column beside the board, above the dock, with scroll anchors landing new output in view — the deliberate two-column deviation from the single-column Polymarket layout (B5-006)
- [ ] Auth gating per the owner's 2026-08-18 revision: browsing and matchup details public; chatbot input AND trading gated client + server (B5-007)
- [ ] Logged-out chat is rate-limited (wallet limiter falls back to IP) with global abuse controls (B5-008)
- [ ] Each covered sport has an off-season empty state distinct from the error state, plus a delayed-data banner on degraded slates (B5-009)
- [ ] The shell stacks below 1024px and the board is verified at ~700px viewport (B5-010)

## Failure Conditions

- An unauthenticated visitor can submit chat or open a position — either client-side or server-side
- Analysis renders off-column, or new output jumps the board out of view
- An off-season slate renders the error state instead of the empty state
- A non-covered league (NBA/MLB/NHL/Soccer) renders live markets instead of "Coming soon" (DM-105)
- `/api/analyze/chat` loses its wallet/IP rate limiter or the global `ipRateLimiter`
- The landing page is removed or the board replaces it as the public surface (B5-001 keeps the landing)

## Edge Cases

- The covered set is NFL and WNBA only; the other four leagues stay in the nav with a `Soon` chip routing to coming-soon states (DM-105)
- Pre-game cards hide scores; Live/Final/Postponed chips carry game state (B5-003)
- The two-column shell is a recorded deviation from the single-column Polymarket layout — collapsing it back to one column is a change to review, not a fix (B5-006)
- Logged-out rate limiting keys on IP when no wallet exists (B5-008)

## Checklist

- [x] B5-001 — Landing page stays; behind it, home is the Polymarket-style board scoped to covered sports only
- [x] B5-002 — Header sport buttons route to that sport's live page with the current slate
- [x] B5-003 — Sport page: matchup cards with team marks, start time, live status, implied odds per outcome
- [x] B5-004 — Matchup click → analyst view renders inline; readable logged out
- [x] B5-005 — Chat dock persistent at page bottom
- [x] B5-006 — Output placement: analysis renders in the right column beside the board, above the dock, scroll-anchored
- [x] B5-007 — Auth gating (revised 2026-08-18): browse + matchup details public; chatbot input AND trading require login
- [x] B5-008 — Rate limiting + abuse controls on logged-out chat
- [x] B5-009 — Empty / off-season state per sport, distinct from the error state
- [x] B5-010 — Mobile layout for board + chat dock
