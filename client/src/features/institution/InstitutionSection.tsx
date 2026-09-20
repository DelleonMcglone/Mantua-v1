import { usePrivy } from "@privy-io/react-auth";
import { Landmark } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { CustodyDestinations } from "./CustodyDestinations.tsx";
import { CustodyWithdrawals } from "./CustodyWithdrawals.tsx";
import { InstitutionReports } from "./InstitutionReports.tsx";
import { custodianLabel, limitsLine, shortAddress } from "./institution-core.ts";
import { post, useInstitution } from "./use-institution.ts";

/**
 * Task 074 / IC-002 — the Institution section of the profile, shown only
 * to members: the account, its custodian and limits, the caller's role,
 * whether their agent wallet sits in the institution's custody wallet set
 * (with the one-tap move when it does not), then destinations,
 * withdrawals and reports.
 */
export function InstitutionSection() {
  const { authenticated } = usePrivy();
  const { view, reload } = useInstitution(authenticated);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!authenticated || view === null || view === "none") return null;
  const { institution, me, wallet } = view;

  const move = async () => {
    setBusy(true);
    setNotice(await post("/api/institution/wallet/segregate", {}));
    setBusy(false);
    reload();
    window.dispatchEvent(new Event("mantua:refresh-portfolio"));
  };

  return (
    <section
      data-testid="institution"
      className="mt-3 rounded-md border border-border-soft px-4 py-3.5"
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-mute">
        <Landmark className="h-3.5 w-3.5" /> Institution
      </h3>
      <p className="mt-1.5 text-[13px] font-medium text-text">
        {institution.name}{" "}
        <span className="text-[11px] font-normal text-text-dim">
          · {institution.status} · you are {me.role}
        </span>
      </p>
      <p className="mt-0.5 text-[12px] text-text-dim">
        Principal custodied at {custodianLabel(institution)}; trading balances in a Circle wallet
        set of the institution&apos;s own.
      </p>
      <p className="mt-1 text-[11px] text-text-dim">{limitsLine(institution.limits)}</p>

      <div className="mt-2 rounded-md bg-bg-elev px-3 py-2 text-[12px]">
        {!institution.provisioned ? (
          <span className="text-text-dim">
            The custody wallet set is not provisioned yet — the operator does that first.
          </span>
        ) : wallet?.segregated ? (
          <span>
            Agent wallet <span className="font-mono">{shortAddress(wallet.address)}</span> is in the
            institution&apos;s custody set.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-text-dim">
              {wallet
                ? `Agent wallet ${shortAddress(wallet.address)} is outside the custody set. Sweep it, then move it.`
                : "No agent wallet yet — create it inside the custody set."}
            </span>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void move()}>
              {busy ? "Moving…" : wallet ? "Move wallet into custody" : "Create custody wallet"}
            </Button>
          </div>
        )}
        {notice && <p className="mt-1 text-[11px] text-text-dim">{notice}</p>}
      </div>

      <CustodyDestinations view={view} onChange={reload} />
      <CustodyWithdrawals view={view} />
      <InstitutionReports view={view} />
    </section>
  );
}
