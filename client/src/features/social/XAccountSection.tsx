import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/api.ts";
import { X_OUTCOME_KEY, type XOutcome } from "./social-core.ts";

interface XStatus {
  available: boolean;
  connection: { handle: string; displayName: string; connectedAt: string } | null;
}

/** The outcome App stashed before it cleaned the URL; read once. */
function takeStoredOutcome(): XOutcome | null {
  try {
    const v = sessionStorage.getItem(X_OUTCOME_KEY);
    sessionStorage.removeItem(X_OUTCOME_KEY);
    return v === "connected" || v === "denied" || v === "error" ? v : null;
  } catch {
    return null;
  }
}

const OUTCOME_COPY = {
  connected: "Your X account is connected.",
  denied: "X access was not granted — nothing changed.",
  error: "Connecting to X did not complete. Try again.",
} as const;

/**
 * "Your X account" — connect the user's own X account through X's consent
 * screen so the agent can post as them (owner, 2026-10-21), see which
 * account is connected, and disconnect. The tokens never reach the
 * browser; the server holds them sealed.
 */
export function XAccountSection() {
  const [status, setStatus] = useState<XStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => {
    const outcome = takeStoredOutcome();
    return outcome ? OUTCOME_COPY[outcome] : null;
  });

  const load = () =>
    api
      .get<XStatus>("/api/social/x")
      .then(setStatus)
      .catch(() => {
        setStatus({ available: false, connection: null });
      });
  useEffect(() => {
    void load();
  }, []);

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { url } = await api.post<{ url: string }>("/api/social/x/connect", {});
      window.location.assign(url);
    } catch {
      setNotice("Could not start the X connection. Try again.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.delete("/api/social/x", {});
      setNotice("Disconnected.");
      await load();
    } catch {
      setNotice("Could not disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="x-account"
      className="mt-3 rounded-md border border-border-soft px-4 py-3.5 flex flex-col gap-2.5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
        Your X account
      </h3>
      {status?.connection ? (
        <>
          <p className="text-[12.5px]">
            Connected as <span className="font-medium">@{status.connection.handle}</span>. When you
            ask, your agent can post a research turn or an executed trade — with its card as an
            image — to this account. Nothing is posted without your approval.
          </p>
          <div>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] text-text-dim">
            Connect your own X account and your agent can post its research and trades there — each
            one only after you approve it.
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || status === null || !status.available}
              onClick={() => void connect()}
            >
              {busy ? "Opening X…" : "Connect X"}
            </Button>
            {status && !status.available && (
              <span className="ml-3 text-[12px] text-text-dim">
                Not enabled on this deployment.
              </span>
            )}
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="text-[12px] text-text-dim">
          {notice}
        </p>
      )}
    </section>
  );
}
