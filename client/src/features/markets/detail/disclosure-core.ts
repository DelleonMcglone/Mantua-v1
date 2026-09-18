/**
 * Phase 11 (D-004) — layered disclosure as data. The simple surface
 * (summary, live game, chart) is always visible; everything deeper is a
 * section that starts closed and opens one tap at a time, so a first-time
 * user is never shown a depth ladder they did not ask for and a pro can
 * open all of them. Rendered by `MarketDepthSections.tsx`.
 */
export type SectionId = "depth" | "fees" | "research" | "history";

export interface Section {
  id: SectionId;
  title: string;
  /** One line under the title, before the section is opened. */
  blurb: string;
  /** False when the data the section needs does not exist for this game. */
  available: boolean;
  /** Why it is unavailable, shown in place of the body. */
  note: string | null;
}

export type OpenState = Record<SectionId, boolean>;

export const ALL_CLOSED: OpenState = { depth: false, fees: false, research: false, history: false };

export interface SectionInput {
  /** The game has moneyline markets (a pool to quote depth from). */
  hasMarkets: boolean;
  /** The analyst could produce research for this game. */
  hasResearch: boolean;
}

export function sectionsFor(input: SectionInput): Section[] {
  return [
    {
      id: "depth",
      title: "Depth & liquidity",
      blurb: "Volume, open interest, and what it costs to move the price.",
      available: input.hasMarkets,
      note: input.hasMarkets ? null : "Depth appears once this game's market opens.",
    },
    {
      id: "fees",
      title: "Fees & execution",
      blurb: "What a trade pays and exactly how it is filled.",
      available: true,
      note: null,
    },
    {
      id: "research",
      title: "Research",
      blurb: "The analyst's read on this matchup, labelled as an estimate.",
      available: input.hasResearch,
      note: input.hasResearch ? null : "Research appears once this game is in the data layer.",
    },
    {
      id: "history",
      title: "Past markets",
      blurb: "How earlier games in this league resolved, with their price paths.",
      available: true,
      note: null,
    },
  ];
}

export function toggle(state: OpenState, id: SectionId): OpenState {
  return { ...state, [id]: !state[id] };
}

/** Every section a pro would want, in one tap. */
export function openAll(sections: readonly Section[]): OpenState {
  const next = { ...ALL_CLOSED };
  for (const s of sections) if (s.available) next[s.id] = true;
  return next;
}

export function anyOpen(state: OpenState): boolean {
  return Object.values(state).some(Boolean);
}
