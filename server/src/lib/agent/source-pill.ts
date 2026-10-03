/**
 * The provider name a source pill shows for a paid x402 call, taken from
 * the service URL's host ("api.exa.ai" → "Exa"). Mantua's own tools are
 * labelled on the client; this covers the long tail of marketplace hosts.
 */
export function providerLabel(service: unknown): string {
  if (typeof service !== "string") return "Paid service";
  try {
    const host = new URL(service).hostname.replace(/^www\./, "").replace(/^api\./, "");
    const name = host.split(".")[0] ?? host;
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Paid service";
  } catch {
    return "Paid service";
  }
}
