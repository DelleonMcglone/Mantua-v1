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

export function confirmationText(): string {
  return [
    "Thanks — you're on the Mantua waitlist.",
    "",
    "What happens next:",
    "1. We'll email you once when Mantua opens, with your invite.",
    "2. Mantua is NFL prediction markets you trade yourself or hand to an agent that researches, sizes and places the bets for you — in USDC, under your caps.",
    "3. Until then, the demo on mantua.ai shows the three prompts you can run without putting anything at risk.",
    "",
    "Questions? Reply to this email.",
    "",
    "— The Mantua team",
    "mantua.ai",
  ].join("\n");
}

export function confirmationHtml(): string {
  const p = (s: string) =>
    `<p style="margin:0 0 14px;font:15px/1.5 Inter,Helvetica,Arial,sans-serif;color:#1a1a24">${s}</p>`;
  return [
    `<div style="max-width:560px;margin:0 auto;padding:28px 20px">`,
    `<p style="margin:0 0 20px;font:700 22px/1.3 Inter,Helvetica,Arial,sans-serif;color:#1a1a24">You're on the Mantua waitlist.</p>`,
    p("Thanks for signing up. Here's what happens next:"),
    `<ol style="margin:0 0 14px 18px;padding:0;font:15px/1.6 Inter,Helvetica,Arial,sans-serif;color:#1a1a24">`,
    `<li>We'll email you once when Mantua opens, with your invite.</li>`,
    `<li>Mantua is NFL prediction markets you trade yourself or hand to an agent that researches, sizes and places the bets for you — in USDC, under your caps.</li>`,
    `<li>Until then, the demo on <a href="https://www.mantua.ai" style="color:#6e4fe0">mantua.ai</a> shows the three prompts you can run without putting anything at risk.</li>`,
    `</ol>`,
    p("Questions? Reply to this email."),
    p("— The Mantua team"),
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
