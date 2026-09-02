/* eslint-disable react-refresh/only-export-components -- co-located formatters + strip component by design. */
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { getExplorerAddressUrl } from "@/lib/chains.ts";
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

export function shortAddr(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** AgentStrip wired to the live agent wallet address + explorer link. */
export function AgentWalletStrip({
  agent,
  label = "Agent wallet",
}: {
  agent: AgentPortfolioState;
  label?: string;
}) {
  const chainId = useCurrentChainId();
  if (!agent.agentAddress) return null;
  const url = getExplorerAddressUrl(chainId, agent.agentAddress);
  return (
    <AgentStrip
      label={label}
      addr={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {shortAddr(agent.agentAddress)}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-dim)", textDecoration: "none" }}
          >
            ↗
          </a>
          <CopyButton value={agent.agentAddress} label="Copy agent address" />
        </span>
      }
    />
  );
}
