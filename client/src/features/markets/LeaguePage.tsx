import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { publicClient } from "@/lib/privy/wallet-client.ts";
import { parseAbi } from "viem";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { getSport, SPORTS, type SportId } from "./sports.ts";
import { useSlate, type SlateEvent } from "./use-slate.ts";
import { useMarketTrade } from "./use-market-trade.ts";
import { rawToHuman6 } from "./market-trade-core.ts";
import { MarketDetail } from "./MarketDetail.tsx";
import { BASE_CHAIN_ID, getExplorerTxUrl } from "@/lib/chains.ts";

interface Props {
  sport: SportId;
  onSelectSport: (id: SportId) => void;
  /** Back to the home page. */
  onBack: () => void;
  /** Hand a matchup to the autonomous agent (detail view's Agent tab). */
  onAgent: (message: string) => void;
  /** Deep-link: preselect this game (e.g. Close from the profile). */
  initialEventId?: string | undefined;
  /** Deep-link: open the sidebar on this direction. */
  initialDirection?: "buy" | "sell" | undefined;
  /** Deep-link: pre-fill the sidebar amount (one-click Close sends the
   *  full held balance, already in human units). */
  initialAmount?: string | undefined;
}

interface Selection {
  event: SlateEvent;
  outcomeIndex: 0 | 1;
}

// ─── Week selector ───────────────────────────────────────────────────────────

interface WeekOption {
  label: string;
  /** YYYYMMDD-YYYYMMDD range for the slate API. */
  dates: string;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}${m}${day}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Last week, this week, and the next four — Sunday-to-Saturday windows. */
function buildWeekOptions(): WeekOption[] {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - now.getDay());
  const options: WeekOption[] = [];
  for (let i = -1; i <= 4; i++) {
    const s = new Date(start);
    s.setDate(start.getDate() + i * 7);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    const label =
      i === -1 ? "Last week" : i === 0 ? "This week" : `${shortDate(s)} – ${shortDate(e)}`;
    options.push({ label, dates: `${ymd(s)}-${ymd(e)}` });
  }
  return options;
}

function WeekSelector({
  options,
  active,
  onSelect,
}: {
  options: WeekOption[];
  active: WeekOption;
  onSelect: (option: WeekOption) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-chip px-4 py-2 text-[13px] font-medium text-text hover:bg-accent/20 transition-colors cursor-pointer"
        >
          {active.label}
          <ChevronDown className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.dates}
            onSelect={() => {
              onSelect(option);
            }}
            className={`justify-between px-3.5 ${
              option.dates === active.dates ? "font-semibold text-text" : "text-text-dim"
            }`}
          >
            {option.label}
            {option.dates === active.dates && (
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Full-screen league page (Polymarket-style): date-grouped game rows with
 * moneyline prices in cents, and a persistent trade sidebar on the right.
 * Clicking a price selects that team into the sidebar; the sidebar quotes
 * live and executes with the user's wallet. Covered leagues only — the
 * "soon" leagues render the full-screen coming-soon state instead.
 */
export function LeaguePage({
  sport,
  onSelectSport,
  onBack,
  onAgent,
  initialEventId,
  initialDirection,
  initialAmount,
}: Props) {
  const active = getSport(sport);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  // Index 1 = "This week" — the page shows the week's games, not just today's.
  const [week, setWeek] = useState<WeekOption>(() => weekOptions[1]);
  const { slates, loading } = useSlate(week.dates);
  const [selection, setSelection] = useState<Selection | null>(null);
  // Matchup detail view (chart + comments/holders/positions/activity/agent)
  // — opened by clicking a game row, replaces the list until Back.
  const [detailId, setDetailId] = useState<string | null>(null);

  const slate = slates[active.id];
  const events = useMemo(() => slate?.events ?? [], [slate]);

  // Default selection: the deep-linked game, else the first tradeable one,
  // else the first upcoming (or any) game — the trade sidebar is always
  // populated so switching matchups just switches the teams in it.
  const effective = useMemo<Selection | null>(() => {
    if (selection) return selection;
    const linked = initialEventId
      ? events.find((e) => e.providerEventId === initialEventId)
      : undefined;
    const first =
      linked ??
      events.find((e) => e.liveOdds && e.status === "scheduled") ??
      events.find((e) => e.status === "scheduled") ??
      events.at(0);
    return first ? { event: first, outcomeIndex: 0 } : null;
  }, [selection, events, initialEventId]);

  const detailEvent = detailId
    ? (events.find((e) => e.providerEventId === detailId) ?? null)
    : null;

  if (active.coverage === "soon")
    return <ComingSoon sport={sport} onSelectSport={onSelectSport} onBack={onBack} />;

  // Group by local date.
  const groups = new Map<string, SlateEvent[]>();
  for (const event of events) {
    const day = new Date(event.startsAt * 1000).toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    });
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to home"
            className="mt-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-[13px] text-text-dim">{active.blurb}</p>
          </div>
        </div>
        <WeekSelector
          options={weekOptions}
          active={week}
          onSelect={(option) => {
            setWeek(option);
            // A selection from another week is stale — let the default
            // re-pick from the new slate.
            setSelection(null);
            setDetailId(null);
          }}
        />
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        {/* Games list, or the selected matchup's detail view */}
        <div className="min-w-0 flex-1">
          {detailEvent && (
            <MarketDetail
              event={detailEvent}
              onBack={() => {
                setDetailId(null);
              }}
              onAgent={onAgent}
            />
          )}
          {!detailEvent && loading && !slate && (
            <p role="status" className="text-[13px] text-text-dim">Loading games…</p>
          )}
          {!detailEvent && !loading && events.length === 0 && (
            <div className="rounded-md border border-border-soft px-5 py-10 text-center">
              <p className="text-[14px] font-medium">
                No {active.label} games{" "}
                {week.label === "This week"
                  ? "this week"
                  : week.label === "Last week"
                    ? "last week"
                    : `for ${week.label}`}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-text-dim">
                Off-season or a quiet slate — games and markets appear the moment the schedule does.
              </p>
            </div>
          )}
          {!detailEvent && slate?.delayed && (
            <div className="mb-3 rounded-sm border border-yellow/40 bg-yellow/10 px-3 py-1.5 text-[11px] text-yellow">
              Live data is delayed — scores and odds may lag the game.
            </div>
          )}
          {!detailEvent &&
            [...groups.entries()].map(([day, dayEvents]) => (
              <section key={day} className="mb-6">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-[16px] font-semibold">{day}</h2>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-mute">
                    Moneyline
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {dayEvents.map((event) => (
                    <GameRow
                      key={event.providerEventId}
                      event={event}
                      selected={effective?.event.providerEventId === event.providerEventId}
                      selectedOutcome={
                        effective?.event.providerEventId === event.providerEventId
                          ? effective.outcomeIndex
                          : null
                      }
                      onPick={(outcomeIndex) => {
                        setSelection({ event, outcomeIndex });
                      }}
                      onOpen={() => {
                        setSelection({ event, outcomeIndex: 0 });
                        setDetailId(event.providerEventId);
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>

        {/* Trade sidebar */}
        <div className="w-full shrink-0 lg:w-[320px]">
          {effective ? (
            <TradeSidebar
              key={`${effective.event.providerEventId}-${String(effective.outcomeIndex)}`}
              selection={effective}
              initialDirection={initialDirection}
              initialAmount={
                effective.event.providerEventId === initialEventId ? initialAmount : undefined
              }
              onPick={(outcomeIndex) => {
                setSelection({ event: effective.event, outcomeIndex });
              }}
            />
          ) : (
            <div className="rounded-md border border-border-soft px-4 py-6 text-center text-[12.5px] text-text-dim">
              Pick a price on any upcoming game to trade it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Game row ────────────────────────────────────────────────────────────────

function priceCents(bps: number | undefined, side: 0 | 1): string {
  if (typeof bps !== "number") return "—";
  const p = side === 0 ? bps : 10_000 - bps;
  return `${String(Math.max(1, Math.min(99, Math.round(p / 100))))}¢`;
}

function GameRow({
  event,
  selected,
  selectedOutcome,
  onPick,
  onOpen,
}: {
  event: SlateEvent;
  selected: boolean;
  selectedOutcome: 0 | 1 | null;
  onPick: (outcome: 0 | 1) => void;
  /** Open the matchup's detail view (chart, comments, holders, activity…). */
  onOpen: () => void;
}) {
  const live = event.status === "in_progress";
  const final = event.status === "final";
  const tradeable = Boolean(event.liveOdds) && event.status === "scheduled";
  const time = new Date(event.startsAt * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const rows = [
    { team: event.away, side: 1 as const, score: event.awayScore },
    { team: event.home, side: 0 as const, score: event.homeScore },
  ];

  return (
    // Clicking anywhere on the matchup opens its detail view (chart,
    // comments, holders, positions, activity, agent) and selects it into
    // the sidebar; the price buttons quick-select without leaving the list.
    // Browsing is public; only executing a trade needs login.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={`cursor-pointer rounded-md border bg-panel-solid px-4 py-3 transition-colors hover:border-accent/30 ${selected ? "border-accent/40" : "border-border-soft"}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] text-text-dim">
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" /> Live
          </span>
        ) : final ? (
          <span className="font-medium">Final</span>
        ) : (
          <span>{time}</span>
        )}
        {event.liveOdds && (
          <span className="rounded-[3px] bg-accent/15 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-accent">
            Market odds
          </span>
        )}
      </div>
      {rows.map(({ team, side, score }) => (
        <div key={side} className="flex items-center gap-2.5 py-1">
          {team.logo ? (
            <img
              src={team.logo}
              alt=""
              className="h-6 w-6 shrink-0 object-contain"
              loading="lazy"
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chip font-mono text-[9px] text-text-mute">
              {team.abbreviation.slice(0, 3)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{team.name}</span>
          {(live || final) && typeof score === "number" && (
            <span className="w-8 text-right font-mono text-[14px]">{score}</span>
          )}
          <button
            type="button"
            disabled={!tradeable}
            onClick={(e) => {
              e.stopPropagation();
              onPick(side);
            }}
            className={`w-[104px] rounded-md px-3 py-2 text-center font-mono text-[13px] font-semibold transition-colors ${
              selected && selectedOutcome === side
                ? "bg-accent text-white"
                : tradeable
                  ? "bg-chip text-text hover:bg-accent/25 cursor-pointer"
                  : "bg-chip/50 text-text-mute"
            }`}
          >
            {team.abbreviation} {priceCents(event.homeWinProbabilityBps, side)}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Trade sidebar ───────────────────────────────────────────────────────────

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

function TradeSidebar({
  selection,
  onPick,
  initialDirection,
  initialAmount,
}: {
  selection: Selection;
  onPick: (outcome: 0 | 1) => void;
  initialDirection?: "buy" | "sell" | undefined;
  initialAmount?: string | undefined;
}) {
  const { authenticated, user } = usePrivy();
  const { event, outcomeIndex } = selection;
  const [direction, setDirection] = useState<"buy" | "sell">(initialDirection ?? "buy");
  const [amount, setAmount] = useState(initialAmount ?? "0");
  const [yesBalance, setYesBalance] = useState<bigint | null>(null);

  const { phase, execute } = useMarketTrade({
    eventId: event.providerEventId,
    outcomeIndex,
    direction,
    amount,
    enabled: authenticated,
  });

  const chosen = outcomeIndex === 0 ? event.home : event.away;
  const calldata = phase.kind === "quoted" || phase.kind === "done" ? phase.calldata : null;

  // Once a quote reveals the YES token, show the user's holdings so Sell
  // has a truthful Max.
  const walletAddress = user?.wallet?.address as `0x${string}` | undefined;
  const yesToken = calldata?.yesToken;
  useEffect(() => {
    if (!yesToken || !walletAddress) return;
    publicClient
      .readContract({
        address: yesToken,
        abi: BALANCE_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      })
      .then(setYesBalance)
      .catch(() => {
        setYesBalance(null);
      });
  }, [yesToken, walletAddress, phase.kind]);

  const quote = calldata?.quote ?? null;
  const out = quote ? Number(quote.amountOut) / 1e6 : null;
  // Server-quoted floor (quote − slippage tolerance); the matching price
  // bound is already inside the calldata the wallet will sign.
  const minOut =
    quote && typeof quote.amountOutMinimum === "string"
      ? Number(quote.amountOutMinimum) / 1e6
      : null;
  const busy =
    phase.kind === "approving" || phase.kind === "signing" || phase.kind === "confirming";

  const bump = (n: number) => {
    setAmount(String((Number(amount) || 0) + n));
  };

  const sides = [
    { idx: 0 as const, team: event.home },
    { idx: 1 as const, team: event.away },
  ];

  return (
    <div className="rounded-md border border-border bg-panel-solid p-4">
      <p className="text-[12px] text-text-dim">
        {event.away.name} vs {event.home.name}
      </p>
      <p className="text-[15px] font-semibold">{chosen.name}</p>

      <div className="mt-3 flex gap-4 border-b border-border-soft text-[13px]">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDirection(d);
            }}
            className={`pb-2 capitalize cursor-pointer ${
              direction === d
                ? "border-b-2 border-text font-semibold text-text"
                : "text-text-dim hover:text-text"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {sides.map(({ idx, team }) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              onPick(idx);
            }}
            className={`rounded-md px-3 py-2.5 text-center font-mono text-[13px] font-semibold transition-colors cursor-pointer ${
              outcomeIndex === idx ? "bg-accent text-white" : "bg-chip text-text hover:bg-accent/25"
            }`}
          >
            {team.abbreviation} {priceCents(event.homeWinProbabilityBps, idx)}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[14px] font-medium">Amount</span>
        <div className="flex items-baseline gap-1">
          {direction === "buy" && <span className="text-[18px] text-text-mute">$</span>}
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            inputMode="decimal"
            className="w-28 bg-transparent text-right font-mono text-[26px] font-semibold text-text outline-none"
          />
          {direction === "sell" && <span className="text-[12px] text-text-mute">YES</span>}
        </div>
      </div>

      {direction === "sell" && yesBalance !== null && (
        <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-text-dim">
          You hold{" "}
          <span className="font-mono text-text">{(Number(yesBalance) / 1e6).toFixed(2)}</span> YES
          <button
            type="button"
            aria-label="Sell your full balance"
            onClick={() => {
              // Exact digits from the raw balance — float division could
              // round the last decimal up past what the wallet holds.
              setAmount(rawToHuman6(yesBalance));
            }}
            className="rounded-sm border border-border-soft px-1.5 py-0.5 text-[10px] text-text-dim hover:text-text cursor-pointer"
          >
            Max
          </button>
        </div>
      )}
      <div className="mt-2 flex justify-end gap-1.5">
        {[1, 5, 10, 100].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              bump(n);
            }}
            className="rounded-sm border border-border-soft px-2 py-1 text-[11px] text-text-dim hover:text-text cursor-pointer"
          >
            +${n}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-[38px] text-[12px] leading-relaxed text-text-dim">
        {phase.kind === "quoting" && <span role="status">Quoting…</span>}
        {quote && out !== null && direction === "buy" && (
          <>
            You receive <span className="font-mono text-text">{out.toFixed(2)}</span>{" "}
            {chosen.abbreviation} YES
            {quote.effectivePriceBps !== null &&
              ` · pays ${out.toFixed(2)} USDC if ${chosen.name} win`}
            {minOut !== null && ` · min ${minOut.toFixed(2)} after slippage`}
          </>
        )}
        {quote && out !== null && direction === "sell" && (
          <>
            You receive <span className="font-mono text-text">{out.toFixed(2)}</span> USDC
            {minOut !== null && ` · min ${minOut.toFixed(2)} after slippage`}
          </>
        )}
        {phase.kind === "error" && (
          <span role="alert" className="text-yellow">
            {phase.message}
          </span>
        )}
        {busy && (
          <span role="status" className="text-accent">
            {phase.kind === "approving" && "Approve in your wallet…"}
            {phase.kind === "signing" && "Sign the trade in your wallet…"}
            {phase.kind === "confirming" && "Confirming on-chain…"}
          </span>
        )}
        {phase.kind === "done" && (
          <span role="status" className="text-green">
            Done.{" "}
            <a
              href={getExplorerTxUrl(BASE_CHAIN_ID, phase.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View transaction
            </a>
          </span>
        )}
      </div>

      {authenticated ? (
        <Button
          variant="primary"
          size="lg"
          className="mt-2 w-full"
          aria-live="polite"
          aria-atomic="true"
          disabled={phase.kind !== "quoted"}
          onClick={() => {
            void execute();
          }}
        >
          {busy ? "Working…" : direction === "sell" ? "Sell" : "Trade"}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="mt-2 w-full"
          onClick={() => {
            window.dispatchEvent(new Event("mantua:open-login"));
          }}
        >
          Log in to trade
        </Button>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-text-mute">
        Trading halts at kickoff. Winning YES redeems for 1 USDC; postponed or tied games settle
        both sides at 0.50. By trading you agree to the Terms of Use.
      </p>
    </div>
  );
}

// ─── Coming soon ─────────────────────────────────────────────────────────────

function ComingSoon({
  sport,
  onSelectSport,
  onBack,
}: {
  sport: SportId;
  onSelectSport: (id: SportId) => void;
  onBack: () => void;
}) {
  const active = getSport(sport);
  const Icon = active.icon;
  const launch = SPORTS.filter((s) => s.coverage === "launch");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Icon className="h-8 w-8" />
      </div>
      <h1 className="mt-5 text-[26px] font-bold tracking-tight">{active.label} — coming soon</h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-text-dim">
        {launch.map((s) => s.label).join(" and ")} are covered first. {active.label} markets join
        once those are running.
      </p>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-transparent px-4 py-2 text-[13px] font-medium text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </button>
        {launch.map((s) => {
          const SIcon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelectSport(s.id);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 cursor-pointer"
            >
              <SIcon className="h-4 w-4" /> Go to {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
