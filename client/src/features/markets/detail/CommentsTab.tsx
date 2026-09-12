import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";
import { relativeTime } from "@/lib/format.ts";
import { shortAddr, type Comment } from "./detail-types.ts";

/** The game's comment thread — public read, login to post. */
export function CommentsTab({ providerEventId }: { providerEventId: string }) {
  const { authenticated } = usePrivy();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .get<{ comments: Comment[] }>(`/api/markets/comments?providerEventId=${providerEventId}`)
      .then((res) => {
        setComments(res.comments);
      })
      .catch(() => {
        setComments([]);
      });
  }, [providerEventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const post = () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    api
      .post<{ comment: Comment | null }>("/api/markets/comments", { providerEventId, body })
      .then(() => {
        setDraft("");
        reload();
      })
      .catch(() => {
        setError("Could not post the comment. Try again.");
      })
      .finally(() => {
        setPosting(false);
      });
  };

  return (
    <div>
      {authenticated ? (
        <div className="mb-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") post();
            }}
            maxLength={400}
            placeholder="Add a comment…"
            className="flex-1 rounded-md border border-border-soft bg-bg-elev px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
          <Button variant="primary" disabled={posting || draft.trim() === ""} onClick={post}>
            {posting ? "Posting…" : "Post"}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("mantua:open-login"));
          }}
          className="mb-4 w-full rounded-md border border-border-soft px-3 py-2 text-[12.5px] text-text-dim hover:text-text cursor-pointer"
        >
          Log in to join the conversation
        </button>
      )}
      {error && (
        <p role="alert" className="mb-2 text-[12px] text-yellow">
          {error}
        </p>
      )}
      {comments === null ? (
        <p role="status" className="text-[12.5px] text-text-dim">
          Loading comments…
        </p>
      ) : comments.length === 0 ? (
        <p className="text-[12.5px] text-text-dim">No comments yet — start the thread.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border-soft px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-text-mute">
                <span className="font-mono text-text-dim">{shortAddr(c.address)}</span>
                {relativeTime(c.t)}
              </div>
              <p className="text-[13px] leading-relaxed text-text">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
