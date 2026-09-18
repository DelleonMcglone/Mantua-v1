/**
 * Task 069 (V-001) — minting the short-lived credential the browser uses to
 * open a Scribe v2 Realtime transcription socket.
 *
 * The ElevenLabs API key is a server secret and has no path to the client.
 * Instead the server exchanges it for a **single-use token**: ElevenLabs
 * issues one from `POST /v1/single-use-token/realtime_scribe` against the
 * `xi-api-key` header, it expires fifteen minutes after issue, and it is
 * consumed the first time a socket authenticates with it. The browser gets
 * that token and nothing else.
 *
 * Everything here is pure apart from the injected `fetcher`, so the whole
 * exchange is tested without a network. The failure vocabulary lives in
 * `scribe-token-status.ts`.
 */
import { failureForStatus, reasonFor, type MintOutcome } from "./scribe-token-status.ts";

export type { MintFailure, MintOutcome } from "./scribe-token-status.ts";
export { failureForStatus, httpStatusFor } from "./scribe-token-status.ts";

/** The realtime speech-to-text model this phase targets. */
export const SCRIBE_MODEL_ID = "scribe_v2_realtime";

/** ElevenLabs' single-use token endpoint for realtime transcription. */
export const TOKEN_ENDPOINT = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";

/** ElevenLabs expires a single-use token fifteen minutes after issue. */
export const TOKEN_TTL_MS = 15 * 60_000;

/** The subset of `fetch` this module needs, so tests need no network. */
export interface TokenResponse {
  status: number;
  text: () => Promise<string>;
}
export type TokenFetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string> },
) => Promise<TokenResponse>;

export interface MintInput {
  /** The server secret. Undefined when the deployment has no voice key. */
  apiKey: string | undefined;
  fetcher: TokenFetcher;
  /** Injected for deterministic expiry in tests. */
  now?: number;
}

/**
 * Reads the token out of an ElevenLabs response body. The documented shape
 * is `{"token": "..."}`; anything else is treated as an upstream fault
 * rather than guessed at.
 */
export function readToken(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const token = (parsed as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Exchanges the server's API key for a single-use realtime token.
 *
 * @returns the token and the instant it expires, or the reason it could not
 *   be minted. Never throws: a transport fault is an `upstream_unavailable`
 *   outcome, because every failure here has the same consequence for the
 *   user — voice is unavailable and the keyboard still works.
 */
export async function mintScribeToken(input: MintInput): Promise<MintOutcome> {
  const { apiKey, fetcher } = input;
  if (!apiKey) {
    return { status: "not_configured", reason: "Voice input is not enabled for this deployment." };
  }
  const now = input.now ?? Date.now();

  let response: TokenResponse;
  try {
    response = await fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey, accept: "application/json" },
    });
  } catch {
    return { status: "upstream_unavailable", reason: "The transcription service did not answer." };
  }

  if (response.status < 200 || response.status >= 300) {
    const failure = failureForStatus(response.status);
    return { status: failure, reason: reasonFor(failure) };
  }

  const token = readToken(await response.text());
  if (!token) {
    return {
      status: "upstream_unavailable",
      reason: "The transcription service returned no usable credential.",
    };
  }
  return { status: "ok", token, expiresAt: now + TOKEN_TTL_MS, modelId: SCRIBE_MODEL_ID };
}
