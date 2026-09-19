import { authorizationHeader, freshRequestIdentity, type OAuth1Credentials } from "./oauth1.ts";

/**
 * Task 070 / AE-001 — the X API v2 client: `POST /2/tweets` with a JSON
 * body under an OAuth 1.0a user-context signature. One `fetch` behind a
 * seam so the tests script every outcome; nothing here throws — a failure
 * is a typed result the scheduler records.
 */

export const X_TWEETS_URL = "https://api.x.com/2/tweets";

export type XPostResult =
  | { ok: true; id: string }
  | { ok: false; status: number | null; error: string };

export interface XClientDeps {
  fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

/** The four env values, or null when any is missing (→ dry run). */
export function xCredentialsFromEnv(e: {
  X_API_KEY?: string | undefined;
  X_API_SECRET?: string | undefined;
  X_ACCESS_TOKEN?: string | undefined;
  X_ACCESS_TOKEN_SECRET?: string | undefined;
}): OAuth1Credentials | null {
  if (!e.X_API_KEY || !e.X_API_SECRET || !e.X_ACCESS_TOKEN || !e.X_ACCESS_TOKEN_SECRET) return null;
  return {
    consumerKey: e.X_API_KEY,
    consumerSecret: e.X_API_SECRET,
    accessToken: e.X_ACCESS_TOKEN,
    accessTokenSecret: e.X_ACCESS_TOKEN_SECRET,
  };
}

interface XErrorBody {
  detail?: unknown;
  title?: unknown;
  errors?: { message?: unknown }[];
}

function errorMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as XErrorBody;
  if (typeof b.detail === "string") return b.detail;
  if (typeof b.title === "string") return b.title;
  const first = b.errors?.[0]?.message;
  if (typeof first === "string") return first;
  return `X API responded ${String(status)}`;
}

/** Post one text. */
export async function postToX(
  creds: OAuth1Credentials,
  text: string,
  deps: XClientDeps,
): Promise<XPostResult> {
  const identity = freshRequestIdentity(deps.now?.() ?? Date.now());
  const authorization = authorizationHeader(creds, {
    method: "POST",
    url: X_TWEETS_URL,
    params: {},
    ...identity,
  });
  let res: Response;
  try {
    res = await deps.fetch(X_TWEETS_URL, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: errorMessage(res.status, body) };
  const id = (body as { data?: { id?: unknown } } | null)?.data?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, status: res.status, error: "X API returned no post id" };
  }
  return { ok: true, id };
}
