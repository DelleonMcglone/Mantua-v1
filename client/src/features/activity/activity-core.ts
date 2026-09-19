/**
 * Phase 9 / PF-019, PF-020 — the pure half of the Activity timeline: the
 * wire shape of `GET /api/activity`, category filters, day grouping, the
 * card's lines and status tone. No React here so it runs under node:test.
 */

export type ActivityCategory = "trade" | "liquidity" | "transfer" | "agent" | "settlement";
export type ActivityStatus = "pending" | "completed" | "failed";
export type ActivityActor = "user" | "agent" | "system";

export interface ActivityItem {
  id: string;
  kind: string;
  category: ActivityCategory;
  /** `ActivityStatus`, or whatever a newer server sends. */
  status: string;
  /** `ActivityActor`, or whatever a newer server sends. */
  actor: string;
  summary: string;
  asset: string | null;
  amountRaw: string | null;
  valueUsd: number | null;
  marketId: string | null;
  poolId: string | null;
  positionRef: string | null;
  txHash: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextBefore: string | null;
}

export type ActivityFilter = "all" | ActivityCategory;

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trade", label: "Trades" },
  { key: "liquidity", label: "Liquidity" },
  { key: "transfer", label: "Transfers" },
  { key: "agent", label: "Agent" },
  { key: "settlement", label: "Settlements" },
];

/** Server kinds per category — the `kind` query the feed sends for a filter. */
export const KINDS_BY_CATEGORY: Record<ActivityCategory, string[]> = {
  trade: ["market_buy", "market_sell", "swap", "hedge", "combo_open", "combo_close"],
  liquidity: ["liquidity_add", "liquidity_remove"],
  transfer: ["send", "bridge", "deposit", "withdraw", "gateway_deposit", "gateway_spend"],
  agent: ["agent_research", "agent_simulation", "agent_recommendation"],
  settlement: ["redeem", "settlement", "resolution", "combo_settle"],
};

export function kindQueryFor(filter: ActivityFilter): string | null {
  return filter === "all" ? null : KINDS_BY_CATEGORY[filter].join(",");
}

export function filterItems(
  items: readonly ActivityItem[],
  filter: ActivityFilter,
): ActivityItem[] {
  return filter === "all" ? [...items] : items.filter((i) => i.category === filter);
}

const DAY_MS = 86_400_000;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** "Today", "Yesterday", or a short date — in the viewer's local calendar. */
export function dayLabel(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export interface DayGroup {
  key: string;
  label: string;
  items: ActivityItem[];
}

/** Newest first, grouped by calendar day (items arrive newest first already). */
export function groupByDay(items: readonly ActivityItem[], nowMs: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.createdAt, nowMs), items: [item] });
  }
  return groups;
}

export function relativeTime(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function statusTone(status: string): "muted" | "success" | "error" | "pending" {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "pending") return "pending";
  return "muted";
}

export function statusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Pending";
  return status;
}

const fmtUsd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The card's second line: amount, asset and value, only what is known. */
export function metaLine(item: ActivityItem): string | null {
  const parts: string[] = [];
  if (item.amountRaw && item.asset) {
    const n = Number(item.amountRaw) / 1e6;
    if (Number.isFinite(n) && n > 0)
      parts.push(`${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${item.asset}`);
  } else if (item.asset) {
    parts.push(item.asset);
  }
  if (item.valueUsd !== null && Number.isFinite(item.valueUsd)) parts.push(fmtUsd(item.valueUsd));
  if (item.actor === "agent") parts.push("by your agent");
  return parts.length > 0 ? parts.join(" · ") : null;
}
