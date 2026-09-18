import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Task 069 (V-004, V-008, V-009) — the structural guarantee.
 *
 * The phase rests on one claim: voice is an input method, not a command
 * path. A spoken command reaches the same parser, the same permissions and
 * the same confirmation step as a typed one because it *is* a typed one by
 * the time anything acts on it.
 *
 * A claim like that is only worth what enforces it, so this walks the
 * feature and fails if any module reaches for a parser, a wallet, a signer
 * or an execution route. Voice may import the command bar's submit
 * callback and nothing else, which means the only way to break the rule is
 * to add an import — and then this test says so.
 */
const HERE = import.meta.dirname;

/** Modules and paths a voice module must never reach for. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /chat-intent/, why: "parsing is the command router's job, not the microphone's" },
  {
    pattern: /command-bar-nlp|\/api\/command\/parse/,
    why: "voice must not parse its own commands",
  },
  { pattern: /use-confirmed-action|ConfirmProvider/, why: "speech is never consent (V-009)" },
  {
    pattern: /trade-ticket|use-trade-ticket|use-market-trade/,
    why: "voice must not drive the ticket",
  },
  { pattern: /\/api\/markets\/trade/, why: "voice must not reach an execution route (V-009)" },
  {
    pattern: /\/api\/agent\/chat/,
    why: "the agent panel owns the chat request, not the microphone",
  },
  { pattern: /agent-stream/, why: "voice must not open its own agent stream" },
  {
    pattern: /privy|useWallets|useSendTransaction|walletClient/i,
    why: "voice never touches a wallet",
  },
  { pattern: /viem|signTypedData|sendTransaction/, why: "voice never signs anything" },
  { pattern: /spending-cap|execution-gate/, why: "the risk controls are the server's, untouched" },
];

/** The one network call the feature is allowed to make. */
const ALLOWED_ENDPOINTS = new Set(["/api/voice/token"]);

function sourceFiles(): string[] {
  return readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => join(HERE, name));
}

test("no voice module reaches a parse, confirm, sign or execute path (V-004/V-008/V-009)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    // Only imports and string literals can reach another module; prose in
    // a doc comment naming the rule must not trip the rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(code)) {
        offenders.push(`${file.replace(HERE, "voice")}: ${pattern.source} — ${why}`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the feature calls exactly one endpoint: the token mint (V-001)", () => {
  const seen = new Set<string>();
  for (const file of sourceFiles()) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const match of code.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) seen.add(match[1]);
  }
  assert.deepEqual([...seen].sort(), [...ALLOWED_ENDPOINTS].sort());
});

test("the transcription socket is the only outside origin, and it carries no key", () => {
  const wire = readFileSync(join(HERE, "voice-wire.ts"), "utf8");
  const origins = [...wire.matchAll(/["'`](wss?:\/\/[^"'`]*|https?:\/\/[^"'`]*)["'`]/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(origins, ["wss://api.elevenlabs.io"]);
  assert.ok(
    !/xi-api-key|ELEVENLABS_API_KEY/i.test(wire),
    "the key is server-side: neither the header nor the variable appears here",
  );

  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/xi-api-key|ELEVENLABS_API_KEY/i.test(source),
      `${file}: no client module may name the API key`,
    );
  }
});
