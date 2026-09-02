/* eslint-disable react-refresh/only-export-components -- context module: Provider component + useConfirmedAction hook live together. */
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";

/**
 * P1-005 — `useConfirmedAction` is the single architectural seam between any
 * UI button click and an on-chain transaction. Every Phase 3+ write path
 * MUST call `confirm()` and wait for user assent before executing. There is
 * no other path from "user clicks" to "tx submitted".
 *
 * Usage:
 *   const confirm = useConfirmedAction();
 *   const onSwap = async () => {
 *     const ok = await confirm({
 *       title: "Swap 0.5 ETH for USDC",
 *       description: "Expected output: 1,815.42 USDC. Slippage 0.5%.",
 *       severity: "default",        // "default" | "warning" | "danger"
 *       confirmLabel: "Sign & swap",
 *     });
 *     if (!ok) return;
 *     await submitSwap(...);
 *   };
 */

export type ConfirmSeverity = "default" | "warning" | "danger";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  severity?: ConfirmSeverity;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * If true, the user must confirm twice (1–5% slippage, daily cap raise, etc.)
   * — see P1-004 / P1-003 for cases where this is required.
   */
  doubleConfirm?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [doubleConfirmed, setDoubleConfirmed] = useState(false);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDoubleConfirmed(false);
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    setDoubleConfirmed(false);
  };

  const handleConfirm = () => {
    if (pending?.doubleConfirm && !doubleConfirmed) {
      setDoubleConfirmed(true);
      return;
    }
    close(true);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.description && <DialogDescription>{pending.description}</DialogDescription>}
          </DialogHeader>
          {pending?.doubleConfirm && doubleConfirmed && (
            <p className="text-sm text-amber">Are you sure? Click confirm again to proceed.</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                close(false);
              }}
            >
              {pending?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={pending?.severity === "danger" ? "destructive" : "primary"}
              onClick={handleConfirm}
            >
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirmedAction() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirmedAction must be used inside <ConfirmProvider>");
  return ctx;
}
