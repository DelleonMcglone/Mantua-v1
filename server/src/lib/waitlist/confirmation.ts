/**
 * The waitlist confirmation email (owner, 2026-10-04): one message the
 * moment an address is first saved — "we have it, here is what happens
 * next". Sent through Resend's HTTP API from the founder's mailbox (owner,
 * 2026-10-04: delleon@mantua.ai, until a hello@ alias exists), so replies
 * land somewhere read. The address and the API key are env; without a
 * key the send is a no-op that says so, never a failed signup.
 */
export const DEFAULT_SENDER = "delleon@mantua.ai";
export const WAITLIST_SUBJECT = "You're on the Mantua waitlist";

/** "Mantua <addr>" for the From header. */
export function senderHeader(address: string): string {
  return `Mantua <${address}>`;
}

/** The owner's copy, verbatim (2026-10-04). */
const PARAGRAPHS = [
  "Thanks for signing up. We’ll email you when Mantua opens and your invite is ready.",
  "Mantua lets you trade NFL prediction markets yourself or hand the work to a Mantua sports agent that researches games, sizes positions, and executes trades for you in USDC, within your limits.",
  "We’re bringing users in as access opens up. Keep an eye on your inbox for your invite.",
  "Questions or feedback? Just reply to this email.",
] as const;
const HEADLINE = "You’re on the Mantua waitlist.";
const SIGNOFF = "— The Mantua team";

export function confirmationText(): string {
  return [HEADLINE, "", ...PARAGRAPHS.flatMap((p) => [p, ""]), SIGNOFF].join("\n");
}

export function confirmationHtml(): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font:15px/1.5 Inter,Helvetica,Arial,sans-serif;color:#1a1a24">${esc(t)}</p>`;
  return [
    `<div style="max-width:560px;margin:0 auto;padding:28px 20px">`,
    `<p style="margin:0 0 20px;font:700 22px/1.3 Inter,Helvetica,Arial,sans-serif;color:#1a1a24">${esc(HEADLINE)}</p>`,
    ...PARAGRAPHS.map(p),
    p(SIGNOFF),
    `</div>`,
  ].join("");
}

export interface ConfirmationDeps {
  apiKey: string | undefined;
  /** The mailbox the mail is from and replies go to. */
  sender: string;
  fetch: typeof fetch;
}

/** Send the confirmation; resolves to the provider id, or null when no key
 *  is configured (local dev) or the provider refused. Never throws. */
export async function sendConfirmation(
  to: string,
  deps: ConfirmationDeps,
): Promise<{ id: string } | { skipped: "no_key" } | { error: string }> {
  if (!deps.apiKey) return { skipped: "no_key" };
  try {
    const res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: senderHeader(deps.sender),
        to: [to],
        reply_to: deps.sender,
        subject: WAITLIST_SUBJECT,
        text: confirmationText(),
        html: confirmationHtml(),
      }),
    });
    if (!res.ok) return { error: `resend ${String(res.status)}` };
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? "unknown" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
