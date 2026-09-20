import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/shell/SiteHeader.tsx";
import { Banner } from "@/components/ui/banner.tsx";
import { api, ApiError } from "@/lib/api.ts";
import { DigestFooter, MetricTiles, PublicVoice, RiskBlock } from "./PublicAgentSections.tsx";
import { MarketRecord, ModeBreakdown } from "./PublicAgentTables.tsx";
import { type PublicAgent } from "./reputation-core.ts";

interface Props {
  handle: string;
  /** Back to the home page. */
  onBack: () => void;
  /** Opens the app shell, same as `SiteHeader`'s CTA. */
  onLaunch: () => void;
}

/**
 * Task 070 / AE-005, AE-012 — the public performance page at
 * `/agents/<handle>`: a standalone page like docs and legal (no login),
 * reading `GET /api/agents/:handle` and rendering the record exactly as
 * the server derived it. An unknown or private handle reads as "no such
 * agent" — the two are indistinguishable by design.
 */
interface Loaded {
  handle: string;
  agent: PublicAgent | null;
  error: string | null;
}

export function PublicAgentPage({ handle, onBack, onLaunch }: Props) {
  // One record per handle; a result for another handle reads as loading.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.handle === handle ? loaded : null;
  const agent = current ? current.agent : undefined;
  const error = current?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    api
      .get<PublicAgent>(`/api/agents/${encodeURIComponent(handle)}`)
      .then((a) => {
        if (!cancelled) setLoaded({ handle, agent: a, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          handle,
          agent: null,
          error:
            err instanceof ApiError && err.status === 404
              ? "No such agent."
              : "The agent page could not be loaded right now.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <SiteHeader onLogoClick={onBack} tag="Agent" onLaunch={onLaunch} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-6 flex flex-col gap-4">
        {agent === undefined && <p className="text-[13px] text-text-dim">Loading the record…</p>}
        {agent === null && (
          <Banner tone="warn" icon="?" title={error ?? "Unavailable"}>
            Public pages exist only for agents whose owners claimed a handle and made the page
            public.
          </Banner>
        )}
        {agent && (
          <>
            <header className="flex flex-col gap-1">
              <h1 className="text-[22px] font-semibold">{agent.displayName}</h1>
              <div className="text-[13px] text-text-dim">
                @{agent.handle} · agent wallet{" "}
                <span className="font-mono">
                  {agent.walletAddress.slice(0, 6)}…{agent.walletAddress.slice(-4)}
                </span>
              </div>
              {agent.bio && <p className="mt-1 text-[13px] leading-relaxed">{agent.bio}</p>}
            </header>
            <MetricTiles agent={agent} />
            <ModeBreakdown agent={agent} />
            <RiskBlock agent={agent} />
            <MarketRecord agent={agent} />
            <PublicVoice agent={agent} />
            <DigestFooter agent={agent} />
          </>
        )}
      </main>
    </div>
  );
}
