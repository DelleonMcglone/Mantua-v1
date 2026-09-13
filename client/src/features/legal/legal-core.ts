/**
 * Task 067 (G-014) — pure logic for the one-time Terms gate. The ticket
 * asks a signed-in user to accept the current Terms before their first
 * trade (and once more after a version bump), and never asks a browser
 * that is only browsing. Pure: no React, no `@/` imports.
 */

export interface AcceptanceWire {
  version: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  current: boolean;
}

export interface GateInput {
  authenticated: boolean;
  /** The acceptance read has completed (success or failure). */
  loaded: boolean;
  /** The read's answer; null while loading or when it failed. */
  terms: AcceptanceWire | null;
}

export type GateState = "hidden" | "loading" | "required" | "clear";

/**
 * hidden   — logged out: the login button is the only gate.
 * loading  — signed in, standing unknown: hold the Confirm button.
 * required — signed in and not current: show the gate instead of Confirm.
 * clear    — accepted the current version (or the read failed: the server
 *            still refuses a stale version, so the ticket is never
 *            blocked by a transient read error).
 */
export function termsGate(input: GateInput): GateState {
  if (!input.authenticated) return "hidden";
  if (!input.loaded) return "loading";
  if (input.terms === null) return "clear";
  return input.terms.current ? "clear" : "required";
}
