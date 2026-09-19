/**
 * Task 071 (MX-007) — when to offer "Add Mantua to your home screen", pure.
 *
 * The offer is earned, not ambient: it appears on a phone browser after the
 * user has done something worth coming back to (a trade, or opening their
 * positions), never inside the installed app, and a dismissal is respected
 * for two weeks. iOS has no install prompt event, so it gets the two-step
 * instruction instead of a button.
 */
export const INSTALL_DISMISS_MS = 14 * 24 * 3600 * 1000;
export const INSTALL_DISMISSED_KEY = "mantua:install-dismissed-at";

export interface InstallContext {
  /** Below `md` — phones only; a desktop install is the browser's own affordance. */
  mobile: boolean;
  /** Already running as the installed app (`display-mode: standalone`). */
  standalone: boolean;
  /** iOS Safari: no `beforeinstallprompt`, only Share → Add to Home Screen. */
  ios: boolean;
  /** The browser fired `beforeinstallprompt` and we hold the event. */
  canPrompt: boolean;
  /** The user did something worth returning to (a trade, the portfolio). */
  earned: boolean;
  dismissedAt: number | null;
  now: number;
}

export type InstallOffer = "none" | "prompt" | "ios-steps";

export function installOffer(c: InstallContext): InstallOffer {
  if (!c.mobile || c.standalone || !c.earned) return "none";
  if (c.dismissedAt !== null && c.now - c.dismissedAt < INSTALL_DISMISS_MS) return "none";
  if (c.canPrompt) return "prompt";
  if (c.ios) return "ios-steps";
  return "none";
}

/** iOS Safari (and iPadOS 13+ masquerading as a Mac with touch). */
export function isIosBrowser(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export const INSTALL_COPY = {
  prompt: {
    title: "Add Mantua to your home screen",
    body: "One tap to your markets and positions, with notifications when a game moves.",
    action: "Add",
  },
  "ios-steps": {
    title: "Add Mantua to your home screen",
    body: "Tap Share, then “Add to Home Screen”. That also turns on notifications.",
    action: "Got it",
  },
} as const;
