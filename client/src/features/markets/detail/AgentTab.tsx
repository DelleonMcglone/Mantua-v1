import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { PredictionNote } from "../PredictionNote.tsx";
import type { SlateEvent } from "../use-slate.ts";

/** Hand the matchup to the autonomous agent — with the T-022 note. */
export function AgentTab({
  event,
  onAgent,
}: {
  event: SlateEvent;
  onAgent: (message: string) => void;
}) {
  const message =
    `Evaluate the ${event.away.name} at ${event.home.name} game ` +
    `(event ${event.providerEventId}). Read the live market price, compare it with your ` +
    `research, and recommend whether to take a position — and if so, which side and how much.`;
  return (
    <div className="rounded-md border border-border-soft px-4 py-5 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Bot className="h-5 w-5" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-text-dim">
        Hand this matchup to your agent: it reads the live slate and market price, buys any research
        it needs, and can take the position from its own wallet — within your daily cap.
      </p>
      <Button
        variant="primary"
        className="mt-4"
        onClick={() => {
          onAgent(message);
        }}
      >
        Evaluate with your agent
      </Button>
      <PredictionNote className="mx-auto mt-3 max-w-md" />
    </div>
  );
}
