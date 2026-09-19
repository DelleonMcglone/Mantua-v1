import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet.tsx";

/**
 * Task 071 (MX-002) — the ticket as a bottom sheet below `lg`. The same
 * `TradeTicket` the desktop sidebar renders, slid up over the list so the
 * Confirm button sits in the thumb zone and the price the user just
 * tapped stays visible above. Escape, the overlay and the handle close it;
 * a "Trade executed" card stays until the user is done with it.
 */
export function TradeSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined} data-testid="trade-sheet">
        <SheetTitle className="sr-only">Trade</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
