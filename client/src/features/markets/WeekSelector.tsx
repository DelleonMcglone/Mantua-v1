import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import type { WeekOption } from "./week-options.ts";

/** The league page's week picker (a dropdown of `buildWeekOptions`). */
export function WeekSelector({
  options,
  active,
  onSelect,
}: {
  options: WeekOption[];
  active: WeekOption;
  onSelect: (option: WeekOption) => void;
}) {
  return (
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
  );
}
