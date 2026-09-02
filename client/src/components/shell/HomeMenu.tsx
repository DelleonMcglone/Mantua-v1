import { ArrowUpDown, BarChart3, Bot, Droplet } from "lucide-react";

export type HomePromptId = "pool" | "swap" | "analyze" | "agent";

const PROMPTS: { id: HomePromptId; title: string; icon: typeof Droplet }[] = [
  { id: "agent", title: "Create / Manage Circle Agent", icon: Bot },
  {
    id: "analyze",
    title: "Analyze today's games, matchups, and markets",
    icon: BarChart3,
  },
  { id: "swap", title: "Swap stablecoins or bridge USDC to another network", icon: ArrowUpDown },
  { id: "pool", title: "Create / Add Liquidity with Stable protection", icon: Droplet },
];

interface Props {
  onPromptSelect: (id: HomePromptId) => void;
}

/**
 * The home page's prompt cards — a single row across the top (wrapping to
 * two columns on small screens), ordered agent → analyze → swap →
 * liquidity. Replaces the old 2x2 grid that lived inside the right-column
 * "Ask Mantua" panel.
 */
export function HomePromptRow({ onPromptSelect }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
