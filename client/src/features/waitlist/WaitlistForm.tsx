import { useState, type SubmitEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  DONE_COPY,
  looksLikeEmail,
  readWaitlistReply,
  type WaitlistState,
} from "./waitlist-core.ts";

/** The one field on the landing page: an email, a button, a line back. */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>({ kind: "idle" });
  const valid = looksLikeEmail(email);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!valid || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: "landing" }),
      });
      const body = (await res.json().catch(() => null)) as Parameters<typeof readWaitlistReply>[1];
      setState(readWaitlistReply(res.status, body));
    } catch {
      setState({ kind: "error", message: "No connection. Try again." });
    }
  };

  if (state.kind === "done") {
    return (
      <div
        role="status"
        data-testid="waitlist-done"
        className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-md border border-green/35 bg-green/10 px-4 py-3 text-[14px] text-green"
      >
        <Check className="h-4 w-4 shrink-0" aria-hidden />
        {state.already ? DONE_COPY.already : DONE_COPY.fresh}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
      className="mx-auto flex w-full max-w-md flex-col gap-2 sm:flex-row"
      data-testid="waitlist-form"
    >
      <label htmlFor="waitlist-email" className="sr-only">
        Email address
      </label>
      <Input
        id="waitlist-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state.kind === "error") setState({ kind: "idle" });
        }}
        className="h-11 flex-1 rounded-md border border-white/20 bg-black/40 px-4 text-[15px] text-white placeholder:text-white/40 backdrop-blur"
      />
      <Button
        type="submit"
        variant="primary"
        disabled={!valid || state.kind === "sending"}
        className="h-11 px-5 text-[14px]"
      >
        {state.kind === "sending" ? "Joining…" : "Join the waitlist"}
      </Button>
      {state.kind === "error" && (
        <p role="alert" className="basis-full text-center text-[13px] text-red">
          {state.message}
        </p>
      )}
    </form>
  );
}
