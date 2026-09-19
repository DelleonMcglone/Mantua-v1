import { useSyncExternalStore } from "react";
import { toggleLeg, removeLeg, type BuilderLeg, type ComboLegRef } from "./combo-core.ts";

/**
 * Task 072 / CB-002 — the combo draft: the legs the user has picked from
 * any league page, kept outside React state so a `+ Combo` tap on a game
 * row and the builder panel share one list, and kept in sessionStorage so
 * a refresh does not lose a half-built ticket. Money never lives here.
 */

const KEY = "mantua:combo-draft";
const EVENT = "mantua:add-combo-leg";

let legs: BuilderLeg[] = load();
const listeners = new Set<() => void>();

function load(): BuilderLeg[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as BuilderLeg[]) : [];
  } catch {
    return [];
  }
}

function commit(next: BuilderLeg[]): void {
  legs = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the draft still lives for this session.
  }
  for (const l of listeners) l();
}

export const comboDraft = {
  get: (): BuilderLeg[] => legs,
  toggle: (leg: BuilderLeg): void => {
    commit(toggleLeg(legs, leg));
  },
  remove: (ref: ComboLegRef): void => {
    commit(removeLeg(legs, ref));
  },
  clear: (): void => {
    commit([]);
  },
  has: (ref: ComboLegRef): boolean =>
    legs.some(
      (l) => l.providerEventId === ref.providerEventId && l.outcomeIndex === ref.outcomeIndex,
    ),
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Any surface adds a leg without prop-drilling: `dispatchAddLeg(leg)`. */
export function dispatchAddLeg(leg: BuilderLeg): void {
  window.dispatchEvent(new CustomEvent<BuilderLeg>(EVENT, { detail: leg }));
}

if (typeof window !== "undefined") {
  window.addEventListener(EVENT, (e) => {
    comboDraft.toggle((e as CustomEvent<BuilderLeg>).detail);
  });
}

export function useComboDraft(): BuilderLeg[] {
  return useSyncExternalStore(comboDraft.subscribe, comboDraft.get, comboDraft.get);
}
