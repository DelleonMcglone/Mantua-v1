/**
 * Task 071 (MX-004) — the browser half of push, pure: what state the
 * feature is in, the copy for each state, the topics a user can switch,
 * and the two byte-level helpers the subscribe call needs.
 */
export const PUSH_TOPICS = ["trades", "positions", "games", "agent", "settlement"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export const PUSH_TOPIC_LABELS: Record<PushTopic, { label: string; detail: string }> = {
  trades: { label: "Trade confirmations", detail: "The moment a trade is executed." },
  positions: {
    label: "Position alerts",
    detail: "Every 10¢ a side you hold moves from your entry, up or down.",
  },
  games: { label: "Game events", detail: "Kickoff and the final whistle for games you hold." },
  agent: { label: "Agent actions", detail: "Trades, hedges and recommendations from your agent." },
  settlement: { label: "Settlement", detail: "Results, and winnings ready to claim." },
};

export type PushState = "server-off" | "unsupported" | "needs-install" | "denied" | "off" | "on";

export interface PushEnv {
  serverEnabled: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: "default" | "granted" | "denied" | "unknown";
  ios: boolean;
  standalone: boolean;
  subscribed: boolean;
}

export function pushState(env: PushEnv): PushState {
  if (!env.serverEnabled) return "server-off";
  if (!env.serviceWorker || !env.pushManager || !env.notification) {
    // iOS only exposes push to an app on the home screen (16.4+).
    return env.ios && !env.standalone ? "needs-install" : "unsupported";
  }
  if (env.permission === "denied") return "denied";
  return env.subscribed ? "on" : "off";
}

export const PUSH_COPY: Record<PushState, string> = {
  "server-off": "Notifications aren't available on this deployment yet.",
  unsupported: "This browser can't receive notifications.",
  "needs-install":
    "Add Mantua to your home screen first (Share → Add to Home Screen), then turn notifications on from here.",
  denied:
    "Notifications are blocked for Mantua in your browser settings. Allow them there, then reload.",
  off: "Get a push when a trade executes, a position moves, a game you hold kicks off or ends, your agent acts, or a market settles.",
  on: "You'll hear about trades, your positions, game events, your agent, and settlement.",
};

/** The VAPID public key, as `PushManager.subscribe` wants it. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  topics: Partial<Record<PushTopic, boolean>>;
  userAgent: string;
}

/** The subscribe body, from `PushSubscription.toJSON()`; null when incomplete. */
export function subscriptionPayload(
  json: { endpoint?: string; keys?: Record<string, string> },
  topics: Partial<Record<PushTopic, boolean>>,
  userAgent: string,
): SubscriptionPayload | null {
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    topics,
    userAgent: userAgent.slice(0, 200),
  };
}

export const ALL_TOPICS_ON: Record<PushTopic, boolean> = {
  trades: true,
  positions: true,
  games: true,
  agent: true,
  settlement: true,
};
