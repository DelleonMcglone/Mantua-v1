/**
 * Task 067 (G-014) — the legal documents' current versions and the pure
 * acceptance logic. The client mirrors `TERMS_VERSION` in
 * `client/src/lib/legal-version.ts`; both change together with the
 * effective date on the published page.
 */

export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Effective 2026-09-13: fee model, dispute window, in-play trading,
 *  sponsored transactions, agent autonomy, bank rails. */
export const TERMS_VERSION = "2026-09-13";
export const PRIVACY_VERSION = "2026-09-13";

export const CURRENT_VERSIONS: Record<LegalDoc, string> = {
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
};

export function isLegalDoc(value: unknown): value is LegalDoc {
  return typeof value === "string" && (LEGAL_DOCS as readonly string[]).includes(value);
}

export interface AcceptanceRow {
  doc: string;
  version: string;
  acceptedAt: Date;
}

export interface AcceptanceStatus {
  doc: LegalDoc;
  /** The version the product currently asks for. */
  version: string;
  /** The newest version this user accepted, or null. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** True when the accepted version is the current one. */
  current: boolean;
}

/** The user's standing against the current version of one document. */
export function acceptanceStatus(doc: LegalDoc, rows: readonly AcceptanceRow[]): AcceptanceStatus {
  const version = CURRENT_VERSIONS[doc];
  const mine = rows.filter((r) => r.doc === doc);
  const newest = mine.reduce<AcceptanceRow | null>(
    (best, r) => (best === null || r.version > best.version ? r : best),
    null,
  );
  return {
    doc,
    version,
    acceptedVersion: newest?.version ?? null,
    acceptedAt: newest ? newest.acceptedAt.toISOString() : null,
    current: newest?.version === version,
  };
}
