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
  const intent = detectIntent(text);
  if (intent && intent.kind === "analyze" && intent.topic) {
    return { topic: intent.topic, ...(intent.symbol ? { symbol: intent.symbol } : {}) };
  }
  return null;
}
