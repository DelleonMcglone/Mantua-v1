/**
 * Task 074 (Phase 18) — the institutional tier's pure client helpers:
 * the shapes `/api/institution*` returns, the labels, and who may act on
 * what (mirroring the server's dual-control rules for the buttons only —
 * the server decides). Relative imports only so the node:test suite can
 * load it without the Vite alias.
 */

export type Permission =
  | "view_reports"
  | "trade"
  | "request_withdrawal"
  | "approve_withdrawal"
  | "manage_members"
  | "manage_destinations"
  | "verify_destination"
  | "manage_limits";

export interface InstitutionLimits {
  perTradeCapUsd: number;
  dailyCapUsd: number;
  approvalThresholdUsd: number;
}

export interface Destination {
  id: string;
  label: string;
  address: string;
  chainId: number;
  status: string;
  addedBy: string;
  verifiedBy: string | null;
}

export interface Member {
  id: string;
  userId: string;
  role: string;
  status: string;
  address: string | null;
  email: string | null;
  since: string;
}

export interface InstitutionView {
  institution: {
    id: string;
    slug: string;
    name: string;
    status: string;
    custodian: string;
    custodianLabel: string | null;
    provisioned: boolean;
    limits: InstitutionLimits;
  };
  me: { userId: string; role: string; permissions: Permission[] };
  wallet: { address: string; segregated: boolean } | null;
  destinations: Destination[];
  members: Member[] | null;
}

export interface Withdrawal {
  id: string;
  requestedBy: string;
  walletAddress: string;
  destination: string;
  symbol: string;
  amount: string;
  usdValue: string;
  status: string;
  txHash: string | null;
  reason: string | null;
  lastError: string | null;
  createdAt: string;
}

export const CUSTODIAN_LABELS: Partial<Record<string, string>> = {
  anchorage: "Anchorage Digital",
  bitgo: "BitGo",
  coinbase_prime: "Coinbase Prime",
  fireblocks: "Fireblocks",
  copper: "Copper",
  other: "Qualified custodian",
};

export const WITHDRAWAL_STATUS: Partial<Record<string, string>> = {
  pending: "awaiting approval",
  approved: "approved",
  executing: "sending",
  executed: "sent",
  failed: "failed",
  rejected: "rejected",
  expired: "expired",
  cancelled: "cancelled",
};

export function custodianLabel(view: InstitutionView["institution"]): string {
  return view.custodianLabel ?? CUSTODIAN_LABELS[view.custodian] ?? view.custodian;
}

export function hasPermission(me: InstitutionView["me"], p: Permission): boolean {
  return me.permissions.includes(p);
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function usdLabel(n: number | string): string {
  return `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function limitsLine(l: InstitutionLimits): string {
  const approval =
    l.approvalThresholdUsd === 0
      ? "every withdrawal needs a second approver"
      : `withdrawals from ${usdLabel(l.approvalThresholdUsd)} need a second approver`;
  return `${usdLabel(l.perTradeCapUsd)} per trade · ${usdLabel(l.dailyCapUsd)} a day across the institution · ${approval}`;
}

export function withdrawalLine(w: Withdrawal): string {
  return `${w.amount} ${w.symbol} → ${w.destination} · ${WITHDRAWAL_STATUS[w.status] ?? w.status}`;
}

/** The buttons a withdrawal row shows the caller; the server re-checks. */
export function withdrawalActions(
  w: Withdrawal,
  me: InstitutionView["me"],
): { canDecide: boolean; canCancel: boolean } {
  const pending = w.status === "pending";
  return {
    canDecide: pending && hasPermission(me, "approve_withdrawal") && w.requestedBy !== me.userId,
    canCancel: pending && w.requestedBy === me.userId,
  };
}

/** Verification is a second person's act; the adder never sees the button. */
export function canVerify(d: Destination, me: InstitutionView["me"]): boolean {
  return (
    d.status === "pending" && hasPermission(me, "verify_destination") && d.addedBy !== me.userId
  );
}

export const RECONCILE_LABELS: Partial<Record<string, string>> = {
  matched: "Circle and the chain agree",
  drift: "Circle and the chain disagree — ask the operator",
  unavailable: "one side could not be read",
};
