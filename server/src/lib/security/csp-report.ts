/**
 * Task 067 — reduces a browser CSP violation report to one bounded log
 * line. Accepts both wire shapes browsers send to `report-uri`: the legacy
 * `{ "csp-report": { … } }` object and the Reporting API array of
 * `{ type: "csp-violation", body: { … } }`. Anything else is dropped.
 */
export interface CspViolation {
  documentUri: string;
  blockedUri: string;
  effectiveDirective: string;
  sourceFile: string | null;
}

const MAX = 200;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX) : null;
}

function pick(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const s = str(body[k]);
    if (s) return s;
  }
  return null;
}

function fromBody(body: unknown): CspViolation | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const documentUri = pick(b, "document-uri", "documentURL");
  const effectiveDirective = pick(
    b,
    "effective-directive",
    "effectiveDirective",
    "violated-directive",
  );
  if (!documentUri || !effectiveDirective) return null;
  return {
    documentUri,
    blockedUri: pick(b, "blocked-uri", "blockedURL") ?? "(none)",
    effectiveDirective,
    sourceFile: pick(b, "source-file", "sourceFile"),
  };
}

/** Every violation the request carried, in order; empty when malformed. */
export function summarizeCspReports(payload: unknown): CspViolation[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((r): r is { type?: unknown; body?: unknown } => typeof r === "object" && r !== null)
      .filter((r) => r.type === "csp-violation")
      .map((r) => fromBody(r.body))
      .filter((v): v is CspViolation => v !== null);
  }
  if (typeof payload === "object" && payload !== null && "csp-report" in payload) {
    const one = fromBody(payload["csp-report"]);
    return one ? [one] : [];
  }
  return [];
}
