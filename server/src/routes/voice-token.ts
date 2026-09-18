/**
 * Task 069 (V-001) — `POST /api/voice/token`.
 *
 * The one place the ElevenLabs credential is used. The browser asks for a
 * transcription session; the server spends its API key on a **single-use
 * token** and hands back only that token, when it expires, and which model
 * to ask for. The key itself has no path to the client, and the response
 * body is asserted to carry nothing else.
 *
 * Authenticated and rate-limited per user: a token costs real allowance,
 * so this is not an open endpoint. When the deployment has no key the
 * route answers 503 and the client simply never offers the microphone
 * (V-010).
 */
import { Router, type Request, type Response } from "express";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { voiceTokenRateLimiter } from "../middleware/rate-limit.ts";
import {
  httpStatusFor,
  mintScribeToken,
  type MintOutcome,
  type TokenFetcher,
} from "../lib/voice/scribe-token.ts";

export interface VoiceTokenDeps {
  mint: () => Promise<MintOutcome>;
}

/** `fetch` narrowed to the shape the mint needs. */
const defaultFetcher: TokenFetcher = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, text: () => res.text() };
};

export function createVoiceTokenRouter(overrides: Partial<VoiceTokenDeps> = {}): Router {
  const deps: VoiceTokenDeps = {
    mint: () => mintScribeToken({ apiKey: env.ELEVENLABS_API_KEY, fetcher: defaultFetcher }),
    ...overrides,
  };

  const router = Router();

  router.post(
    "/api/voice/token",
    voiceTokenRateLimiter,
    requireAuth,
    async (_req: Request, res: Response) => {
      let outcome: MintOutcome;
      try {
        outcome = await deps.mint();
      } catch (err) {
        logger.error({ err }, "voice token mint threw");
        res
          .status(502)
          .json({ error: "Voice is unavailable right now.", code: "VOICE_UNAVAILABLE" });
        return;
      }

      // A credential must never sit in a shared or browser cache.
      res.setHeader("Cache-Control", "no-store");

      if (outcome.status !== "ok") {
        if (outcome.status !== "not_configured") {
          logger.warn({ outcome: outcome.status }, "voice token unavailable");
        }
        res
          .status(httpStatusFor(outcome.status))
          .json({ error: outcome.reason, code: codeFor(outcome.status) });
        return;
      }

      res.json({
        token: outcome.token,
        expiresAt: outcome.expiresAt,
        modelId: outcome.modelId,
      });
    },
  );

  return router;
}

function codeFor(status: Exclude<MintOutcome["status"], "ok">): string {
  switch (status) {
    case "not_configured":
      return "VOICE_DISABLED";
    case "quota_exceeded":
      return "VOICE_QUOTA";
    case "rate_limited":
      return "RATE_LIMITED";
    default:
      return "VOICE_UNAVAILABLE";
  }
}

export const voiceTokenRouter = createVoiceTokenRouter();
