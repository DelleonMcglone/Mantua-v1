/* eslint-disable react-refresh/only-export-components -- UI primitive: component + its cva variants live together by design. */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.ts";

/**
 * Button variants extracted from prototype patterns:
 *  - primary: filled accent purple — main CTAs (Connect Wallet, Confirm)
 *  - ghost: transparent with border — secondary actions
 *  - chip: pill-shaped, 12px text — filter/sort selectors, network picker
 *  - icon: 36×36 square, transparent — header icon buttons
 *  - destructive: filled red — irreversible actions
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent/90 active:bg-accent/95",
        ghost: "bg-transparent border border-border text-text-dim hover:bg-bg-elev hover:text-text",
        chip: "bg-bg-elev border border-border text-text-dim hover:text-text rounded-full",
        icon: "bg-transparent border border-border text-text-dim hover:text-text rounded-sm",
        destructive: "bg-red text-white hover:bg-red/90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm rounded-sm",
        lg: "h-11 px-6 text-base rounded-md",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
