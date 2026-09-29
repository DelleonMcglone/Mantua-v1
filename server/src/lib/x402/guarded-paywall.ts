import type { NextFunction, Request, Response } from "express";
import {
  paymentMiddlewareFromHTTPServer,
  RouteConfigurationError,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/express";
import type { FacilitatorClient } from "@x402/core/server";
import { logger } from "../logger.ts";

/**
 * An x402 paywall whose facilitator handshake can never become an unhandled
 * rejection.
 *
 * `paymentMiddlewareFromConfig` (@x402/express) calls
 * `x402HTTPResourceServer.initialize()` eagerly at construction and keeps the
 * promise with no rejection handler until the first paywalled request. Our
 * routers build their paywalls at module load, so a facilitator that rejects
 * the route config — the public x402.org facilitator serves testnets only and
 * answers "does not support scheme exact on network eip155:8453" — surfaced
 * as an unhandled rejection in EVERY function that imports the app (cron
 * included), not just the paid route.
 *
 * Here we own the HTTP resource server: `initialize()` starts eagerly (so a
 * misconfiguration is logged at boot, not on the first paying customer) with
 * its rejection handled, and the @x402/express middleware is built with
 * `syncFacilitatorOnStart = false` so it never starts a second, unguarded
 * handshake. Until the handshake succeeds the route answers 503 dark:
 *
 *  - RouteConfigurationError — the facilitator does not serve this
 *    scheme/network. Permanent for this config: warn once, stay dark.
 *  - any other failure (facilitator unreachable, 5xx) — transient: warn and
 *    retry on a later request after RETRY_AFTER_MS.
 */

type Schemes = Parameters<x402ResourceServer["register"]>[1];
type Routes = ConstructorParameters<typeof x402HTTPResourceServer>[1];
type Handler = (req: Request, res: Response, next: NextFunction) => void;

export type GuardedPaywallState = "initializing" | "ready" | "unsupported" | "unavailable";

export interface GuardedPaywall {
  handler: Handler;
  /** Settles (never rejects) once the current handshake attempt finishes. */
  ready: Promise<GuardedPaywallState>;
  state: () => GuardedPaywallState;
}

/** Cooldown before a transient handshake failure is retried. */
export const RETRY_AFTER_MS = 60_000;

export interface GuardedPaywallOptions {
  /** Service label for logs, e.g. "analyst-brief". */
  label: string;
  routes: Routes;
  facilitator: FacilitatorClient | FacilitatorClient[];
  schemes: { network: Parameters<x402ResourceServer["register"]>[0]; server: Schemes }[];
  /** Sends the 503 while the paywall is not ready. */
  onUnavailable: (res: Response, state: GuardedPaywallState) => void;
  /** Test seam for the retry clock. */
  now?: () => number;
}

export function createGuardedPaywall(opts: GuardedPaywallOptions): GuardedPaywall {
  const now = opts.now ?? Date.now;
  const resourceServer = new x402ResourceServer(opts.facilitator);
  for (const { network, server } of opts.schemes) resourceServer.register(network, server);
  const httpServer = new x402HTTPResourceServer(resourceServer, opts.routes);
  const middleware = paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false);

  let state: GuardedPaywallState = "initializing";
  let failedAt = 0;

  const start = (): Promise<GuardedPaywallState> => {
    state = "initializing";
    return httpServer.initialize().then(
      () => {
        state = "ready";
        return state;
      },
      (err: unknown) => {
        failedAt = now();
        if (err instanceof RouteConfigurationError) {
          state = "unsupported";
          logger.warn(
            { err: err.message, service: opts.label },
            "x402 facilitator does not support this route's scheme/network — paid route disabled (503). Point X402_FACILITATOR_URL at a facilitator that serves it.",
          );
        } else {
          state = "unavailable";
          logger.warn(
            { err, service: opts.label },
            "x402 facilitator handshake failed — paid route 503 until a retry succeeds",
          );
        }
        return state;
      },
    );
  };

  let ready = start();

  const handler: Handler = (req, res, next) => {
    if (state === "unavailable" && now() - failedAt >= RETRY_AFTER_MS) ready = start();
    ready
      .then((s) => {
        if (s !== "ready") {
          opts.onUnavailable(res, s);
          return;
        }
        return middleware(req, res, next);
      })
      .catch(next);
  };

  return {
    handler,
    get ready() {
      return ready;
    },
    state: () => state,
  };
}
