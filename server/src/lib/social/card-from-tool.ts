/**
 * The card the agent attaches to a post, built from the tool result it
 * already holds (the basket outcome, the compare_markets result). Lenient
 * on shape — a malformed card means a text-only post, never a failure.
 */
import type { Card } from "./card-image.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (typeof v === "object" && v !== null ? (v as Rec) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function cardFromToolData(kind: "basket" | "research", raw: unknown): Card | null {
  const d = rec(raw);
  if (!d) return null;
  if (kind === "basket") {
    const legs = Array.isArray(d["legs"]) ? d["legs"] : [];
    const lines = legs.flatMap((l) => {
      const r = rec(l);
      const amount = num(r?.["amountUsdc"]);
      if (!r || amount === null) return [];
      return [
        {
          label:
            str(r["label"]) ??
            `Game ${str(r["providerEventId"]) ?? "?"} · ${r["outcomeIndex"] === 1 ? "away" : "home"} YES`,
          amountUsdc: amount,
          received: str(r["received"]),
          effectivePriceBps: num(r["effectivePriceBps"]),
          status: r["status"] === "failed" ? ("failed" as const) : ("filled" as const),
        },
      ];
    });
    if (lines.length === 0) return null;
    return {
      kind: "basket",
      budgetUsdc: num(d["budgetUsdc"]),
      placedUsdc: num(d["placedUsdc"]) ?? lines.reduce((s, l) => s + l.amountUsdc, 0),
      leftoverUsdc: num(d["leftoverUsdc"]) ?? 0,
      legs: lines.slice(0, 8),
    };
  }
  const rows = Array.isArray(d["rows"]) ? d["rows"] : [];
  const lines = rows.flatMap((x) => {
    const r = rec(x);
    const team = str(r?.["team"]);
    if (!r || !team) return [];
    return [
      {
        team,
        game: str(r["game"]) ?? "",
        priceBps: num(r["priceBps"]),
        rating: str(r["rating"]) ?? "",
      },
    ];
  });
  if (lines.length === 0) return null;
  return { kind: "research", budgetUsdc: num(d["budgetUsdc"]), rows: lines.slice(0, 6) };
}
