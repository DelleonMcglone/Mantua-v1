/**
 * Pure intent matcher for the chat input. Lives in its own module so
 * it's importable from a Node-side test runner without pulling React.
 *
 * Maps free-form chat input to a `Route` value. Returns `null` when
 * nothing matches — the caller (`App.tsx`'s `handleChatCommand`) can
 * then fall back to the generic "drop into the analyze panel with
 * the question echoed" path.
 *
 * Pattern order matters: more specific topic checks first, then
 * generic openers, then verb-driven nav (swap / liquidity / positions),
 * then bare-keyword nav. Each branch documents the test phrases it's
 * meant to cover.
 */
import type { TokenSymbol } from "./tokens.ts";
import type { FeeTier } from "../features/liquidity/fee-tiers.ts";
import type { HookName } from "../features/liquidity/use-create-pool.ts";
import { matchBridgeDestination } from "../features/bridge/bridge-chains.ts";

export type AnalyzeTopic =
  | "eth-price"
  | "eurc-peg"
  | "usdc-eurc-pool"
  | "top-stablecoins"
  | "cbbtc-24h-volume"
  | "mantua-hooks"
  | "token-price";

export interface PoolKeyCtx {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  hook?: HookName | null;
  /** Deposit amounts parsed from the command (e.g. "$10 USDC / $10 cbBTC"),
   *  used to pre-fill the add-liquidity form. Omitted when no number was
   *  written before the token. */
  amountA?: string;
  amountB?: string;
}

export type Intent =
  | {
      kind: "swap";
      tokenIn?: TokenSymbol;
      tokenOut?: TokenSymbol;
      hook?: HookName | null;
      amountIn?: string;
    }
  | { kind: "home" }
  | { kind: "pools" }
  | { kind: "add-liquidity"; ctx?: PoolKeyCtx }
  | { kind: "create-pool"; ctx?: PoolKeyCtx }
  | { kind: "remove-liquidity" }
  | { kind: "positions" }
  | { kind: "bridge"; amount?: string; destination?: string }
  | { kind: "send"; tokenIn?: TokenSymbol; to?: `0x${string}` }
  | { kind: "portfolio" }
  | { kind: "agent"; message?: string }
  /** B8-003 — league nav: "nfl markets", "show wnba games", bare "nfl". */
  | { kind: "market"; sport: SportLeague }
  /** B8-003 — position verbs: open / close / hedge a sports position.
   *  Execution is gated until markets deploy; the route lands on the
   *  league's market page, which states what's open honestly. */
  | { kind: "position"; action: "open" | "close" | "hedge"; sport?: SportLeague }
  | {
      kind: "analyze";
      topic?: AnalyzeTopic;
      question?: string;
      symbol?: string;
    };

/**
 * Duplicated string-literal union of `SportId` (features/markets/sports.ts).
 * Deliberately not imported as a value: this module must stay importable
 * from the Node test runner, and the sports catalog pulls in React icon
 * components. A type-only mirror keeps the boundary clean; TypeScript
 * checks the two unions against each other at the App.tsx seam.
 */
export type SportLeague = "nba" | "wnba" | "nfl" | "mlb" | "nhl" | "soccer";

const LEAGUE_WORDS: readonly SportLeague[] = ["nba", "wnba", "nfl", "mlb", "nhl", "soccer"];

/** First league named in the text, if any. WNBA is checked before NBA so
 *  the substring overlap can't misroute ("wnba" contains "nba"). */
export function extractLeague(text: string): SportLeague | null {
  const t = text.toLowerCase();
  for (const league of ["wnba", ...LEAGUE_WORDS.filter((l) => l !== "wnba")] as SportLeague[]) {
    if (new RegExp(`\\b${league}\\b`).test(t)) return league;
  }
  return null;
}

const WALLET_TOKEN_ALIASES: { sym: TokenSymbol; aliases: string[] }[] = [
  {
    sym: "cbBTC",
    aliases: ["cbbtc", "cbbct", "cb-btc", "cb-bct", "cbtc", "btc", "bitcoin"],
  },
  { sym: "EURC", aliases: ["eurc", "eucr"] },
  { sym: "USDC", aliases: ["usdc", "uscd"] },
];

export function extractWalletTokens(text: string): { sym: TokenSymbol; pos: number }[] {
  const t = text.toLowerCase();
  const claimed = new Array<boolean>(t.length).fill(false);
  const found: { sym: TokenSymbol; pos: number }[] = [];
  for (const entry of WALLET_TOKEN_ALIASES) {
    for (const alias of entry.aliases) {
      const re = new RegExp(`\\b${alias}\\b`, "g");
      let m;
      while ((m = re.exec(t)) !== null) {
        if (claimed[m.index]) continue;
        for (let i = m.index; i < m.index + alias.length; i++) claimed[i] = true;
        found.push({ sym: entry.sym, pos: m.index });
      }
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

export function extractAnalyzeSymbol(text: string): string | null {
  const t = text.toLowerCase();
  const candidates: { canonical: string; patterns: string[] }[] = [
    { canonical: "bitcoin", patterns: ["bitcoin", "btc"] },
    { canonical: "ethereum", patterns: ["ethereum", "eth", "eht"] },
    { canonical: "cbbtc", patterns: ["cbbtc", "cbbct", "cb-btc", "cb-bct"] },
    { canonical: "usdc", patterns: ["usdc", "uscd"] },
    { canonical: "usdt", patterns: ["usdt"] },
    { canonical: "eurc", patterns: ["eurc", "eucr"] },
    { canonical: "weth", patterns: ["weth"] },
    { canonical: "solana", patterns: ["solana", "sol"] },
    { canonical: "maker", patterns: ["maker", "mkr"] },
    { canonical: "pendle", patterns: ["pendle"] },
    { canonical: "ondo", patterns: ["ondo"] },
    { canonical: "centrifuge", patterns: ["centrifuge"] },
  ];
  for (const c of candidates) {
    for (const p of c.patterns) {
      const re = new RegExp(`\\b${p}\\b`);
      if (re.test(t)) return c.canonical;
    }
  }
  return null;
}

function isStable(s: TokenSymbol): boolean {
  return s === "USDC" || s === "EURC";
}

/** The numeric amount written immediately before a token in the text,
 *  e.g. "$10 USDC" or "100 usdc" → "10" / "100". Undefined when none. */
function amountBefore(text: string, pos: number): string | undefined {
  const m = /\$?\s*([\d,]+(?:\.\d+)?)\s*$/.exec(text.slice(0, pos));
  return m ? m[1].replace(/,/g, "") : undefined;
}

/** `{ amountA?, amountB? }` parsed from the numbers preceding each token. */
function amountsCtx(
  text: string,
  a: { pos: number },
  b: { pos: number },
): { amountA?: string; amountB?: string } {
  const amountA = amountBefore(text, a.pos);
  const amountB = amountBefore(text, b.pos);
  return {
    ...(amountA !== undefined ? { amountA } : {}),
    ...(amountB !== undefined ? { amountB } : {}),
  };
}

function detectHookKeyword(t: string): HookName | null {
  if (/\bdynamic[\s-]?fees?\b/.test(t)) return "dynamic-fee";
  if (/\bstable[\s-]?protection\b/.test(t)) return "stable-protection";
  return null;
}

/**
 * Did the user name a liquidity hook (Stable Protection / Dynamic Fee) or
 * explicitly ask for no hook? This is the manual-vs-agent switch: naming a hook
 * means the manual Uniswap-v4 flow; otherwise an action routes to the Circle
 * agent (no-hook pools).
 */
export function mentionsHook(text: string): boolean {
  const t = text.toLowerCase();
  if (detectHookKeyword(t) !== null) return true;
  return /\bno[\s-]?hook\b|\bwithout (a |an )?hook\b|\bhookless\b/.test(t);
}

/**
 * Extract a 0x EVM address from free-form text. Returns the first hit
 * (canonical-cased, not lowered) or `null`. Used by the `send` intent
 * matcher; rejects shorter hex strings since they're never valid EVM
 * recipients.
 */
export function extractEvmAddress(text: string): `0x${string}` | null {
  const m = /\b0x[a-fA-F0-9]{40}\b/.exec(text);
  return m ? (m[0] as `0x${string}`) : null;
}

/**
 * Action verbs whose presence signals the user wants to *do* something,
 * not ask about a topic. Used both by the pre-flight (verb + pair →
 * action) and to gate single-token analytic rules so prompts like
 * "Swap 100 USDC for EURC" aren't hijacked into the `usdc-eurc-pool`
 * analytic.
 *
 * Excludes `analyze`/`learn`/`tell`/`what`/`how`/`show` deliberately —
 * those are question framings the analytic rules need to keep matching.
 */
const ACTION_VERB_RE =
  /\b(swap|exchange|trade|convert|add|provide|deposit|create|make|place|cancel|send|transfer|remove)\b/;

export function detectIntent(text: string): Intent | null {
  const t = text.toLowerCase();

  // Bridge first — "bridge 10 USDC to Base" / "bridge USDC to base" /
  // "cross-chain transfer" opens the Swap panel on its Bridge venue,
  // pre-filling the amount + destination when present. Checked before swap
  // so the "to <chain>" phrasing isn't read as a swap pair.
  if (/\bbridge\b/.test(t) || /\bcross[- ]?chain\b/.test(t)) {
    const dest = matchBridgeDestination(text);
    // First decimal number in the command (e.g. "bridge 10.5 USDC …").
    const amountMatch = /(\d[\d,]*\.?\d*)/.exec(t);
    const amount = amountMatch ? amountMatch[1].replace(/,/g, "") : undefined;
    return {
      kind: "bridge",
      ...(amount ? { amount } : {}),
      ...(dest ? { destination: dest.sdkName } : {}),
    };
  }

  // Circle Agent (Circle) — wallet + autonomous management. Matched early,
  // before the preflight action block and the "show me …" analyze opener, so
  // "show me my agent wallet" / "have my agent swap …" route to the agent
  // instead of the swap/research paths. Requires an explicit "agent" reference
  // plus a management/possessive cue (or an "agent <wallet|balance|…>" noun) so
  // research mentions like "AI agents in DeFi" fall through.
  const agentRef = /\bagent\b/.test(t);
  const agentCue = /\b(my|create|manage|set[\s-]?up|provision|fund|open|show|view|check)\b/.test(t);
  const agentNoun =
    /\bagent'?s?\s+(wallet|balance|cap|caps|positions?|portfolio|status|address|funds?)\b/.test(t);
  if ((agentRef && agentCue) || agentNoun) {
    return { kind: "agent", message: text };
  }

  // ── Sports (B8-003) ────────────────────────────────────────────────────
  // Position verbs first: "bet on the Chiefs", "open a position on KC",
  // "close my position", "hedge my NFL exposure". Matched before league nav
  // so "close my wnba position" is a position command, not league browsing.
  const positionNoun = /\b(position|bet|wager|exposure|stake)\b/.test(t);
  if (positionNoun && /\b(close|exit|sell|unwind)\b/.test(t)) {
    const sport = extractLeague(text);
    return { kind: "position", action: "close", ...(sport ? { sport } : {}) };
  }
  if (positionNoun && /\bhedge\b/.test(t)) {
    const sport = extractLeague(text);
    return { kind: "position", action: "hedge", ...(sport ? { sport } : {}) };
  }
  if (
    (positionNoun && /\b(open|take|place|buy|put)\b/.test(t)) ||
    /\bbet\s+(on|against)\b/.test(t)
  ) {
    const sport = extractLeague(text);
    return { kind: "position", action: "open", ...(sport ? { sport } : {}) };
  }

  // League nav: a league name plus a browsing cue — or the bare league name —
  // opens that league's market page. Analysis phrasing falls through to the
  // research path instead ("analyze the NFL matchup…" belongs to the analyst).
  const league = extractLeague(text);
  if (league && !/\b(analy[sz]e|research|explain|why|how|compare)\b/.test(t)) {
    const browseCue =
      /\b(market|markets|game|games|matchup|matchups|odds|scores?|slate|schedule|open|show|view|go\s+to)\b/.test(
        t,
      );
    const bareNav = t.trim().split(/\s+/).length <= 3;
    if (browseCue || bareNav) return { kind: "market", sport: league };
  }

  // Pre-flight: when an action verb is paired with two recognized tokens,
  // short-circuit to the action intent *before* the analytic-topic rules
  // run. Without this, prompts like "Swap 100 USDC for EURC with stable
  // protection" get hijacked by the `eurc` + `stable` rule, and "Swap
  // USDC for EURC with rwa gate" by the `rwa` rule — incidental keyword
  // overlap that's a much weaker intent signal than the verb + pair.
  //
  // We require ≥2 tokens specifically so question-form prompts like
  // "Is EURC trading above or below its peg?" (one token + analytic verb)
  // still fall through to the eurc-peg matcher below.
  //
  // The add-liquidity branch also matches on `pool` as the noun (not just
  // `liquidity`/`lp`) so "Add 100 USDC and 85 EURC to the X pool" — a
  // very common phrasing in the corpus — routes correctly even without
  // the literal word "liquidity".
  const preflightTokens = extractWalletTokens(text);
  if (preflightTokens.length >= 2) {
    const preA = preflightTokens[0];
    const preB = preflightTokens[1];
    if (/\b(create|make)\b.*\bpool\b/.test(t)) {
      const fee: FeeTier = isStable(preA.sym) && isStable(preB.sym) ? 100 : 500;
      return {
        kind: "create-pool",
        ctx: {
          tokenA: preA.sym,
          tokenB: preB.sym,
          fee,
          hook: detectHookKeyword(t),
          ...amountsCtx(text, preA, preB),
        },
      };
    }
    if (/\b(add|provide|deposit).*(liquidity|lp|pool)\b/.test(t) || /^lp\b/.test(t)) {
      const fee: FeeTier = isStable(preA.sym) && isStable(preB.sym) ? 100 : 500;
      return {
        kind: "add-liquidity",
        ctx: {
          tokenA: preA.sym,
          tokenB: preB.sym,
          fee,
          hook: detectHookKeyword(t),
          ...amountsCtx(text, preA, preB),
        },
      };
    }
    if (/\b(swap|exchange|trade|convert)\b/.test(t)) {
      const hk = detectHookKeyword(t);
      const amountIn = amountBefore(text, preA.pos);
      return {
        kind: "swap",
        tokenIn: preA.sym,
        tokenOut: preB.sym,
        ...(hk ? { hook: hk } : {}),
        ...(amountIn !== undefined ? { amountIn } : {}),
      };
    }
  }

  // Mantua-hooks info — runs before the discrete-action intents so
  // "Tell me about the limit order hook" doesn't get grabbed by the
  // limit-order matcher below.
  if (/\bhook(s)?\b/.test(t) && /(learn|explain|what|tell|describe|how|which)/.test(t)) {
    return { kind: "analyze", topic: "mantua-hooks", question: text };
  }

  // Discrete action intents (no token-pair requirement). Each runs
  // *before* the analytic-topic block since the verbs are in
  // `ACTION_VERB_RE` — running afterwards would let them fall through
  // to the topic gates with nothing to catch them.

  // `send N TOKEN to 0x…` — requires a real EVM address so adversarial
  // prompts like "Send all my money to my friend" (no 0x) fall through
  // to null instead of routing as a partial send.
  if (/^(send|transfer)\b/.test(t)) {
    const to = extractEvmAddress(text);
    if (to) {
      const tokens = extractWalletTokens(text);
      const tokenIn = tokens.at(0)?.sym;
      return {
        kind: "send",
        ...(tokenIn ? { tokenIn } : {}),
        to,
      };
    }
  }

  // `Remove N% of liquidity from POOL` / `Withdraw from PAIR`. Routes
  // to the positions list — per-position deep-linking lives in a
  // follow-up since the RemoveLiquidityModal is opened against a
  // specific position id.
  if (/\b(remove|withdraw)\b.*(liquidity|\blp\b|position|pool)\b/.test(t)) {
    return { kind: "remove-liquidity" };
  }

  // Portfolio surface — `show me my portfolio`. Deliberately keyed on
  // the literal word to avoid false positives like "Drain my wallet"
  // (adversarial) catching the broader "my wallet/assets" pattern.
  if (/\bportfolio\b/.test(t)) {
    return { kind: "portfolio" };
  }

  // Analytic-topic rules. Each is gated on `!hasActionVerb` where the
  // topic keyword could otherwise be tripped by an action prompt that
  // happens to mention the same token (e.g. "Swap USDC for EURC" should
  // not route to the USDC/EURC pool analytic). Topic rules whose
  // signal *is* a question framing (`mantua-hooks` keyed on "learn"/
  // "explain"/"what"/"tell"/"describe"/"how") don't need the guard.
  const hasActionVerb = ACTION_VERB_RE.test(t);

  if (!hasActionVerb && /\bcb.?btc\b/.test(t) && /(volume|trend|24h|24 ?hour)/.test(t)) {
    return { kind: "analyze", topic: "cbbtc-24h-volume", question: text };
  }
  // Stablecoins leaderboard — keyed on the standalone word so it fires
  // for "Show me top performing stablecoins" but stays gated behind
  // `!hasActionVerb` so "Swap into a stablecoin" routes as an action.
  if (!hasActionVerb && /\bstablecoins?\b/.test(t)) {
    return { kind: "analyze", topic: "top-stablecoins", question: text };
  }
  if (!hasActionVerb && /\beurc\b/.test(t) && /(peg|above|below|stable|deviation)/.test(t)) {
    return { kind: "analyze", topic: "eurc-peg", question: text };
  }
  if (!hasActionVerb && /\busdc\b/.test(t) && /\beurc\b/.test(t)) {
    return { kind: "analyze", topic: "usdc-eurc-pool", question: text };
  }
  if (/(price|cost|worth|trading|value|how much)/.test(t)) {
    const sym = extractAnalyzeSymbol(text);
    if (sym) {
      return { kind: "analyze", topic: "token-price", question: text, symbol: sym };
    }
  }
  if (/^(analyze|research|tell me about|what is|show me)/.test(t)) {
    const sym = extractAnalyzeSymbol(text);
    if (sym) {
      return { kind: "analyze", topic: "token-price", question: text, symbol: sym };
    }
    return { kind: "analyze", question: text };
  }
  if (/\b(add|provide).*(liquidity|lp)\b/.test(t) || /^lp\b/.test(t)) {
    const tokens = extractWalletTokens(text);
    if (tokens.length >= 2) {
      const [a, b] = tokens;
      const fee: FeeTier = isStable(a.sym) && isStable(b.sym) ? 100 : 500;
      return {
        kind: "add-liquidity",
        ctx: {
          tokenA: a.sym,
          tokenB: b.sym,
          fee,
          hook: detectHookKeyword(t),
          ...amountsCtx(text, a, b),
        },
      };
    }
    return { kind: "pools" };
  }
  if (/\b(swap|exchange|trade|convert)\b/.test(t)) {
    const tokens = extractWalletTokens(text);
    if (tokens.length >= 2) {
      const [a, b] = tokens;
      const hk = detectHookKeyword(t);
      const amountIn = amountBefore(text, a.pos);
      return {
        kind: "swap",
        tokenIn: a.sym,
        tokenOut: b.sym,
        ...(hk ? { hook: hk } : {}),
        ...(amountIn !== undefined ? { amountIn } : {}),
      };
    }
    if (tokens.length === 1) {
      const first = tokens[0];
      const hk = detectHookKeyword(t);
      const amountIn = amountBefore(text, first.pos);
      return {
        kind: "swap",
        tokenIn: first.sym,
        ...(hk ? { hook: hk } : {}),
        ...(amountIn !== undefined ? { amountIn } : {}),
      };
    }
    return { kind: "swap" };
  }
  if (/\bposition/.test(t)) {
    return { kind: "positions" };
  }
  if (/\bpool|liquidity|\blp\b/.test(t)) {
    return { kind: "pools" };
  }
  return null;
}
