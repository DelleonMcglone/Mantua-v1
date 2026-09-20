import { ArrowLeft } from "lucide-react";
import { LeagueLogo } from "@/components/shell/LeagueLogo.tsx";
import { getSport, SPORTS, type SportId } from "./sports.ts";

/** Full-screen state for a `coverage: "soon"` league (DM-105). */
export function ComingSoon({
  sport,
  onSelectSport,
  onBack,
}: {
  sport: SportId;
  onSelectSport: (id: SportId) => void;
  onBack: () => void;
}) {
  const active = getSport(sport);
  const launch = SPORTS.filter((s) => s.coverage === "launch");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
        <LeagueLogo league={active} className="h-9 w-9" />
      </div>
      <h1 className="mt-5 text-[26px] font-bold tracking-tight">{active.label} — coming soon</h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-text-dim">
        {launch.map((s) => s.label).join(" and ")} is covered first. {active.label} markets join
        once it&apos;s running.
      </p>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-transparent px-4 py-2 text-[13px] font-medium text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </button>
        {launch.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onSelectSport(s.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 cursor-pointer"
          >
            <LeagueLogo league={s} className="h-4 w-4" /> Go to {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
