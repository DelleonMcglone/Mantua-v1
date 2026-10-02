import { ArrowDownUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { stepWeek, type GameOrder } from "./game-order.ts";
import type { WeekOption } from "./week-options.ts";

const STEP_CLASS =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-chip text-text transition-colors hover:bg-accent/20 cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-chip";

/**
 * The league page's list controls: step to the previous or next week, pick
 * any week from the dropdown, and flip the order the games run in.
 */
export function WeekSelector({
  options,
  active,
  onSelect,
  order,
  onToggleOrder,
}: {
  options: WeekOption[];
  active: WeekOption;
  onSelect: (option: WeekOption) => void;
  order: GameOrder;
  onToggleOrder: () => void;
}) {
  const previous = stepWeek(options, active, -1);
  const next = stepWeek(options, active, 1);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        aria-label="Previous week"
        disabled={!previous}
        onClick={() => {
          if (previous) onSelect(previous);
        }}
        className={STEP_CLASS}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-chip px-4 py-2 text-[13px] font-medium text-text hover:bg-accent/20 transition-colors cursor-pointer"
          >
            {active.label}
            <ChevronDown className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.dates}
              onSelect={() => {
                onSelect(option);
              }}
              className={`justify-between px-3.5 ${
                option.dates === active.dates ? "font-semibold text-text" : "text-text-dim"
              }`}
            >
              {option.label}
              {option.dates === active.dates && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Next week"
        disabled={!next}
        onClick={() => {
          if (next) onSelect(next);
        }}
        className={STEP_CLASS}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleOrder}
        aria-label={`Game order: ${order === "earliest" ? "earliest first" : "latest first"}. Switch.`}
        className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-2 text-[13px] font-medium text-text transition-colors hover:bg-accent/20 cursor-pointer"
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
        {order === "earliest" ? "Earliest first" : "Latest first"}
      </button>
    </div>
  );
}
