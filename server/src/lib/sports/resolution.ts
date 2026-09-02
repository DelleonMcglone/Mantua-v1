/**
 * B4-003 — the resolution service: final detected → outcome derived →
 * submitted on-chain → recorded.
 *
 * Split into a pure planner and an executor over ports, for the same reason
 * the market generator is: the decision about *what to settle* must be
 * testable without a chain, and a bug in data handling must not be able to
 * sign anything by accident.
 *
 * The one genuinely subtle piece is `marketActionsFor`. Each game carries TWO
 * binary markets — one whose YES is "home wins", one whose YES is "away
 * wins" — and `Market.resolve` takes the *winning side of that market's own
 * pair* (0 = YES won, 1 = NO won), not "who won the game". A home win
 * therefore resolves the home market YES and the away market NO. Collapsing
 * those two vocabularies is exactly the kind of mistake that settles a market
 * backwards, so the mapping lives in one function with its own tests.
 */

import { computeMarketId } from "../market-id.ts";
import { corroborate } from "./consensus.ts";
import { decideSettlement } from "./ingest.ts";
import type { ProviderEvent, ProviderSlate } from "./provider.ts";

/** YES won this market's pair. Mirrors `Market.resolve` semantics. */
export const OUTCOME_YES = 0;
/** NO won this market's pair. */
export const OUTCOME_NO = 1;

export interface MarketSubmission {
  marketId: `0x${string}`;
  providerEventId: string;
  kind: "resolve" | "void";
  /** Present iff kind is "resolve": 0 = this market's YES won, 1 = its NO won. */
  outcome?: number;
}

export interface HeldEvent {
  providerEventId: string;
  reason: string;
}

export interface ResolutionPlan {
  /** Markets whose kickoff has passed — freeze is idempotent and permissionless. */
  freezes: MarketSubmission["marketId"][];
  submissions: MarketSubmission[];
  /** Events deliberately not settled this pass, with the reason logged. */
  held: HeldEvent[];
}

/** Both market ids for one game, in outcome-index order (home, away). */
export function marketIdsFor(
  providerEventId: string,
  chainId?: number,
): [`0x${string}`, `0x${string}`] {
  return [
    computeMarketId({
      providerEventId,
      marketType: "moneyline",
      outcomeIndex: 0,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
    computeMarketId({
      providerEventId,
      marketType: "moneyline",
      outcomeIndex: 1,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
  ];
}

/**
 * Translate a game outcome into per-market resolutions.
 *
 * `winningOutcomeIndex` speaks the game's vocabulary (0 = home won the game,
 * 1 = away won). Each market's `resolve` speaks its own (0 = my YES token
 * pays). The home market's YES *is* "home wins", so the two agree there — and
 * are opposites on the away market.
 */
export function marketActionsFor(
  providerEventId: string,
  winningOutcomeIndex: number,
  chainId?: number,
): MarketSubmission[] {
  const [homeMarket, awayMarket] = marketIdsFor(providerEventId, chainId);
  const homeWon = winningOutcomeIndex === 0;
  return [
    {
      marketId: homeMarket,
      providerEventId,
      kind: "resolve",
      outcome: homeWon ? OUTCOME_YES : OUTCOME_NO,
    },
    {
      marketId: awayMarket,
      providerEventId,
      kind: "resolve",
      outcome: homeWon ? OUTCOME_NO : OUTCOME_YES,
    },
  ];
}

/** Void both of a game's markets — a called-off game has no winning side. */
export function voidActionsFor(providerEventId: string, chainId?: number): MarketSubmission[] {
  return marketIdsFor(providerEventId, chainId).map((marketId) => ({
    marketId,
    providerEventId,
    kind: "void" as const,
  }));
}

/** Find the secondary provider's row for the same game, by team keys. */
export function matchSecondary(
  primary: ProviderEvent,
  secondary: ProviderSlate | null,
): ProviderEvent | null {
  if (!secondary) return null;
  return (
    secondary.events.find(
      (e) => e.home.key === primary.home.key && e.away.key === primary.away.key,
    ) ?? null
  );
}

/**
 * Plan one settlement pass over a slate.
 *
 * Corroboration policy (DM-107): with no secondary slate supplied, the
 * primary's word plus `decideSettlement`'s guards govern. Once a secondary IS
 * configured, only agreement authorises a resolve — a secondary that is
 * missing the game or not yet final holds the event rather than quietly
 * falling back to single-source, because a configured check that silently
 * skips itself is worse than no check. Voids are exempt: returning collateral
 * cannot pick a wrong winner (B4-005).
 */
export function planResolution(
  primary: ProviderSlate,
  secondary: ProviderSlate | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  chainId?: number,
): ResolutionPlan {
  const plan: ResolutionPlan = { freezes: [], submissions: [], held: [] };

  for (const event of primary.events) {
    // B4-002: kickoff passed and the game is (or should be) underway — the
    // markets' on-chain freeze can be swept. Idempotent; already-frozen
    // markets simply revert and the submitter treats that as done.
    if (
      event.startsAt <= nowSeconds &&
      (event.status === "scheduled" || event.status === "in_progress")
    ) {
      plan.freezes.push(...marketIdsFor(event.providerEventId, chainId));
    }

    const settlement = decideSettlement(event, primary.delayed);

    if (settlement.kind === "wait") {
      if (event.status === "final" || event.status === "unknown") {
        plan.held.push({ providerEventId: event.providerEventId, reason: settlement.reason });
      }
      continue;
    }

    if (settlement.kind === "void") {
      plan.submissions.push(...voidActionsFor(event.providerEventId, chainId));
      continue;
    }

    if (secondary) {
      const check = corroborate(event, matchSecondary(event, secondary));
      if (check.kind !== "agreed") {
        plan.held.push({
          providerEventId: event.providerEventId,
          reason: `corroboration ${check.kind}: ${"reason" in check ? check.reason : "winner mismatch"}`,
        });
        continue;
      }
      if (check.winningOutcomeIndex !== settlement.winningOutcomeIndex) {
        // decideSettlement and corroborate read the same primary event, so a
        // mismatch here means a logic bug, not a data problem. Hold loudly.
        plan.held.push({
          providerEventId: event.providerEventId,
          reason: "internal disagreement between settlement and corroboration",
        });
        continue;
      }
    }

    plan.submissions.push(
      ...marketActionsFor(event.providerEventId, settlement.winningOutcomeIndex, chainId),
    );
  }

  return plan;
}

// ─── Execution over ports ──────────────────────────────────────────────────

/** On-chain gateway. The only thing in this file that can spend gas. */
export interface ResolutionSubmitter {
  signerAddress(): string;
  /** Resolves null when the market was already frozen — that is success. */
  freeze(marketId: `0x${string}`): Promise<string | null>;
  resolve(marketId: `0x${string}`, outcome: number): Promise<string>;
  void(marketId: `0x${string}`): Promise<string>;
}

/** B4-006 — the public log row for one settlement action. */
export interface ResolutionRecord {
  marketId: `0x${string}`;
  providerEventId: string;
  method: "auto";
  kind: "resolve" | "void";
  outcome: number | null;
  source: string;
  signer: string;
  txHash: string;
}

export interface ResolutionLogWriter {
  record(entry: ResolutionRecord): Promise<void>;
}

export interface ExecutionSummary {
  frozen: number;
  resolved: number;
  voided: number;
  failures: { marketId: string; error: string }[];
}

/**
 * Execute a plan. Failures are isolated per market: one revert must not stop
 * the rest of the slate settling, and a failed submission stays unsettled for
 * the next sweep rather than being retried in a tight loop here.
 */
export async function executeResolution(
  plan: ResolutionPlan,
  submitter: ResolutionSubmitter,
  log: ResolutionLogWriter,
  source: string,
): Promise<ExecutionSummary> {
  const summary: ExecutionSummary = { frozen: 0, resolved: 0, voided: 0, failures: [] };

  for (const marketId of plan.freezes) {
    try {
      await submitter.freeze(marketId);
      summary.frozen += 1;
    } catch (err) {
      summary.failures.push({ marketId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const s of plan.submissions) {
    try {
      // The Resolver requires FROZEN before resolve/void, and a market that
      // missed its freeze window (a game finishing between sweeps, or the
      // sweep being down over kickoff) would otherwise be stuck NotFrozen
      // forever. Freeze is idempotent — already-frozen reverts are treated
      // as done by the submitter — so sweep it in-line before settling.
      await submitter.freeze(s.marketId).catch(() => null);
      const txHash =
        s.kind === "resolve"
          ? await submitter.resolve(s.marketId, s.outcome ?? OUTCOME_YES)
          : await submitter.void(s.marketId);

      await log.record({
        marketId: s.marketId,
        providerEventId: s.providerEventId,
        method: "auto",
        kind: s.kind,
        outcome: s.kind === "resolve" ? (s.outcome ?? OUTCOME_YES) : null,
        source,
        signer: submitter.signerAddress(),
        txHash,
      });

      if (s.kind === "resolve") summary.resolved += 1;
      else summary.voided += 1;
    } catch (err) {
      summary.failures.push({
        marketId: s.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
