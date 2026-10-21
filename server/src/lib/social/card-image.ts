/**
 * The agent's cards as images, for a post on the user's X account
 * (owner, 2026-10-21): the Order fills card after a basket, the Summary
 * card after a research turn. Built as SVG by hand (the same facts the
 * client renders), rasterised with resvg-wasm and the bundled Inter font —
 * no browser, no system fonts, ~40 ms a card.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface FillLine {
  label: string;
  amountUsdc: number;
  received: string | null;
  effectivePriceBps: number | null;
  status: "filled" | "failed";
}
export interface BasketCard {
  kind: "basket";
  budgetUsdc: number | null;
  placedUsdc: number;
  leftoverUsdc: number;
  legs: FillLine[];
}
export interface SummaryLine {
  team: string;
  game: string;
  priceBps: number | null;
  rating: string;
}
export interface SummaryCard {
  kind: "research";
  budgetUsdc: number | null;
  rows: SummaryLine[];
}
export type Card = BasketCard | SummaryCard;

const W = 1200;
const PAD = 56;
const ROW_H = 68;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${n.toFixed(2)}`;
const cents = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(0)}¢`);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const text = (
  x: number,
  y: number,
  s: string,
  size: number,
  fill: string,
  weight = 400,
  anchor = "start",
) =>
  `<text x="${String(x)}" y="${String(y)}" font-family="Inter" font-size="${String(size)}" font-weight="${String(weight)}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

/** The SVG for a card; deterministic, so it is testable without the rasteriser. */
export function cardSvg(card: Card, brand = "mantua.ai"): string {
  const rows = card.kind === "basket" ? card.legs.length : card.rows.length;
  const H = 150 + rows * ROW_H + 120;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(W)}" height="${String(H)}" viewBox="0 0 ${String(W)} ${String(H)}">`,
    `<rect width="${String(W)}" height="${String(H)}" rx="28" fill="#0a0a0d"/>`,
    `<rect x="1" y="1" width="${String(W - 2)}" height="${String(H - 2)}" rx="27" fill="none" stroke="#22222a" stroke-width="2"/>`,
  ];
  const title =
    card.kind === "basket"
      ? `Order filled · ${usd(card.budgetUsdc ?? card.placedUsdc)} basket`
      : `Summary${card.budgetUsdc !== null ? ` · ${usd(card.budgetUsdc)} to put to work` : ""}`;
  parts.push(text(PAD, 84, title, 36, "#ffffff", 700));
  let y = 150;
  if (card.kind === "basket") {
    for (const l of card.legs) {
      parts.push(text(PAD, y + 36, clip(l.label, 46), 28, "#ffffff", 600));
      parts.push(text(W - PAD - 420, y + 36, l.received ?? "—", 24, "#8e8e96", 400, "end"));
      parts.push(text(W - PAD - 260, y + 36, usd(l.amountUsdc), 26, "#ffffff", 500, "end"));
      parts.push(
        text(W - PAD - 150, y + 36, `@ ${cents(l.effectivePriceBps)}`, 24, "#8e8e96", 400, "end"),
      );
      const ok = l.status === "filled";
      parts.push(
        `<rect x="${String(W - PAD - 120)}" y="${String(y + 10)}" width="120" height="40" rx="20" fill="${ok ? "#3ddc9722" : "#ff6b6b22"}" stroke="${ok ? "#3ddc97" : "#ff6b6b"}"/>`,
        text(
          W - PAD - 60,
          y + 37,
          ok ? "Filled" : "Failed",
          22,
          ok ? "#3ddc97" : "#ff6b6b",
          600,
          "middle",
        ),
      );
      y += ROW_H;
    }
    parts.push(
      text(
        PAD,
        y + 48,
        `${usd(card.placedUsdc)} placed · ${usd(card.leftoverUsdc)} stays in the agent wallet`,
        24,
        "#8e8e96",
      ),
    );
  } else {
    for (const r of card.rows) {
      parts.push(text(PAD, y + 36, clip(r.team, 30), 28, "#ffffff", 600));
      parts.push(text(PAD + 440, y + 36, clip(r.game, 40), 22, "#8e8e96"));
      parts.push(text(W - PAD - 150, y + 36, cents(r.priceBps), 26, "#ffffff", 500, "end"));
      const lean = r.rating.toLowerCase().includes("yes")
        ? "#3ddc97"
        : r.rating.toLowerCase().includes("no")
          ? "#ff6b6b"
          : "#8e8e96";
      parts.push(
        `<rect x="${String(W - PAD - 130)}" y="${String(y + 10)}" width="130" height="40" rx="20" fill="${lean}22" stroke="${lean}"/>`,
        text(W - PAD - 65, y + 37, clip(r.rating, 10), 22, lean, 600, "middle"),
      );
      y += ROW_H;
    }
    parts.push(
      text(
        PAD,
        y + 48,
        "Estimates are evidence-weighted, not predictions. Not betting advice.",
        22,
        "#5a5a62",
      ),
    );
  }
  parts.push(text(W - PAD, H - 40, brand, 22, "#5a5a62", 500, "end"));
  parts.push(text(PAD, H - 40, "Mantua · Programmable Sports Agents", 22, "#5a5a62", 500));
  parts.push("</svg>");
  return parts.join("");
}

// ── Rasteriser ──────────────────────────────────────────────────────────

type ResvgModule = typeof import("@resvg/resvg-wasm");
let ready: Promise<ResvgModule> | null = null;
let fontBuffer: Buffer | null = null;

/** The first path that exists among the places the font lives: next to the
 *  source in dev, next to the bundle on Vercel (`includeFiles`). */
function fontPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "..", "assets", "fonts", "InterVariable.ttf"),
    join(here, "..", "server", "assets", "fonts", "InterVariable.ttf"),
    join(process.cwd(), "server", "assets", "fonts", "InterVariable.ttf"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c, { flag: "r" });
      return c;
    } catch {
      // next candidate
    }
  }
  throw new Error("InterVariable.ttf not found for card rendering");
}

async function resvg(): Promise<ResvgModule> {
  ready ??= (async () => {
    const mod = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    await mod.initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    return mod;
  })();
  return ready;
}

/** The card as a PNG (1200 px wide). */
export async function renderCardPng(card: Card): Promise<Buffer> {
  const mod = await resvg();
  fontBuffer ??= readFileSync(fontPath());
  const r = new mod.Resvg(cardSvg(card), {
    fitTo: { mode: "width", value: W },
    font: { fontBuffers: [fontBuffer], defaultFontFamily: "Inter", loadSystemFonts: false },
  });
  return Buffer.from(r.render().asPng());
}
