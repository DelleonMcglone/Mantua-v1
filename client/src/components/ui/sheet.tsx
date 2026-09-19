/* eslint-disable react-refresh/only-export-components -- Radix dialog wrappers: re-exported parts + components co-located by design. */
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ComponentRef, HTMLAttributes } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.ts";

/**
 * Sheet — a slide-in side panel built on the same Radix Dialog primitive
 * as `ui/dialog.tsx` (no new dependency). Focus trap, Escape-to-close,
 * and overlay-click-to-close all come from Radix. Used for the mobile
 * hamburger navigation (design guidance: hidden sidebar + hamburger on
 * narrow viewports) and available for the PD-007 right-panel collapse.
 *
 * Keyframes `sheet-in-left` / `sheet-in-right` / `sheet-in-bottom` live in
 * `index.css`. `side="bottom"` is the mobile confirm surface (task 071).
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetPortal = DialogPrimitive.Portal;
export const SheetClose = DialogPrimitive.Close;

export const SheetOverlay = forwardRef<
  ComponentRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/70 backdrop-blur-sm", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const SIDE_CLASSES = {
  left: "inset-y-0 left-0 h-full w-3/4 max-w-xs border-r p-5 data-[state=open]:animate-[sheet-in-left_200ms_ease-out]",
  right:
    "inset-y-0 right-0 h-full w-3/4 max-w-xs border-l p-5 data-[state=open]:animate-[sheet-in-right_200ms_ease-out]",
  /**
   * Task 071 (MX-002) — the bottom sheet: full width, capped at 92% of the
   * dynamic viewport so the page peeks above it, rounded top corners, a
   * drag-handle affordance, and bottom padding that clears the home
   * indicator on notched phones (`safe-area-inset-bottom`).
   */
  bottom:
    "inset-x-0 bottom-0 max-h-[92dvh] w-full rounded-t-[var(--radius)] border-t px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] data-[state=open]:animate-[sheet-in-bottom_220ms_ease-out]",
} as const;

export interface SheetContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Which edge the panel slides in from. */
  side?: "left" | "right" | "bottom";
}

export const SheetContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "left", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-side={side}
      className={cn(
        "fixed z-50 flex flex-col overflow-y-auto overscroll-contain",
        "border-border-soft bg-panel-solid shadow-2xl outline-none",
        SIDE_CLASSES[side],
        className,
      )}
      {...props}
    >
      {side === "bottom" && (
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-border" />
      )}
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 text-text-mute hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

export const SheetTitle = forwardRef<
  ComponentRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-[15px] font-semibold tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-text-dim", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
