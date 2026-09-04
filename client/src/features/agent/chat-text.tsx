import { type ReactNode } from "react";
import { BASE_CHAIN_ID, getExplorerAddressUrl } from "@/lib/chains.ts";
import { ExternalLink } from "lucide-react";
import { shortAddr } from "./agent-gate.tsx";
import { CopyButton } from "./agent-primitives.tsx";

/**
 * Shared chat-text primitives used by both the wallet agent
 * (CircleAgentChat) and the analyze research thread (AnalyzePanel):
 * the user message bubble, a plain-prose renderer with clickable links +
 * copyable addresses, and the streaming caret.
 */

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="self-end max-w-[85%]">
      <div className="whitespace-pre-wrap rounded-md bg-accent px-3 py-2 text-[13px] text-white">
        {text}
      </div>
    </div>
  );
}

/** Inline EVM address — short form, copy button, and a BaseScan link. */
export function AddressInline({ addr }: { addr: string }) {
  const chainId = BASE_CHAIN_ID;
  const url = getExplorerAddressUrl(chainId, addr);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-border-soft bg-bg-elev px-[7px] py-px align-baseline">
      <span className="mono text-[12px]">{shortAddr(addr)}</span>
      <CopyButton value={addr} label="Copy address" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-dim no-underline"
        aria-label="View on explorer"
      >
        <ExternalLink className="h-[11px] w-[11px]" aria-hidden />
      </a>
    </span>
  );
}

/**
 * Render assistant text as plain prose with clickable links and copyable
 * addresses. The model is told to avoid Markdown, but we defensively unwrap any
 * stray **bold** (showing the inner text, no asterisks), turn full URLs into
 * links, and turn 0x addresses into copy + BaseScan chips.
 */
export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|(https?:\/\/[^\s<>()]+)|(0x[a-fA-F0-9]{40})/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const whole = m[0];
    if (whole.startsWith("**")) {
      // Stray **bold** — show the inner text, drop the asterisks.
      nodes.push(<span key={key++}>{whole.slice(2, -2)}</span>);
    } else if (whole.startsWith("0x")) {
      nodes.push(<AddressInline key={key++} addr={whole} />);
    } else {
      let url = whole;
      let suffix = "";
      const trail = /[.,;:!?)]+$/.exec(url);
      if (trail) {
        suffix = trail[0];
        url = url.slice(0, -suffix.length);
      }
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent no-underline"
        >
          {url}
        </a>,
      );
      if (suffix) nodes.push(suffix);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

export function Caret() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-[blink_1s_steps(2)_infinite] bg-text-dim align-text-bottom" />
  );
}
