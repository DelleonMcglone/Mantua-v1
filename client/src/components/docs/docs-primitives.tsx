import type { ReactNode } from "react";

/**
 * Presentational primitives for documentation pages — paragraph,
 * heading, lists, inline code, links, hint callouts, reference tables.
 *
 * They live apart from `docs-content.tsx` so that file exports only
 * data: a module that mixes component and non-component exports breaks
 * fast refresh, and the lint config treats that as an error.
 */

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-text-dim">{children}</p>;
}

export function H({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 text-[17px] font-semibold tracking-tight text-text">{children}</h2>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc list-outside space-y-2 pl-5 text-[14px] leading-relaxed text-text-dim marker:text-text-mute">
      {children}
    </ul>
  );
}

export function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal list-outside space-y-2 pl-5 text-[14px] leading-relaxed text-text-dim marker:text-text-mute">
      {children}
    </ol>
  );
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-text">{children}</strong>;
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] border border-border-soft bg-chip px-1.5 py-0.5 font-mono text-[12px] text-text">
      {children}
    </code>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline hover:text-accent-2"
    >
      {children}
    </a>
  );
}

/** Highlighted aside — GitBook's "hint" block. */
export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      className={`mt-5 rounded-md border-l-2 px-4 py-3 text-[13.5px] leading-relaxed ${
        tone === "warn"
          ? "border-l-amber bg-amber/5 text-text-dim"
          : "border-l-accent bg-accent/5 text-text-dim"
      }`}
    >
      {children}
    </div>
  );
}

/** Simple two-or-more column reference table. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-md border border-border-soft">
      <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border-soft bg-panel-solid">
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5 font-semibold text-text">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border-soft last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2.5 align-top text-text-dim">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
