import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { MarketNav, type NavDestination } from "./MarketNav.tsx";
import { HomePromptRow, type HomePromptId } from "./HomeMenu.tsx";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Same handler the header nav uses — league pages, combos, agent. */
  onNavigate: (destination: NavDestination) => void;
  /** Quick actions (the home prompt cards). Omitted when the caller has
   *  no route for them — the section simply doesn't render. */
  onQuickAction?: ((id: HomePromptId) => void) | undefined;
}

/**
 * B-014 — the hidden-sidebar navigation for narrow viewports. Opens from
 * the header's hamburger button (below `md`) as a left slide-in sheet
 * carrying the exact same `MarketNav` destinations as the desktop header
 * row, plus the `HomePromptRow` quick actions, both single-column per
 * the mobile design guidance. Focus trap, Escape, and overlay-close come
 * from Radix via `ui/sheet.tsx`. Every action closes the sheet before
 * routing so the destination is visible immediately.
 */
export function MobileNavSheet({ open, onOpenChange, onNavigate, onQuickAction }: Props) {
  const close = () => {
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <MarketNav
          layout="column"
          className="mt-4"
          onNavigate={(destination) => {
            close();
            onNavigate(destination);
          }}
        />
        {onQuickAction && (
          <div className="mt-6">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-mute">
              Quick actions
            </p>
            <HomePromptRow
              columns="single"
              onPromptSelect={(id) => {
                close();
                onQuickAction(id);
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
