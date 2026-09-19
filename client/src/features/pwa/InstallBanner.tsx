import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { INSTALL_COPY } from "./install-core.ts";
import { useInstallPrompt } from "./use-install-prompt.ts";

/**
 * Task 071 (MX-007) — the one-line "add to home screen" offer above the
 * dock. Renders nothing until `install-core.ts` says the offer is earned
 * and welcome; both buttons meet the 44 px touch target.
 */
export function InstallBanner() {
  const { offer, install, dismiss } = useInstallPrompt();
  if (offer === "none") return null;
  const copy = INSTALL_COPY[offer];
  return (
    <div
      role="region"
      aria-label="Install Mantua"
      data-testid="install-banner"
      className="mx-3 mb-2 flex items-center gap-3 rounded-md border border-border-soft bg-bg-elev px-3 py-2.5 md:hidden"
    >
      <Smartphone className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{copy.title}</p>
        <p className="text-[12px] leading-snug text-text-dim">{copy.body}</p>
      </div>
      <Button size="sm" className="h-11 shrink-0 px-4" onClick={install}>
        {copy.action}
      </Button>
      <button
        type="button"
        aria-label="Not now"
        onClick={dismiss}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-mute hover:text-text cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
