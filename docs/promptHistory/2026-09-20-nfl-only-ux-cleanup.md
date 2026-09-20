# 2026-09-20 — NFL-only UX cleanup (owner correction)

**Branch:** `claude/nfl-only-ux-cleanup`

## Owner's instruction (verbatim)

> THIS IS NOT RIGHT and your messing up the UX!!!
> There is no trading (Swaps or Liquidity pools)
> We are only covering NFL games, which are not showing the current matchups,
> Remove the suggestions from the bottom left on top of the chatbot and fix the Agent suggestions

> And move the footer to the bottom, why is it above the chatbot!

## What was wrong

`origin/main` after Phase 19 still carried the surfaces the 2026-09-16 scope cut removed
on paper: a **Trading** nav item (swap + liquidity + pool list), the Swap / Liquidity
home cards, the dock's quick-action chips (Trade / Analyze / Swap / Add liquidity /
Portfolio), agent chips for Swap Tokens / Add Liquidity / Send Tokens, and a nav that
listed WNBA, NBA, MLB, NHL and Soccer beside NFL. The home footer rendered inside the
scrolling board, above the chat dock. Locally the NFL board was empty because the
canonical store is fed only by the Vercel cron, and it had not run in 27 days.

## What changed

### Client

- `features/markets/sports.ts` — the catalog is NFL only. `SportId` keeps the provider
  slugs; `isSportId` accepts only a listed league. Nav, sport chips, board, launch route
  and discovery all derive from it.
- `components/shell/MarketNav.tsx` — Trading removed; NFL · Combos · Agent.
- `components/shell/HomeMenu.tsx` — two cards (agent, analyst); swap and liquidity gone.
- `components/shell/QuickActions.tsx`, `lib/quick-actions.ts` — deleted (T-016 chips).
- `components/shell/AppShell.tsx` — a `footer` slot rendered **below** the dock; when
  present the document scrolls, the dock is `sticky bottom-0`, the footer follows.
- `App.tsx` — swap / trading / pools / pool / add-liquidity / positions routes and the
  hook-vs-agent intent split removed; the analyze route carries only a question; the
  footer moves from `HomeFullPage` into the shell slot; the board is one full-width column.
- `lib/chat-intent.ts` — swap / bridge / liquidity / send / crypto-topic intents removed;
  NFL is the only league word. Test rewritten.
- `features/agent/CircleAgentChat.tsx` — greeting and chips are sports-only.
- `features/analyze/AnalyzePanel.tsx` — stablecoin suggestion cards replaced by NFL ones.
- `features/swap`, `features/liquidity`, `features/bridge` — deleted, with the portfolio
  pieces that only served them (LP positions tab, LP economics, earnings, unified balance,
  auto-rebalance toggle, on-chain LP reader). `error-mapping.ts` (shared by the ticket)
  moved to `features/markets`; `TokenIcon` moved to `features/portfolio`.
- `components/docs/docs-content.tsx` — rewritten for the product that exists.

### Server

- Every covered-league list is `["nfl"]` (slate, live stream, crons, discovery,
  strategies, x402, policy, combo season, both providers, agent and research chat).
- `routes/platform-status.ts` — the status banner only judges covered leagues, so the
  WNBA rows left in the canonical tables no longer degrade the platform.
- `lib/agent-chat.ts` — `OUT_OF_SCOPE_TOOLS` filters swap, signals, FX, standing intents,
  liquidity, bridge, gateway, crypto market data, DefiLlama and explorer reads out of the
  model's tool list; the system prompt is a sports-market analyst's. Handlers stay for the
  audit trail.

## Verification

- `npm run typecheck`, `npm run lint`: green in both workspaces.
- Client unit: 273/273. Server unit: 1255/1256 — the one failure is the pre-existing
  secret scan hit on the developer's local, git-ignored `server/.env`.
- `e2e/mobile/switch.spec.ts` (production build): 4/4.
- Local: today's NFL slate ingested with the live-sync slate slice (16 games); the board
  shows 13 games for 2026-09-20 and the status banner clears.

## Left as is (follow-ups)

- Server routes and libraries for swap, liquidity, bridge and the gateway still exist
  (`routes/swap.ts`, `routes/agent-swap.ts`, `lib/agent-liquidity.ts`, …). They are
  unreachable from the UI and hidden from the agent; deleting them is a separate task.
- `docs/architecture.md` and the task list still describe WNBA as a launch league.

---

## Follow-up (same day): logos, the league sub-header, one chatbot, the agent's name

### Owner's instruction (verbatim)

> It should display real team logos and league logos
> In the header create a sub header it should list: NFL , All other sports when selected should say coming soon , NBA, WNBA, MLB, MLH, NCAAF, NCAAB, More Sports (Coming soon)
> In the header When the support button is selected it should show the suggestion cards but their is only one chatbot, remove the chatbot within the suggestion cards
>
> Your Circle Agent is now Your Sports Agent
> Hi, I'm your Mantua sport agent (Circle Wallet). Tell me what to do in plain language and I'll handle it: …

("MLH" read as NHL.)

### What changed

- **Team logos.** The ESPN slate carries each team's logo, but the canonical store only
  persisted teams through the Sportradar reference-data pass, so the `teams` table was
  empty and the board fell back to abbreviations. `upsertEvents` now upserts both teams
  (name, abbreviation, logo) on every slate tick and links `home_team_id` / `away_team_id`;
  `readCanonicalSlateRange` joins them and `canonicalToPublicSlate` serves `logo` (https
  only). No migration: the columns existed.
- **League logos.** `Sport.logo` (ESPN CDN league marks; the NCAA mark for NCAAF/NCAAB)
  with `LeagueLogo` falling back to the line glyph on load failure. Used by the league
  bar, the sport chips, the board card, the league page title and the coming-soon page.
- **League sub-header.** `LeagueBar` under the header on `md`+: NFL, NBA, WNBA, MLB, NHL,
  NCAAF, NCAAB, More Sports (Coming soon). Every entry is selectable; the six `soon`
  leagues open `ComingSoon`, and More Sports opens it as `sport="more"` (new
  `coming-soon` route). The main row keeps Combos · Agent. Below `md` the hamburger sheet
  lists the same leagues, and the league page chips are now selectable for `soon` leagues
  too.
- **One chatbot.** `SupportPanel` lost its own composer; the dock forwards input as
  `mantua:support-input` while the support route is open, with a support placeholder. The
  suggestion cards stay.
- **The agent's name.** Panel title "Your Sports Agent"; the greeting is the owner's text
  verbatim; the home card reads "Create / Manage Sports Agent".

### Verification

Typecheck, lint, client unit (273), server unit (1255/1256 — the pre-existing local `.env`
secret-scan hit), mobile `switch.spec.ts` (4/4, now clicks NBA → "NBA — coming soon").
Local: re-ingested the NFL slate; 32 teams persisted with logos and the slate serves them.

### Owner's follow-up: the sports list

> Put a basketball next to NCAAB, put a football next to NCAAF, remove more sports and add
> these sports with their logos UFC, Boxing (boxing gloves logo), Karate Kombat, Nascar, Golf

- NCAAF and NCAAB use the football and basketball glyphs as their marks (`Sport.logo` is
  now optional; `LeagueLogo` renders the glyph when there is no image).
- "More Sports" is gone, with its `coming-soon` route and the `more-sports` nav kind.
- Added, all `soon`: UFC (the UFC logo from the CDN), Boxing (a boxing-gloves glyph — the
  CDN's boxing mark is a black silhouette that vanishes on the dark theme), Karate Combat
  (a "KC" roundel; the promotion has no mark on the CDN), NASCAR and Golf (the CDN's
  racing and golf marks). Twelve sports in the bar and the chips.
