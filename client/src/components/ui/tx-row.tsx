import { Copy, ExternalLink } from "lucide-react";

/**
 * Transaction hash chip — mono hash, copy button, and an optional
 * explorer link. Promoted out of `features/agent/agent-primitives.tsx`
 * (B-015) so non-agent surfaces can render a tx receipt the same way.
 */
export function TxRow({
  hash,
  explorerUrl,
  showCopy = true,
}: {
  hash: string;
  explorerUrl?: string;
  showCopy?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded-sm border border-border-soft bg-bg-elev px-3 py-2 text-[12px]">
      <span className="mono flex-1 text-text-dim">{hash}</span>
      {showCopy && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(hash);
          }}
          className="bg-transparent border-none p-0 cursor-pointer text-text-dim"
          aria-label="Copy hash"
        >
          <Copy className="h-3 w-3" aria-hidden />
        </button>
      )}
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-text-dim no-underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden /> Explorer
        </a>
      )}
    </div>
  );
}
