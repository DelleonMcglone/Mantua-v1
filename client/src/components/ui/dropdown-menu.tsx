/* eslint-disable react-refresh/only-export-components -- Radix dropdown wrappers: re-exported parts + components co-located by design. */
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils.ts";

/**
 * Shared dropdown primitive (Radix `dropdown-menu`), styled with Mantua
 * tokens. Radix supplies the a11y the hand-rolled dropdowns lacked: menu
 * roles, arrow-key navigation, typeahead, Escape-to-close, outside-click
 * dismissal, and focus return to the trigger.
 *
 * Trigger styling is left to the call site (`asChild` on the trigger is
 * the common pattern); Content/Item carry the app's popover look.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuLabel = DropdownMenuPrimitive.Label;

export const DropdownMenuContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-30 min-w-[160px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto",
        "bg-panel-solid border border-border rounded-md p-1 shadow-xl",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "flex w-full items-center gap-2 px-2.5 py-2 rounded-xs text-left text-[13px] text-text",
      "cursor-pointer select-none outline-none",
      "data-[highlighted]:bg-row-hover",
      "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-border-soft", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
