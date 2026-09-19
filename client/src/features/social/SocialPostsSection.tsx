import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";
import { splitPosts, STATUS_LABELS, violationLines, type SocialPost } from "./social-core.ts";

/**
 * Task 070 / AE-006 — the approval queue and the post record. A pending
 * post is sent only when the user presses Approve here; Reject keeps it
 * in the record marked as the user's decision. Nothing is deleted.
 */
export function SocialPostsSection({ enabled }: { enabled: boolean }) {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ posts: SocialPost[] }>("/api/agent/social/posts")
      .then((r) => {
        setPosts(r.posts);
      })
      .catch(() => {
        setPosts([]);
      });
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/api/agent/social/posts/${id}/${approve ? "approve" : "reject"}`, {});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled) return null;
  const { pending, history } = splitPosts(posts ?? []);
  return (
    <>
      <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
          Awaiting your approval
        </h3>
        {posts === null && <p className="mt-1.5 text-[12.5px] text-text-dim">Loading…</p>}
        {posts !== null && pending.length === 0 && (
          <p className="mt-1.5 text-[12.5px] text-text-dim">
            Nothing waiting. Composed posts appear here when the policy requires approval.
          </p>
        )}
        {error && <p className="mt-1.5 text-[12px] text-red">{error}</p>}
        <ul className="mt-2 flex flex-col gap-2.5">
          {pending.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-border-soft px-3.5 py-3 text-[13px]"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {p.text}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busyId === p.id}
                  onClick={() => void decide(p.id, true)}
                >
                  Approve & post
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === p.id}
                  onClick={() => void decide(p.id, false)}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
          Post record
        </h3>
        {posts !== null && history.length === 0 && (
          <p className="mt-1.5 text-[12.5px] text-text-dim">No posts yet.</p>
        )}
        <ul className="mt-2 flex flex-col gap-2.5">
          {history.map((p) => (
            <li key={p.id} className="text-[12.5px]">
              <div className="text-[11px] text-text-mute">
                {STATUS_LABELS[p.status]} · {p.template.replace(/_/g, " ")} ·{" "}
                {p.createdAt.slice(0, 16).replace("T", " ")} UTC
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{p.text}</div>
              {violationLines(p).map((v) => (
                <div key={v} className="text-[11px] text-red">
                  {v}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
