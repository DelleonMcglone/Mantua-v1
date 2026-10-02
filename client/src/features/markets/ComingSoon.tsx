import { ArrowLeft } from "lucide-react";
import { LeagueLogo } from "@/components/shell/LeagueLogo.tsx";
import { getSport, type SportId } from "./sports.ts";

/** Full-screen state for a `coverage: "soon"` league (DM-105): one line, no
 *  reference to any other league. */
export function ComingSoon({ sport, onBack }: { sport: SportId; onBack: () => void }) {
  const active = getSport(sport);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
        <LeagueLogo league={active} className="h-9 w-9" />
      </div>
      <h1 className="mt-5 text-[26px] font-bold tracking-tight">
        {active.label} markets coming soon
      </h1>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-transparent px-4 py-2 text-[13px] font-medium text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </button>
      </div>
    </div>
  );
}
