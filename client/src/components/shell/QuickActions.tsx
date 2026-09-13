import { ArrowUpDown, BarChart3, Bot, Droplet, LineChart, Wallet } from "lucide-react";
import type { QuickAction, QuickActionId } from "@/lib/quick-actions.ts";

const ICONS: Record<QuickActionId, typeof Droplet> = {
  trade: LineChart,
  analyze: BarChart3,
  swap: ArrowUpDown,
  "add-liquidity": Droplet,
  portfolio: Wallet,
  agent: Bot,
};

/**
 * T-016 — contextual quick-action chips above the dock. Each chip submits
 * its natural-language command through the same handler the user types
 * into, so the conversational surface stays primary (T-015) and every
 * chip exercises intent switching (T-017).
 */
export function QuickActions({
  actions,
  onPick,
}: {
  actions: QuickAction[];
  onPick: (command: string) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div
      aria-label="Quick actions"
      className="flex gap-1.5 overflow-x-auto px-5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {actions.map((a) => {
        const Icon = ICONS[a.id];
        return (
          <button
            key={a.id}
            type="button"
            data-quick-action={a.id}
            onClick={() => {
              onPick(a.command);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-soft bg-chip px-3 py-1.5 text-[12px] font-medium text-text-dim transition-colors hover:border-accent hover:text-text cursor-pointer"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
