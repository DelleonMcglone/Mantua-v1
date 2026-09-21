import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api } from "@/lib/api.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import { useAgentPortfolio } from "@/features/agent/use-agent-portfolio.ts";
import { ActivityFeed } from "@/features/activity/ActivityFeed.tsx";
import { useActivity } from "@/features/activity/use-activity.ts";
import { AgentStatusStrip } from "./AgentStatusStrip.tsx";
import { SettledPositionsSection } from "./EconomicsSections.tsx";
import { sumComboValueUsd } from "@/features/combos/combo-ticket-core.ts";
import { useCombos } from "@/features/combos/use-combos.ts";
import { aggregateHoldings, sumMarketValueUsd, sumUsd } from "./portfolio-core.ts";
import { useMarketPositions } from "./use-market-positions.ts";
import { usePortfolioEconomics } from "./use-portfolio-economics.ts";
import { usd as fmtUsd } from "@/lib/format.ts";
import { ClaimWinnings } from "@/features/markets/ClaimWinnings.tsx";
import { MarketPositionsSection } from "./MarketPositionsSection.tsx";
import { AssetIcon, type AssetSymbol } from "./asset-icons.tsx";
import { toDisplayAssets, usePortfolio, type DisplayAsset } from "./use-portfolio.ts";
import { FiatRailsTab } from "./FiatRailsTab.tsx";

const SORTS = ["Descending", "Ascending", "Alphabetical"] as const;
type Sort = (typeof SORTS)[number];

/**
 * Assets card — matches prototype `AssetsCard` in shell.jsx: tabbed
 * Assets / Cash / Positions / Agent / Activity surface. Assets sub-view:
 * search, sort, PnL header, token rows. Positions sub-view: the market
 * (outcome-token) positions, claims and settled history.
 */
interface AssetsCardProps {
  /** Navigate to the AssetDetailPanel for the clicked balance row. */
  onSelectAsset?: (symbol: TokenSymbol) => void;
}

export function AssetsCard({ onSelectAsset }: AssetsCardProps = {}) {
  const chainId = BASE_CHAIN_ID;
  const [tab, setTab] = useState<"assets" | "cash" | "positions" | "agent" | "activity">("assets");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("Descending");
  const portfolio = usePortfolio();
  const agent = useAgentPortfolio();
  // Phase 9 — the settled history and both wallets' market positions feed
  // the holdings aggregate and the tabs.
  const economics = usePortfolioEconomics(portfolio.walletAddress);
  const userMarkets = useMarketPositions(portfolio.walletAddress);
  const agentMarkets = useMarketPositions(agent.agentAddress);
  const combos = useCombos(Boolean(portfolio.walletAddress));
  const holdings = useMemo(
    () =>
      aggregateHoldings({
        userWalletUsd: portfolio.walletAddress ? sumUsd(portfolio.balances) : null,
        agentWalletUsd: agent.agentAddress
          ? sumUsd(agent.balances)
          : agent.notProvisioned
            ? 0
            : null,
        marketPositionsUsd:
          userMarkets.rows === null && agentMarkets.rows === null
            ? null
            : sumMarketValueUsd(userMarkets.rows ?? []) +
              sumMarketValueUsd(agentMarkets.rows ?? []),
        comboPositionsUsd: combos.tickets === null ? null : sumComboValueUsd(combos.tickets),
      }),
    [
      portfolio.walletAddress,
      portfolio.balances,
      agent.agentAddress,
      agent.balances,
      agent.notProvisioned,
      userMarkets.rows,
      agentMarkets.rows,
      combos.tickets,
    ],
  );
  const assets = useMemo<DisplayAsset[]>(() => {
    if (!portfolio.walletAddress) return [];
    return toDisplayAssets(portfolio.balances, chainId);
  }, [portfolio.walletAddress, portfolio.balances, chainId]);
  const agentAssets = useMemo<DisplayAsset[]>(() => {
    if (!agent.agentAddress) return [];
    return toDisplayAssets(agent.balances, chainId);
  }, [agent.agentAddress, agent.balances, chainId]);

  const numVal = (s: string) => Number(s.replace(/[^\d.-]/g, "")) || 0;
  const filtered = assets
    .filter(
      (a) =>
        !q ||
        a.symbol.toLowerCase().includes(q.toLowerCase()) ||
        a.name.toLowerCase().includes(q.toLowerCase()),
    )
    .slice()
    .sort((a, b) => {
      if (sort === "Alphabetical") return a.name.localeCompare(b.name);
      if (sort === "Ascending") return numVal(a.val) - numVal(b.val);
      return numVal(b.val) - numVal(a.val);
    });

  const tabs = [
    { k: "assets" as const, label: "Assets", count: assets.length },
    { k: "cash" as const, label: "Cash", count: 0 },
    { k: "positions" as const, label: "Positions", count: userMarkets.rows?.length ?? 0 },
    { k: "agent" as const, label: "Agent", count: agentAssets.length },
    // Phase 9 / PF-019 — the unified timeline; count is shown inside the tab.
    { k: "activity" as const, label: "Activity", count: null },
  ];

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as typeof tab);
      }}
      className="bg-panel-solid border border-border-soft rounded-md p-0"
    >
      <div className="px-3.5 pt-2.5 border-b border-border-soft">
        <TabsList className="flex gap-0.5">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.k}
              value={t.k}
              className="group -mb-px px-3.5 py-2 bg-transparent border-none cursor-pointer text-[13px] font-medium inline-flex items-center gap-1.5 border-b-2 text-text-dim border-transparent data-[state=active]:text-text data-[state=active]:border-accent"
            >
              {t.label}
              {t.count !== null && (
                <span className="text-[10px] px-1.5 py-px rounded-full font-mono border border-border-soft text-text-mute bg-transparent group-data-[state=active]:bg-chip">
                  {t.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="assets">
        {portfolio.walletAddress && (
          <div className="px-4 py-3 border-b border-border-soft">
            <div className="text-[11px] uppercase tracking-wide text-text-mute">
              Everything you hold
            </div>
            <div className="mt-0.5 font-mono text-[18px] font-medium">
              {fmtUsd(holdings.totalUsd)}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
              {holdings.parts.map((p) => (
                <span key={p.key}>
                  {p.label} <span className="font-mono text-text">{fmtUsd(p.usd)}</span>
                </span>
              ))}
              {holdings.missing.length > 0 && (
                <span className="text-text-mute">not counted: {holdings.missing.join(", ")}</span>
              )}
            </div>
          </div>
        )}
        <div className="px-4 py-3.5 border-b border-border-soft flex items-center gap-2.5">
          <Search className="h-4 w-4 text-text-dim" />
          <div className="flex-1">
            <div className="text-[13px] font-medium">Assets</div>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
              placeholder="Search assets"
              className="border-none bg-transparent outline-none text-[12px] text-text-dim w-full p-0 mt-0.5"
            />
          </div>
        </div>

        <div className="px-3.5 py-2.5 flex gap-2 items-center border-b border-border-soft relative">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="px-2.5 py-1 rounded-full border border-border bg-bg-elev text-text-dim text-[12px] inline-flex items-center gap-1"
              >
                {sort}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px] rounded-sm shadow-lg">
              {SORTS.map((s) => (
                <DropdownMenuItem
                  key={s}
                  className={sort === s ? "bg-chip" : ""}
                  onSelect={() => {
                    setSort(s);
                  }}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex-1" />
          <div className="text-[12px] text-text-dim">PnL</div>
        </div>

        <div className="max-h-[320px] overflow-auto">
          {!portfolio.walletAddress && (
            <EmptyState>Connect a wallet to see your balances.</EmptyState>
          )}
          {portfolio.walletAddress && portfolio.loading && filtered.length === 0 && (
            <EmptyState>Loading balances…</EmptyState>
          )}
          {portfolio.walletAddress && portfolio.error && filtered.length === 0 && (
            <EmptyState tone="error">{portfolio.error}</EmptyState>
          )}
          {portfolio.walletAddress &&
            !portfolio.loading &&
            !portfolio.error &&
            filtered.length === 0 && <EmptyState>No matching balances.</EmptyState>}
          {filtered.map((a) => (
            <div
              key={a.symbol}
              onClick={
                onSelectAsset
                  ? () => {
                      onSelectAsset(a.symbol);
                    }
                  : undefined
              }
              role={onSelectAsset ? "button" : undefined}
              tabIndex={onSelectAsset ? 0 : undefined}
              onKeyDown={
                onSelectAsset
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectAsset(a.symbol);
                      }
                    }
                  : undefined
              }
              className="flex items-center gap-3 px-4 py-3 border-b border-border-soft cursor-pointer transition-colors hover:bg-row-hover"
            >
              <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex">
                <AssetRowIcon symbol={a.symbol} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[14px]">{a.name}</span>
                </div>
                <div className="text-[12px] text-text-dim mt-0.5">
                  {a.symbol} · {a.price}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[14px] font-medium font-mono">{a.qty}</div>
                <div className="text-[12px] text-text-dim font-mono">{a.val}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-text-mute" />
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="cash">
        <FiatRailsTab />
      </TabsContent>

      <TabsContent value="positions">
        <div className="max-h-[360px] overflow-auto">
          {/* Winning/voided market positions with USDC waiting (C-011 GAP-3). */}
          {portfolio.walletAddress && (
            <div className="px-3.5 pt-3">
              <ClaimWinnings address={portfolio.walletAddress} />
            </div>
          )}
          {/* Live market (outcome-token) positions with one-click Close
              (B7-003) — same section the profile shows; Close deep-links
              the trade sidebar onto a pre-filled full-balance sell. */}
          {portfolio.walletAddress && (
            <div className="px-3.5 pb-3">
              <MarketPositionsSection />
              <SettledPositionsSection econ={economics} />
            </div>
          )}
          {!portfolio.walletAddress && (
            <EmptyState>Connect a wallet to see your positions.</EmptyState>
          )}
        </div>
      </TabsContent>

      <TabsContent value="agent">
        <AgentTabBody agent={agent} agentAssets={agentAssets} />
      </TabsContent>

      <TabsContent value="activity">
        <ActivityFeed walletAddress={portfolio.walletAddress} />
      </TabsContent>
    </Tabs>
  );
}

function AgentTabBody({
  agent,
  agentAssets,
}: {
  agent: ReturnType<typeof useAgentPortfolio>;
  agentAssets: DisplayAsset[];
}) {
  if (!agent.agentAddress && agent.loading) {
    return <EmptyState>Loading agent wallet…</EmptyState>;
  }
  if (agent.notProvisioned) {
    return <EmptyState>No agent wallet yet. Open the Agent panel to create one.</EmptyState>;
  }
  if (agent.error) {
    return <EmptyState tone="error">{agent.error}</EmptyState>;
  }
  if (!agent.agentAddress) {
    return <EmptyState>Connect a wallet to view your agent.</EmptyState>;
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-border-soft">
        <div className="text-[11px] text-text-mute">Agent wallet</div>
        <div className="font-mono text-[12px] mt-0.5">{shortenAddress(agent.agentAddress)}</div>
      </div>

      <AgentStatusStrip />
      <AgentPolicyPanel />
      <div className="px-3.5 pb-3">
        <MarketPositionsSection address={agent.agentAddress} title="Agent sports positions" />
      </div>
      <AgentRecentActions walletAddress={agent.agentAddress} />

      <div className="px-3.5 pt-3 pb-1.5 text-[11px] text-text-mute uppercase tracking-wide">
        Balances
      </div>
      {agentAssets.length === 0 ? (
        <EmptyState className="py-6">
          Agent has no balances yet. Send funds to the address above.
        </EmptyState>
      ) : (
        agentAssets.map((a) => (
          <div
            key={a.symbol}
            className="flex items-center gap-3 px-4 py-3 border-b border-border-soft"
          >
            <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex">
              <AssetRowIcon symbol={a.symbol} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[14px]">{a.name}</div>
              <div className="text-[12px] text-text-dim mt-0.5">
                {a.symbol} · {a.price}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[14px] font-medium font-mono">{a.qty}</div>
              <div className="text-[12px] text-text-dim font-mono">{a.val}</div>
            </div>
          </div>
        ))
      )}
    </>
  );
}

function shortenAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const KNOWN_ASSETS: AssetSymbol[] = ["USDC", "EURC", "cbBTC"];

function AssetRowIcon({ symbol }: { symbol: string }) {
  const norm = symbol === "WETH" ? "ETH" : symbol;
  if ((KNOWN_ASSETS as readonly string[]).includes(norm)) {
    return <AssetIcon symbol={norm as AssetSymbol} size={28} />;
  }
  const initial = symbol.slice(0, 1).toUpperCase();
  return (
    <svg width={28} height={28} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="#3b3b46" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#fff"
        fontFamily="Inter, sans-serif"
      >
        {initial}
      </text>
    </svg>
  );
}

interface AgentPolicyView {
  status: "active" | "paused";
  autoTradeEnabled: boolean;
  maxStakePerTradeUsd: number;
  riskLevel: "conservative" | "balanced" | "aggressive";
  allowedLeagues: string[];
  hedge: {
    maxSizeUsd: number;
    maxExposureUsd: number;
    minConfidenceBps: number;
    cooldownMinutes: number;
    dailyBudgetUsd: number;
    allowedMarketTypes: string[];
  };
  persisted: boolean;
}

const POLICY_LEAGUES: { slug: string; label: string }[] = [{ slug: "nfl", label: "NFL" }];

/**
 * Phase 8 / A-003, A-012 (D-109) — the user's policy over the agent. The
 * only write path for these limits is this panel (PATCH /api/agent/policy);
 * the agent can read them and never change them. Every control saves on
 * change with an optimistic update and reverts on failure.
 */
function AgentPolicyPanel() {
  const [policy, setPolicy] = useState<AgentPolicyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stakeDraft, setStakeDraft] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    api
      .get<AgentPolicyView>("/api/agent/policy")
      .then((p) => {
        if (cancelled) return;
        setPolicy(p);
        setStakeDraft(String(p.maxStakePerTradeUsd));
      })
      .catch(() => {
        if (!cancelled) setError("Policy unavailable right now.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = (patch: Record<string, unknown>, optimistic: Partial<AgentPolicyView>) => {
    if (!policy || busy) return;
    const before = policy;
    setBusy(true);
    setError(null);
    setPolicy({ ...policy, ...optimistic });
    api
      .patch<AgentPolicyView>("/api/agent/policy", patch)
      .then((p) => {
        setPolicy(p);
        setStakeDraft(String(p.maxStakePerTradeUsd));
      })
      .catch(() => {
        setPolicy(before);
        setStakeDraft(String(before.maxStakePerTradeUsd));
        setError("Could not save — try again.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (error && !policy) {
    return <div className="px-4 py-3 text-[11px] text-text-mute">{error}</div>;
  }
  if (!policy) return null;

  const paused = policy.status === "paused";
  const toggle = (on: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border-soft"
      } ${busy ? "opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );

  return (
    <div className="px-4 py-3 border-b border-border-soft flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium">Agent policy · your limits on the agent</div>
          <div className="text-[11px] text-text-mute mt-0.5">
            Enforced in code before any trade or hedge. The agent can read these, never change them.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] ${paused ? "text-red" : "text-text-dim"}`}>
            {paused ? "Paused" : "Active"}
          </span>
          {toggle(
            !paused,
            () => {
              save(
                { status: paused ? "active" : "paused" },
                { status: paused ? "active" : "paused" },
              );
            },
            "Agent active",
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-mute">Max stake per trade (USD)</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="decimal"
            value={stakeDraft}
            disabled={busy}
            onChange={(e) => {
              setStakeDraft(e.target.value);
            }}
            onBlur={() => {
              const n = Number(stakeDraft);
              if (!Number.isFinite(n) || n <= 0 || n === policy.maxStakePerTradeUsd) {
                setStakeDraft(String(policy.maxStakePerTradeUsd));
                return;
              }
              save({ maxStakePerTradeUsd: n }, { maxStakePerTradeUsd: n });
            }}
            className="h-8 rounded-md border border-border-soft bg-transparent px-2 text-[12px] tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-mute">Risk level</span>
          <select
            value={policy.riskLevel}
            disabled={busy}
            onChange={(e) => {
              const riskLevel = e.target.value as AgentPolicyView["riskLevel"];
              save({ riskLevel }, { riskLevel });
            }}
            className="h-8 rounded-md border border-border-soft bg-transparent px-2 text-[12px]"
          >
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-text-mute">Leagues</span>
        {POLICY_LEAGUES.map((l) => {
          const all = policy.allowedLeagues.length === 0;
          const on = all || policy.allowedLeagues.includes(l.slug);
          return (
            <label key={l.slug} className="flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={on}
                disabled={busy}
                onChange={() => {
                  const current = all ? POLICY_LEAGUES.map((x) => x.slug) : policy.allowedLeagues;
                  const next = on ? current.filter((s) => s !== l.slug) : [...current, l.slug];
                  if (next.length === 0) return; // at least one league stays permitted
                  const allowedLeagues = next.length === POLICY_LEAGUES.length ? [] : next;
                  save({ allowedLeagues }, { allowedLeagues });
                }}
              />
              {l.label}
            </label>
          );
        })}
        <span className="text-[11px] text-text-mute">
          {policy.allowedLeagues.length === 0 ? "(all launch leagues)" : ""}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px]">Allow unprompted trades</div>
          <div className="text-[11px] text-text-mute mt-0.5">
            Only takes effect if the platform runs the agent in autonomous mode; in user-testing
            mode every trade still needs your &quot;confirm&quot;.
          </div>
        </div>
        {toggle(
          policy.autoTradeEnabled,
          () => {
            const autoTradeEnabled = !policy.autoTradeEnabled;
            save({ autoTradeEnabled }, { autoTradeEnabled });
          },
          "Allow unprompted trades",
        )}
      </div>

      <div className="text-[11px] text-text-mute">
        Hedges: max ${policy.hedge.maxSizeUsd} per leg · max ${policy.hedge.maxExposureUsd} exposure
        per market · ${policy.hedge.dailyBudgetUsd}/day
        {policy.hedge.cooldownMinutes > 0
          ? ` · ${String(policy.hedge.cooldownMinutes)} min cooldown`
          : ""}
      </div>
      {error ? <div className="text-[11px] text-red">{error}</div> : null}
    </div>
  );
}

/**
 * Phase 9 / PF-004 — the agent's last few actions (research, simulations,
 * recommendations, trades, hedges, transfers) from the unified timeline.
 */
function AgentRecentActions({ walletAddress }: { walletAddress: string | null }) {
  const feed = useActivity(walletAddress, "all", { actor: "agent", limit: 6 });
  return (
    <>
      <div className="px-3.5 pt-3 pb-1.5 text-[11px] text-text-mute uppercase tracking-wide">
        Recent actions
      </div>
      {feed.items.length === 0 ? (
        <EmptyState className="py-4">
          {feed.loading ? "Loading…" : "No agent actions yet."}
        </EmptyState>
      ) : (
        <ul className="px-4 pb-3 flex flex-col gap-1 list-none m-0">
          {feed.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate">{i.summary}</span>
              <span className="text-[10px] text-text-mute">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
