/** The session flag: this visitor has been past the landing page once. */
export const FRONT_DOOR_DONE_KEY = "mantua:front-door-done";

export function readFrontDoorDone(): boolean {
  try {
    return sessionStorage.getItem(FRONT_DOOR_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFrontDoorDone(): void {
  try {
    sessionStorage.setItem(FRONT_DOOR_DONE_KEY, "1");
  } catch {
    // storage unavailable: the landing page shows again next time, no worse
  }
}

/** The landing page's one URL. */
export const WAITLIST_PATH = "/waitlist";

export function isWaitlistPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === WAITLIST_PATH;
}

/** The way in while the front door is the waitlist: `/login` opens the
 *  app with the login modal up, then settles on `/`. */
export const LOGIN_PATH = "/login";

export function isLoginPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === LOGIN_PATH;
}

/** Route kinds a logged-out visitor may still reach while gated: the
 *  public pages, and the landing page itself. */
const GATE_EXEMPT: ReadonlySet<string> = new Set([
  "waitlist",
  "legal",
  "docs",
  "agent-public",
  "calibration",
]);

/**
 * The front door: with the flag on, a visitor who is not signed in and has
 * not been in yet (`loginRequested`: `/login`, a past login, or a logout
 * from the home page) sees the landing page instead of the app — unless
 * they asked for a public page.
 */
export function waitlistGate(input: {
  frontDoor: boolean;
  authenticated: boolean;
  loginRequested: boolean;
  routeKind: string;
}): boolean {
  if (!input.frontDoor || input.authenticated || input.loginRequested) return false;
  return !GATE_EXEMPT.has(input.routeKind);
}
