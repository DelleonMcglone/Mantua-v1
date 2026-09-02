/**
 * Read a Vite client env var defensively.
 *
 * Vite inlines `import.meta.env.VITE_*` values verbatim at build time, so a
 * value entered into the host's env UI *with surrounding quotes* (e.g.
 * `VITE_PRIVY_APP_ID="cmof…"` pasted from a .env line) or with a stray
 * trailing newline is inlined with that junk attached — `"cmof…"` or
 * `cmof…\n` rather than `cmof…`. That silently breaks consumers; in Privy's
 * case it throws "invalid Privy app ID" during render and blanks the whole
 * app. We strip wrapping quotes, escaped-whitespace sequences, and
 * surrounding whitespace so a dirty value behaves the same as a clean one.
 *
 * Pass the inlined value directly (`cleanEnv(import.meta.env.VITE_FOO)`) so
 * Vite's static replacement / tree-shaking still applies.
 */
export function cleanEnv(raw: string | undefined): string {
  if (raw == null) return "";
  let v = raw;
  // Drop literal escaped-whitespace sequences (\n \r \t) that sneak in when a
  // value is pasted from a quoted/JSON string into the host's env UI.
  v = v.replace(/\\[nrt]/g, "");
  v = v.trim();
  // Strip one layer of matching wrapping quotes.
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    v = v.slice(1, -1);
  }
  // Final pass: shave any leftover surrounding whitespace or quotes (real
  // newlines, NBSP, etc. are covered by \s).
  v = v.replace(/^[\s"']+|[\s"']+$/g, "");
  return v;
}
