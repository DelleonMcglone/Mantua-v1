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
 * Keyframes `sheet-in-left` / `sheet-in-right` live in `index.css`.
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
  left: "left-0 border-r data-[state=open]:animate-[sheet-in-left_200ms_ease-out]",
  right: "right-0 border-l data-[state=open]:animate-[sheet-in-right_200ms_ease-out]",
} as const;

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Which edge the panel slides in from. */
  side?: "left" | "right";
}

export const SheetContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "left", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 z-50 flex h-full w-3/4 max-w-xs flex-col overflow-y-auto",
        "border-border-soft bg-panel-solid p-5 shadow-2xl outline-none",
        SIDE_CLASSES[side],
        className,
      )}
      {...props}
    >
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
