/**
 * Posting as the user: X API v2 with the user's OAuth 2.0 access token —
 * an image through the chunked media upload (initialize → append →
 * finalize), then the post with the media attached. The injected `fetch`
 * keeps it testable; nothing here reads env.
 */
export const X_MEDIA_INIT_URL = "https://api.x.com/2/media/upload/initialize";
export const X_MEDIA_URL = "https://api.x.com/2/media/upload";
export const X_POST_URL = "https://api.x.com/2/tweets";

export type UserPostResult =
  | { ok: true; id: string; url: string }
  | { ok: false; status: number | null; error: string };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    detail?: unknown;
    title?: unknown;
    errors?: { message?: unknown }[];
  } | null;
  const first = body?.errors?.[0]?.message;
  if (typeof body?.detail === "string") return body.detail;
  if (typeof body?.title === "string") return body.title;
  if (typeof first === "string") return first;
  return `X API responded ${String(res.status)}`;
}

/** Upload one PNG; resolves the media id. Throws with X's message on refusal. */
export async function uploadImage(token: string, png: Buffer, fetchImpl: Fetch): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const init = await fetchImpl(X_MEDIA_INIT_URL, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      media_type: "image/png",
      total_bytes: png.length,
      media_category: "tweet_image",
    }),
  });
  if (!init.ok) throw new Error(`media initialize: ${await errorOf(init)}`);
  const id = ((await init.json()) as { data?: { id?: string } }).data?.id;
  if (!id) throw new Error("media initialize returned no id");
  const form = new FormData();
  form.set("segment_index", "0");
  form.set("media", new Blob([png], { type: "image/png" }), "card.png");
  const append = await fetchImpl(`${X_MEDIA_URL}/${id}/append`, {
    method: "POST",
    headers: auth,
    body: form,
  });
  if (!append.ok) throw new Error(`media append: ${await errorOf(append)}`);
  const fin = await fetchImpl(`${X_MEDIA_URL}/${id}/finalize`, { method: "POST", headers: auth });
  if (!fin.ok) throw new Error(`media finalize: ${await errorOf(fin)}`);
  return id;
}

/** Post text with an optional image, as the user. */
export async function postAsUser(
  token: string,
  handle: string,
  text: string,
  mediaId: string | null,
  fetchImpl: Fetch,
): Promise<UserPostResult> {
  let res: Response;
  try {
    res = await fetchImpl(X_POST_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }),
    });
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) return { ok: false, status: res.status, error: await errorOf(res) };
  const id = ((await res.json().catch(() => null)) as { data?: { id?: unknown } } | null)?.data?.id;
  if (typeof id !== "string" || id.length === 0)
    return { ok: false, status: res.status, error: "X API returned no post id" };
  return { ok: true, id, url: `https://x.com/${handle}/status/${id}` };
}
