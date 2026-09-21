import { detectIntent } from "@/lib/chat-intent.ts";

/** A typed question that maps to a deterministic analyze topic. */
export interface AnalyzeQuery {
  topic: string;
  symbol?: string;
}

/**
 * Decide how the analyze thread should answer a typed question:
 *  - returns `{ topic, symbol? }` when the question maps to a known analyze
 *    topic (→ fast, cited deterministic `/api/analyze` runner)
 *  - returns `null` otherwise (→ AI-backed free-form research stream)
 *
 * We reuse the app's `detectIntent` but honor ONLY analyze intents — trade/nav
 * verbs ("swap", "add liquidity", …) must not hijack the research thread, so
 * those fall through to `null` and get answered conversationally too.
 */
export function resolveAnalyzeQuestion(text: string): AnalyzeQuery | null {
  // The deterministic topics were the crypto-market runners (token prices,
  // pegs, stablecoin leaderboards) — out of scope since 2026-09-16. Every
  // typed question is a sports research question now, so the thread always
  // answers conversationally. `detectIntent` is kept in the seam so a typed
  // topic can be routed again without touching the panel.
  void detectIntent(text);
  return null;
}
