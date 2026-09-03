/* eslint-disable react-refresh/only-export-components -- co-located formatters + strip component by design. */
import { BASE_CHAIN_ID, getExplorerAddressUrl } from "@/lib/chains.ts";
import { ExternalLink } from "lucide-react";
import { address as shortAddr } from "@/lib/format.ts";
import { AgentStrip } from "./AgentStrip.tsx";
import { CopyButton } from "./agent-primitives.tsx";
import type { AgentPortfolioState } from "./use-agent-portfolio.ts";

/**
 * Shared formatters + the live agent-wallet address strip used by the
 * conversational agent panel. The old per-action gating helpers
 * (useAgentAction / AgentActionError / AgentActionSuccess / AgentNotReady /
 * AgentProvision) were removed with the form-based flows — the agent now
 * auto-provisions its Circle wallet on the first message and reports results
 * conversationally.
 */

// Re-exported from the canonical formatter module so existing agent-surface
// imports keep working; the local `fmtUsd` copy was deleted in B-015's
// formatter unification (use `usd` from `@/lib/format.ts`).
export { shortAddr };

/** AgentStrip wired to the live agent wallet address + explorer link. */
export function AgentWalletStrip({
  agent,
  label = "Agent wallet",
}: {
  agent: AgentPortfolioState;
  label?: string;
}) {
  const chainId = BASE_CHAIN_ID;
  if (!agent.agentAddress) return null;
  const url = getExplorerAddressUrl(chainId, agent.agentAddress);
  return (
    <AgentStrip
      label={label}
      addr={
        <span className="inline-flex items-center gap-2">
          {shortAddr(agent.agentAddress)}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-dim no-underline"
            aria-label="View on explorer"
          >
            <ExternalLink className="h-[11px] w-[11px]" aria-hidden />
          </a>
          <CopyButton value={agent.agentAddress} label="Copy agent address" />
        </span>
      }
    />
  );
}
