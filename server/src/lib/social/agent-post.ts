/**
 * One post to the user's own X account, made by the agent after the user
 * approved it (owner, 2026-10-21): lint the text under the same rules as
 * the deployment account's posts, render the card, upload it, post, and
 * record the attempt — sent or refused — in social_posts and the activity
 * feed. Every outside call is a dependency, so the whole path is testable.
 */
import { lintPost } from "./compliance.ts";
import { cardSvg, type Card } from "./card-image.ts";
import type { UserPostResult } from "./x-user-client.ts";

export type PostKind = "basket" | "research";

export interface AgentPostInput {
  kind: PostKind;
  text: string;
  card: Card | null;
}

export interface AgentPostDeps {
  /** The user's live access token and handle; null when not connected. */
  connection: () => Promise<{ token: string; handle: string } | null>;
  renderPng: (card: Card) => Promise<Buffer>;
  uploadImage: (token: string, png: Buffer) => Promise<string>;
  post: (
    token: string,
    handle: string,
    text: string,
    mediaId: string | null,
  ) => Promise<UserPostResult>;
  record: (row: {
    template: string;
    text: string;
    status: "posted" | "rejected_lint" | "failed";
    detail: Record<string, unknown>;
    externalId: string | null;
  }) => Promise<void>;
}

export type AgentPostOutcome =
  | { status: "posted"; id: string; url: string; withImage: boolean }
  | { status: "not_connected" }
  | { status: "rejected_lint"; violations: { rule: string; detail: string }[] }
  | { status: "failed"; error: string };

export async function postForUser(
  input: AgentPostInput,
  deps: AgentPostDeps,
): Promise<AgentPostOutcome> {
  const template = `agent_${input.kind}`;
  const lint = lintPost(input.text, { ledgerFigures: [] });
  if (!lint.ok) {
    await deps.record({
      template,
      text: input.text,
      status: "rejected_lint",
      detail: { violations: lint.violations },
      externalId: null,
    });
    return { status: "rejected_lint", violations: lint.violations };
  }
  const conn = await deps.connection();
  if (!conn) return { status: "not_connected" };
  let mediaId: string | null = null;
  let imageError: string | null = null;
  if (input.card) {
    // An image that will not upload must not block the post: the words
    // still go out, and the record says the card was dropped.
    try {
      mediaId = await deps.uploadImage(conn.token, await deps.renderPng(input.card));
    } catch (err) {
      imageError = err instanceof Error ? err.message : String(err);
    }
  }
  const sent = await deps.post(conn.token, conn.handle, input.text, mediaId);
  if (!sent.ok) {
    await deps.record({
      template,
      text: input.text,
      status: "failed",
      detail: { error: sent.error, status: sent.status, imageError },
      externalId: null,
    });
    return { status: "failed", error: sent.error };
  }
  await deps.record({
    template,
    text: input.text,
    status: "posted",
    detail: {
      url: sent.url,
      withImage: mediaId !== null,
      imageError,
      svgBytes: input.card ? cardSvg(input.card).length : 0,
    },
    externalId: sent.id,
  });
  return { status: "posted", id: sent.id, url: sent.url, withImage: mediaId !== null };
}
