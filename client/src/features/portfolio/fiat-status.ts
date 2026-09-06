export type FiatTransferStatus = "pending" | "processing" | "complete" | "failed" | "canceled";

export const FIAT_STATUSES: readonly FiatTransferStatus[] = [
  "pending",
  "processing",
  "complete",
  "failed",
  "canceled",
];

/** User-facing status labels. Chainless by design (F-005): dollars and
 * clear status only — no wallet/bridge/gas/network vocabulary. */
export function fiatStatusLabel(status: FiatTransferStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "complete":
      return "Complete";
    case "failed":
      return "Needs attention";
    case "canceled":
      return "Canceled";
  }
}

export function fiatStatusClass(status: FiatTransferStatus): string {
  switch (status) {
    case "complete":
      return "text-green";
    case "failed":
      return "text-red";
    case "canceled":
      return "text-text-mute";
    default:
      return "text-amber";
  }
}
