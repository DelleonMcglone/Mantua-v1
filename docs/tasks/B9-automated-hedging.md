# Phase B9 — Automated Hedging

> Master: `docs/tasks/sports-pivot.md` — PHASE B9 (W4, 🟠 P1)
> Snapshot: 2026-09-05 · 7 ✅ · 1 ⬜

## Success Criteria

- [ ] The strategy schema carries trigger, action, size, cap, expiry, and kill condition, matching the B1 `hedge_strategies` table (B9-001)
- [ ] Take-profit / stop closes a position when implied probability crosses a threshold — thresholds speak the YES side's probability in one vocabulary (B9-002)
- [ ] Delta hedge keeps net exposure across correlated markets within a user-set band (B9-003)
- [ ] Natural language parses to a strategy config with a structured preview before arming; prose never arms (B9-004)
- [ ] The execution engine evaluates on price and game-state ticks and executes inside the agent wallet's policy caps (B9-005)
- [ ] The dashboard shows armed / triggered / executed / expired with a full audit trail — every transition writes a `mantua_audit_log` row (B9-006)
- [ ] Kill switch exists per strategy and globally (`STRATEGIES_KILL_SWITCH`); strategies auto-disarm on market freeze (B9-007)
- [ ] Market-maker mode with inventory skew stays deferred P3 (B9-008)

## Failure Conditions

- A strategy executes outside its cap, after expiry, or past its kill condition
- A strategy fires on the tick the market freezes — disarm must win the race, proven by test (B9-007)
- Prose alone arms a strategy without the structured confirm (B9-004)
- The parser guesses a number it could not parse instead of returning null (B9-004)
- An unknown exposure is hedged anyway — a partial picture can double exposure (B9-003)
- A disarm or execution lacks its audit row

## Edge Cases

- User-wallet positions trigger + record and wait for the user's click; only agent-wallet positions execute under the cap (B9-005)
- Unparseable stored config auto-disarms rather than executing on garbage (B9-007)
- Expiry and kill conditions live in the schema itself, so a stale strategy cannot persist past its window (B9-001)
- Rebalance sizing is clamped by the strategy cap, not by the gap to target (B9-003)
- B9-008 stays ⬜ P3 — a shipped inventory-skew mode would contradict the master's deferral

## Checklist

- [x] B9-001 — Strategy schema: trigger, action, size, cap, expiry, kill condition
- [x] B9-002 — Strategy 1 — take-profit / stop: close a position when implied probability crosses a threshold
- [x] B9-003 — Strategy 2 — delta hedge: keep net exposure across correlated markets within a user-set band
- [x] B9-004 — Natural-language → strategy config, with structured preview before arming
- [x] B9-005 — Execution engine: evaluate on price and game-state ticks, execute inside the agent wallet's policy caps — `docs/tasks/035-b9-execution-engine.md`: pool-price ticks overlaid onto the slate's game-state ticks (`strategy-engine.ts`), atomic armed→triggered claim before execution (no double-execute across overlapping crons), strategy `capUsd` + wallet daily cap both bind with C-015 receipt before `executed`, retryable holds released / failures bounded (`execute_attempts`, max 3 → auto-disarm); proven in `strategy-engine.test.ts`, `strategies.test.ts`, `strategy-execute.test.ts`
- [x] B9-006 — Strategy dashboard: armed / triggered / executed / expired, full audit trail
- [x] B9-007 — Kill switch per strategy and globally; strategies auto-disarm on market freeze
- [ ] B9-008 — Market-maker mode with inventory skew ⬜
