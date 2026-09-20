import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { InstitutionView } from "./institution-core.ts";

/**
 * Task 074 / IC-001 — a trader's withdrawal request: USDC from their
 * institutional wallet to one of the verified custody destinations. The
 * threshold line says whether a second member will have to approve.
 */
export function WithdrawalRequestForm({
  view,
  busy,
  onSubmit,
}: {
  view: InstitutionView;
  busy: boolean;
  onSubmit: (body: { destinationId: string; symbol: "USDC"; amount: string }) => void;
}) {
  const verified = view.destinations.filter((d) => d.status === "verified");
  const threshold = view.institution.limits.approvalThresholdUsd;
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <form
      className="mt-1 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ destinationId, symbol: "USDC", amount });
      }}
    >
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-text-dim">To</span>
        <select
          className="h-9 rounded-md border border-border-soft bg-bg px-2 text-[12px]"
          value={destinationId}
          onChange={(e) => {
            setDestinationId(e.target.value);
          }}
        >
          <option value="">Choose a verified destination</option>
          {verified.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-text-dim">USDC</span>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
        />
      </label>
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={busy || !destinationId || !(Number(amount) > 0)}
      >
        Request
      </Button>
      <span className="text-[11px] text-text-dim">
        {threshold === 0
          ? "Every withdrawal is approved by a second member."
          : `From $${threshold.toLocaleString("en-US")} a second member approves.`}
      </span>
    </form>
  );
}
