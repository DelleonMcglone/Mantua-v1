import { BarChart3, Bot, Layers } from "lucide-react";

export type HomePromptId = "analyze" | "agent" | "combos";

const PROMPTS: { id: HomePromptId; title: string; icon: typeof Bot }[] = [
  { id: "agent", title: "Create / Manage Sports Agent", icon: Bot },
  {
    id: "analyze",
    title: "Analyze today's NFL games, matchups, and markets",
    icon: BarChart3,
  },
  { id: "combos", title: "Build a combo across today's games", icon: Layers },
];

interface Props {
  onPromptSelect: (id: HomePromptId) => void;
  /** `responsive` (default): 1 column below `md`, 3 above — the
   *  single-column mobile layout per the design guidance (B-014).
   *  `single`: always one column, for the hamburger nav sheet where the
   *  container is narrow regardless of viewport width. */
  columns?: "responsive" | "single";
}

/**
 * The home page's prompt cards — the agent, the analyst and the Combo
 * Builder across the top (one column on mobile). Also reused as the
 * quick-actions block inside the mobile nav sheet; with Combos and Agent
 * gone from the header, these cards are their front door.
 */
export function HomePromptRow({ onPromptSelect, columns = "responsive" }: Props) {
  const gridCols = columns === "single" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3";
  return (
    <div className={`grid ${gridCols} gap-3`}>
      {PROMPTS.map((p) => {
        const Icon = p.icon;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onPromptSelect(p.id);
            }}
            className="bg-bg-elev border border-border-soft rounded-md p-4 min-h-[105px] cursor-pointer flex flex-col justify-between transition-all text-left hover:border-accent hover:bg-row-hover"
          >
            <div className="text-[13px] leading-snug text-text">{p.title}</div>
            <div className="text-text-dim mt-6">
              <Icon className="h-4 w-4" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
