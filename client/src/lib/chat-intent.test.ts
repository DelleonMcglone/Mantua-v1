/**
 * P9-001 — chat intent matcher unit tests. Run via `npm test` in the
 * client (tsx --test). These guard the regression surface that's been
 * the most actively edited part of the chat path: token extraction,
 * typo aliasing, verb routing, generic analyze openers.
 *
 * Each block name maps to the `detectIntent` branch under test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectIntent,
  extractAnalyzeSymbol,
  extractEvmAddress,
  extractWalletTokens,
} from "./chat-intent.ts";

describe("extractWalletTokens", () => {
  it("returns tokens in left-to-right order", () => {
    const got = extractWalletTokens("swap USDC for cbBTC").map((m) => m.sym);
    assert.deepEqual(got, ["USDC", "cbBTC"]);
  });

  it("forgives common transposition typos", () => {
    // 'cbBCT' is a common transposition of the cbBTC alias 'cbbtc'.
    const got = extractWalletTokens("swap USDC for cbBCT").map((m) => m.sym);
    assert.deepEqual(got, ["USDC", "cbBTC"]);
  });

  it("does not double-count overlapping aliases", () => {
    // 'cbbtc' should not also produce a separate 'btc' hit
    const got = extractWalletTokens("how much cbBTC").map((m) => m.sym);
    assert.deepEqual(got, ["cbBTC"]);
  });

  it("returns empty when no known token is present", () => {
    assert.deepEqual(extractWalletTokens("buy doge"), []);
  });
});

describe("extractAnalyzeSymbol", () => {
  it("returns canonical for bitcoin / btc", () => {
    assert.equal(extractAnalyzeSymbol("price of bitcoin"), "bitcoin");
    assert.equal(extractAnalyzeSymbol("BTC trend"), "bitcoin");
  });

  it("normalizes typos to the canonical alias", () => {
    assert.equal(extractAnalyzeSymbol("cbBCT volume"), "cbbtc");
    assert.equal(extractAnalyzeSymbol("eht price"), "ethereum");
  });

  it("recognizes broader analyze tokens (sol, pendle, ondo)", () => {
    assert.equal(extractAnalyzeSymbol("solana price"), "solana");
    assert.equal(extractAnalyzeSymbol("pendle worth"), "pendle");
    assert.equal(extractAnalyzeSymbol("ondo cost"), "ondo");
  });

  it("returns null when no analyze symbol is present", () => {
    assert.equal(extractAnalyzeSymbol("how does fed rate decision work"), null);
  });
});

describe("detectIntent: analyze topics", () => {
  it("routes 'learn about hooks' → mantua-hooks", () => {
    const i = detectIntent("Learn about Mantua hooks");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "mantua-hooks",
      question: "Learn about Mantua hooks",
    });
  });

  it("routes 'cbBTC volume' → cbbtc-24h-volume", () => {
    const i = detectIntent("What is cbBTC's 24h volume trend?");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "cbbtc-24h-volume",
      question: "What is cbBTC's 24h volume trend?",
    });
  });

  it("routes 'is EURC above peg' → eurc-peg", () => {
    const i = detectIntent("Is EURC trading above or below its peg?");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "eurc-peg",
      question: "Is EURC trading above or below its peg?",
    });
  });

  it("routes USDC/EURC mention → usdc-eurc-pool", () => {
    const i = detectIntent("Analyze USDC/EURC pool health");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "usdc-eurc-pool",
      question: "Analyze USDC/EURC pool health",
    });
  });

  it("routes 'top stablecoins' → top-stablecoins", () => {
    const i = detectIntent("Show me top performing Stablecoins");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "top-stablecoins",
      question: "Show me top performing Stablecoins",
    });
  });
});

describe("detectIntent: token-price", () => {
  it("price + ETH → token-price with symbol=ethereum", () => {
    const i = detectIntent("What is the current price of ETH?");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "token-price",
      question: "What is the current price of ETH?",
      symbol: "ethereum",
    });
  });

  it("price + bitcoin → token-price with symbol=bitcoin", () => {
    const i = detectIntent("What is the price of bitcoin?");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "token-price",
      question: "What is the price of bitcoin?",
      symbol: "bitcoin",
    });
  });

  it("price + cbBCT typo → token-price with symbol=cbbtc", () => {
    const i = detectIntent("price of cbBCT");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "token-price",
      question: "price of cbBCT",
      symbol: "cbbtc",
    });
  });

  it("'how much is solana' → token-price symbol=solana", () => {
    const i = detectIntent("how much is solana");
    assert.deepEqual(i, {
      kind: "analyze",
      topic: "token-price",
      question: "how much is solana",
      symbol: "solana",
    });
  });
});

describe("detectIntent: swap", () => {
  it("'swap USDC for cbBTC' extracts tokenIn=USDC, tokenOut=cbBTC", () => {
    assert.deepEqual(detectIntent("swap USDC for cbBTC"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "cbBTC",
    });
  });

  it("'swap USDC for cbBCT' (typo) still extracts cbBTC", () => {
    assert.deepEqual(detectIntent("swap USDC for cbBCT"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "cbBTC",
    });
  });

  it("'trade USDC to EURC'", () => {
    assert.deepEqual(detectIntent("trade USDC to EURC"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "EURC",
    });
  });

  it("single-token swap → tokenIn pre-filled", () => {
    assert.deepEqual(detectIntent("swap usdc"), {
      kind: "swap",
      tokenIn: "USDC",
    });
  });

  it("verb only → swap with no token presets", () => {
    assert.deepEqual(detectIntent("swap stablecoins"), { kind: "swap" });
  });

  it("'swap 10 USDC for EURC' → carries amount", () => {
    assert.deepEqual(detectIntent("swap 10 USDC for EURC"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "10",
    });
  });

  it("'swap USDC for EURC with stable protection' → carries hook", () => {
    assert.deepEqual(detectIntent("swap USDC for EURC with stable protection"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "EURC",
      hook: "stable-protection",
    });
  });

  it("'swap $25 USDC for cbBTC with dynamic fee' → carries amount + hook", () => {
    assert.deepEqual(detectIntent("swap $25 USDC for cbBTC with dynamic fee"), {
      kind: "swap",
      tokenIn: "USDC",
      tokenOut: "cbBTC",
      hook: "dynamic-fee",
      amountIn: "25",
    });
  });
});

describe("detectIntent: add-liquidity", () => {
  it("'add liquidity to USDC/EURC pool' → add-liquidity ctx", () => {
    assert.deepEqual(detectIntent("add liquidity to a USDC EURC pool"), {
      kind: "add-liquidity",
      ctx: { tokenA: "USDC", tokenB: "EURC", fee: 100, hook: null },
    });
  });

  it("'add liquidity to USDC cbBCT' (typo) extracts both tokens", () => {
    assert.deepEqual(detectIntent("add liquidity to a USDC cbBCT pool"), {
      kind: "add-liquidity",
      ctx: { tokenA: "USDC", tokenB: "cbBTC", fee: 500, hook: null },
    });
  });

  it("'lp USDC EURC' (LP shorthand)", () => {
    assert.deepEqual(detectIntent("lp USDC EURC"), {
      kind: "add-liquidity",
      ctx: { tokenA: "USDC", tokenB: "EURC", fee: 100, hook: null },
    });
  });

  it("'add liquidity' with no token pair → pools fallback", () => {
    assert.deepEqual(detectIntent("add liquidity"), { kind: "pools" });
  });

  it("'add liquidity to a USDC cbBTC pool with a dynamic fee' → carries hook", () => {
    assert.deepEqual(detectIntent("add liquidity to a USDC cbBTC pool with a dynamic fee"), {
      kind: "add-liquidity",
      ctx: { tokenA: "USDC", tokenB: "cbBTC", fee: 500, hook: "dynamic-fee" },
    });
  });

  it("'Add liquidity $10 USDC / $10 cbBTC dynamic fee pool' → carries amounts + hook", () => {
    assert.deepEqual(detectIntent("Add liquidity $10 USDC / $10 cbBTC dynamic fee pool"), {
      kind: "add-liquidity",
      ctx: {
        tokenA: "USDC",
        tokenB: "cbBTC",
        fee: 500,
        hook: "dynamic-fee",
        amountA: "10",
        amountB: "10",
      },
    });
  });

  it("'add 100 USDC and 85 EURC to the pool' → parses both amounts", () => {
    assert.deepEqual(detectIntent("add 100 USDC and 85 EURC to the pool"), {
      kind: "add-liquidity",
      ctx: {
        tokenA: "USDC",
        tokenB: "EURC",
        fee: 100,
        hook: null,
        amountA: "100",
        amountB: "85",
      },
    });
  });
});

describe("detectIntent: nav fallbacks", () => {
  it("'show my positions' → positions", () => {
    assert.deepEqual(detectIntent("show my positions"), { kind: "positions" });
  });

  it("'pools' bare → pools", () => {
    assert.deepEqual(detectIntent("pools"), { kind: "pools" });
  });

  it("unmatched text → null", () => {
    assert.equal(detectIntent("hello there"), null);
  });
});

describe("extractEvmAddress", () => {
  it("pulls a 42-char 0x address out of free text", () => {
    const addr = extractEvmAddress(
      "Send 10 USDC to 0xbaacDCFfA93B984C914014F83Ee28B68dF88DC87 now",
    );
    assert.equal(addr, "0xbaacDCFfA93B984C914014F83Ee28B68dF88DC87");
  });

  it("returns null when no address is present", () => {
    assert.equal(extractEvmAddress("send all my money to my friend"), null);
  });

  it("rejects shorter hex strings (not valid EVM addresses)", () => {
    assert.equal(extractEvmAddress("the value 0xdead is too short"), null);
  });
});

describe("detectIntent: create-pool", () => {
  it("'Create a USDC/EURC pool with stable protection' → create-pool ctx", () => {
    assert.deepEqual(detectIntent("Create a USDC/EURC pool with stable protection"), {
      kind: "create-pool",
      ctx: { tokenA: "USDC", tokenB: "EURC", fee: 100, hook: "stable-protection" },
    });
  });

  it("'Make a new USDC cbBTC pool with volatility-based fees' → create-pool ctx", () => {
    assert.deepEqual(detectIntent("Make a new USDC cbBTC pool with volatility-based fees"), {
      kind: "create-pool",
      ctx: { tokenA: "USDC", tokenB: "cbBTC", fee: 500, hook: null },
    });
  });

  it("'Create a pool with all four hooks' (no token pair) → no create-pool (falls through)", () => {
    // Adversarial / nonsensical prompt — no token pair, so the
    // create-pool pre-flight skips and the rest of the rules see only
    // the `pool` bare keyword.
    assert.deepEqual(detectIntent("Create a pool with all four hooks"), { kind: "pools" });
  });
});

describe("detectIntent: remove-liquidity", () => {
  it("'Remove 50% of my liquidity from the USDC/EURC pool' → remove-liquidity", () => {
    assert.deepEqual(detectIntent("Remove 50% of my liquidity from the USDC/EURC pool"), {
      kind: "remove-liquidity",
    });
  });

  it("'Withdraw from my USDC/cbBTC position' → remove-liquidity", () => {
    assert.deepEqual(detectIntent("Withdraw from my USDC/cbBTC position"), {
      kind: "remove-liquidity",
    });
  });
});

describe("detectIntent: send", () => {
  it("'Send 10 USDC to 0xbaac…' → send with tokenIn + to", () => {
    assert.deepEqual(detectIntent("Send 10 USDC to 0xbaacDCFfA93B984C914014F83Ee28B68dF88DC87"), {
      kind: "send",
      tokenIn: "USDC",
      to: "0xbaacDCFfA93B984C914014F83Ee28B68dF88DC87",
    });
  });

  it("'Send all my money to my friend' (no 0x address) → null", () => {
    // Adversarial prompt — no recipient address means the parser
    // shouldn't route to send (and execute on whatever default address
    // SendFlow has). Falls through to null.
    assert.equal(detectIntent("Send all my money to my friend"), null);
  });
});

describe("detectIntent: portfolio", () => {
  it("'Show me my portfolio' → portfolio", () => {
    assert.deepEqual(detectIntent("Show me my portfolio"), { kind: "portfolio" });
  });

  it("'Drain my wallet' → null (not portfolio)", () => {
    // The portfolio matcher is keyed strictly on `\bportfolio\b` so
    // adversarial "my wallet"-style prompts don't get a UI route.
    assert.equal(detectIntent("Drain my wallet"), null);
  });
});

describe("detectIntent: bridge (Swap panel's Bridge venue)", () => {
  it("'Bridge 10 USDC to Ethereum' → bridge with amount + destination", () => {
    assert.deepEqual(detectIntent("Bridge 10 USDC to Ethereum"), {
      kind: "bridge",
      amount: "10",
      destination: "Ethereum",
    });
  });

  it("'Bridge 10USDC to Ethereum' (no space before token) → bridge with amount + destination", () => {
    assert.deepEqual(detectIntent("Bridge 10USDC to Ethereum"), {
      kind: "bridge",
      amount: "10",
      destination: "Ethereum",
    });
  });

  it("'Bridge USDC to arbitrum' (no amount) → bridge with destination only", () => {
    assert.deepEqual(detectIntent("Bridge USDC to arbitrum"), {
      kind: "bridge",
      destination: "Arbitrum",
    });
  });

  it("'bridge' alone → bridge with no prefill", () => {
    assert.deepEqual(detectIntent("bridge"), { kind: "bridge" });
  });

  it("'cross-chain transfer 2.5 USDC to optimism' → bridge", () => {
    assert.deepEqual(detectIntent("cross-chain transfer 2.5 USDC to optimism"), {
      kind: "bridge",
      amount: "2.5",
      destination: "Optimism",
    });
  });
});

describe("sports intents (B8-003)", () => {
  it("'nfl' bare → the NFL market page", () => {
    assert.deepEqual(detectIntent("nfl"), { kind: "market", sport: "nfl" });
  });

  it("'show me wnba games' → the WNBA market page (wnba beats the nba substring)", () => {
    assert.deepEqual(detectIntent("show me wnba games"), { kind: "market", sport: "wnba" });
  });

  it("'nba odds' → NBA, not WNBA", () => {
    assert.deepEqual(detectIntent("nba odds"), { kind: "market", sport: "nba" });
  });

  it("'analyze the nfl matchup tonight' → falls through to research, not league nav", () => {
    const intent = detectIntent("analyze the nfl matchup tonight");
    assert.notEqual(intent?.kind, "market");
  });

  it("'bet on the chiefs' → open position with the team hint (T-017)", () => {
    assert.deepEqual(detectIntent("bet on the chiefs"), {
      kind: "position",
      action: "open",
      team: "chiefs",
    });
  });

  it("'sell my position on the Raiders to lock in profit' → close with the team hint", () => {
    assert.deepEqual(detectIntent("sell my position on the Raiders to lock in profit"), {
      kind: "position",
      action: "close",
      team: "raiders",
    });
  });

  it("'open a position on the nfl game' → open position with the league", () => {
    assert.deepEqual(detectIntent("open a position on the nfl game"), {
      kind: "position",
      action: "open",
      sport: "nfl",
    });
  });

  it("'close my wnba position' → close, not league browsing", () => {
    assert.deepEqual(detectIntent("close my wnba position"), {
      kind: "position",
      action: "close",
      sport: "wnba",
    });
  });

  it("'hedge my position' → hedge", () => {
    assert.deepEqual(detectIntent("hedge my position"), { kind: "position", action: "hedge" });
  });

  it("'what is the nfl?' question phrasing → not hijacked by league nav", () => {
    // "why/how/analyze/compare" fall through; a plain "what is" question is
    // three words + league, which IS nav-shaped — accept that tradeoff, but
    // longer questions must fall through to research.
    const intent = detectIntent("how did the nfl salary cap change this year");
    assert.notEqual(intent?.kind, "market");
  });
});

describe("detectIntent: discovery (task 050, T-019)", () => {
  it("'Show me today's NFL markets' → discover, league + today", () => {
    assert.deepEqual(detectIntent("Show me today's NFL markets"), {
      kind: "discover",
      filters: { league: "nfl", startsWithin: "today" },
    });
  });

  it("'Find the most liquid NFL markets' → discover sorted by liquidity", () => {
    assert.deepEqual(detectIntent("Find the most liquid NFL markets"), {
      kind: "discover",
      filters: { league: "nfl", sort: "liquidity" },
    });
  });

  it("'What can I trade right now?' → discover, open + now (never the swap panel)", () => {
    assert.deepEqual(detectIntent("What can I trade right now?"), {
      kind: "discover",
      filters: { status: "open", startsWithin: "now" },
    });
  });

  it("'What can I trade right now in the NFL?' keeps the league", () => {
    assert.deepEqual(detectIntent("What can I trade right now in the NFL?"), {
      kind: "discover",
      filters: { league: "nfl", status: "open", startsWithin: "now" },
    });
  });

  it("a bare league browse stays league nav; research phrasing stays research", () => {
    assert.deepEqual(detectIntent("nfl markets"), { kind: "market", sport: "nfl" });
    assert.equal(detectIntent("Analyze today's NFL games and matchups")?.kind, "analyze");
  });
});
