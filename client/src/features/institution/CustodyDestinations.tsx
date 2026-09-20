import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  canVerify,
  hasPermission,
  shortAddress,
  type InstitutionView,
} from "./institution-core.ts";
import { post } from "./use-institution.ts";

/**
 * Task 074 / IC-001 — the withdrawal allowlist: the custodian's deposit
 * addresses. An admin adds one (pending); a different member with the
 * right verifies it; only verified destinations can receive funds.
 */
export function CustodyDestinations({
  view,
  onChange,
}: {
  view: InstitutionView;
  onChange: () => void;
}) {
  const { me, destinations } = view;
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setNotice(await post(path, body));
    setBusy(false);
    onChange();
  };

  return (
    <div className="mt-3" data-testid="custody-destinations">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
        Custody destinations
      </h4>
      {destinations.length === 0 ? (
        <p className="mt-1 text-[12px] text-text-dim">
          None yet. Withdrawals can only go to a verified custodian address.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-[12px]">
          {destinations.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{d.label}</span>{" "}
                <span className="font-mono text-text-dim">{shortAddress(d.address)}</span>{" "}
                <span className="text-text-dim">· {d.status}</span>
              </span>
              <span className="flex gap-1">
                {canVerify(d, me) && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(`/api/institution/destinations/${d.id}/verify`, {})}
                  >
                    Verify
                  </Button>
                )}
                {d.status !== "revoked" && hasPermission(me, "manage_destinations") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(`/api/institution/destinations/${d.id}/revoke`, {})}
                  >
                    Revoke
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hasPermission(me, "manage_destinations") && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act("/api/institution/destinations", { label, address }).then(() => {
              setLabel("");
              setAddress("");
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-text-dim">Label</span>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
              }}
              placeholder="Anchorage deposit"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[12px]">
            <span className="text-text-dim">Address</span>
            <Input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
              }}
              placeholder="0x…"
            />
          </label>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={busy || label.length < 2 || !/^0x[a-fA-F0-9]{40}$/.test(address)}
          >
            Add (pending verification)
          </Button>
        </form>
      )}
      {notice && <p className="mt-1 text-[11px] text-text-dim">{notice}</p>}
    </div>
  );
}
