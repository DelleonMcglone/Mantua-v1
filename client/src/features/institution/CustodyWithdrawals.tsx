import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  hasPermission,
  withdrawalActions,
  withdrawalLine,
  type InstitutionView,
} from "./institution-core.ts";
import { post, useWithdrawals } from "./use-institution.ts";
import { WithdrawalRequestForm } from "./WithdrawalRequestForm.tsx";

/**
 * Task 074 / IC-001 — withdrawals under dual control: a trader asks for
 * USDC to go to a verified destination; a second member approves or
 * rejects when the amount reaches the threshold; the requester can cancel
 * their own pending request.
 */
export function CustodyWithdrawals({ view }: { view: InstitutionView }) {
  const { me } = view;
  const { rows, reload } = useWithdrawals(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setNotice(await post(path, body));
    setBusy(false);
    reload();
  };

  return (
    <div className="mt-3" data-testid="custody-withdrawals">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
        Withdrawals
      </h4>
      {hasPermission(me, "request_withdrawal") && (
        <WithdrawalRequestForm
          view={view}
          busy={busy}
          onSubmit={(body) => void act("/api/institution/withdrawals", body)}
        />
      )}
      {rows === null ? (
        <p className="mt-1 text-[12px] text-text-dim">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-[12px] text-text-dim">No withdrawals yet.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-[12px]">
          {rows.map((w) => {
            const actions = withdrawalActions(w, me);
            return (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {withdrawalLine(w)}
                  {w.lastError && <span className="text-text-dim"> · {w.lastError}</span>}
                </span>
                <span className="flex gap-1">
                  {actions.canDecide && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(`/api/institution/withdrawals/${w.id}/decide`, { approve: true })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act(`/api/institution/withdrawals/${w.id}/decide`, {
                            approve: false,
                          })
                        }
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {actions.canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void act(`/api/institution/withdrawals/${w.id}/cancel`, {})}
                    >
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className="mt-1 text-[11px] text-text-dim">{notice}</p>}
    </div>
  );
}
