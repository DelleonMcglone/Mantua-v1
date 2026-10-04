/** The pure half of the waitlist form: what the server answers and how
 *  the form reads it. No React here so it runs under node:test. */

export type WaitlistState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; already: boolean }
  | { kind: "error"; message: string };

/** A light client-side gate so an obviously empty field never hits the
 *  network; the server is the real validator. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length >= 6 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** Turn the server's reply (or failure) into the form's next state. */
export function readWaitlistReply(
  status: number,
  body: { ok?: boolean; already?: boolean; error?: string } | null,
): WaitlistState {
  if (status === 200 && body?.ok) return { kind: "done", already: body.already === true };
  if (status === 429) return { kind: "error", message: "Too many tries — give it a minute." };
  return {
    kind: "error",
    message: body?.error ?? "Could not save your email. Try again.",
  };
}

export const DONE_COPY = {
  fresh: "You're on the list. We'll email you when it's time.",
  already: "You're already on the list — we'll email you when it's time.",
} as const;

/** The landing page's one URL. */
export const WAITLIST_PATH = "/waitlist";

export function isWaitlistPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === WAITLIST_PATH;
}
