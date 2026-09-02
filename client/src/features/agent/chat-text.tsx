import { type ReactNode } from "react";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { getExplorerAddressUrl } from "@/lib/chains.ts";
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
    <div style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
      <div
        style={{
          background: "var(--accent)",
          color: "#fff",
          borderRadius: 12,
          padding: "8px 12px",
          fontSize: 13,
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** Inline EVM address — short form, copy button, and a BaseScan link. */
export function AddressInline({ addr }: { addr: string }) {
  const chainId = useCurrentChainId();
  const url = getExplorerAddressUrl(chainId, addr);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "1px 7px",
        borderRadius: 7,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        verticalAlign: "baseline",
      }}
    >
      <span className="mono" style={{ fontSize: 12 }}>
        {shortAddr(addr)}
      </span>
      <CopyButton value={addr} label="Copy address" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--text-dim)", textDecoration: "none", fontSize: 11 }}
        aria-label="View on explorer"
      >
        ↗
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
          style={{ color: "var(--accent)", textDecoration: "none" }}
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
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 14,
        marginLeft: 2,
        verticalAlign: "text-bottom",
        background: "var(--text-dim)",
        animation: "blink 1s steps(2) infinite",
      }}
    />
  );
}
