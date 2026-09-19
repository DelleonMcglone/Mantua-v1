import { Section } from "./PublicAgentTables.tsx";
import { metricRows, riskRows, shortDigest, type PublicAgent } from "./reputation-core.ts";

/**
 * Task 070 / AE-012 — the tiles, the risk block, the agent's posts and the
 * digest footer of the public performance page. Pure rendering over
 * `reputation-core.ts`; the two tables are in `PublicAgentTables.tsx`.
 */

const TONE = { up: "text-green", down: "text-red", flat: "text-text" } as const;

export function MetricTiles({ agent }: { agent: PublicAgent }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {metricRows(agent).map((r) => (
        <div key={r.label} className="rounded-md border border-border-soft px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-text-mute">{r.label}</div>
          <div className={`mt-1 font-mono text-[15px] ${TONE[r.tone]}`}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function RiskBlock({ agent }: { agent: PublicAgent }) {
  return (
    <Section title="Risk">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
        {riskRows(agent).map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-text-dim">{r.label}</dt>
            <dd className="text-right font-mono">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function PublicVoice({ agent }: { agent: PublicAgent }) {
  return (
    <Section title="Public voice" note="What this agent has posted, most recent first.">
      {agent.posts.length === 0 ? (
        <p className="text-[13px] text-text-dim">No posts yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {agent.posts.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-border-soft px-4 py-3 text-[13px]"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {p.text}
              <div className="mt-1.5 text-[11px] text-text-mute">
                {p.template.replace(/_/g, " ")} · {p.postedAt.slice(0, 16).replace("T", " ")} UTC
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DigestFooter({ agent }: { agent: PublicAgent }) {
  return (
    <p className="text-[11px] text-text-mute">
      Ledger digest{" "}
      <span className="font-mono" title={agent.ledger.digest}>
        {shortDigest(agent.ledger.digest)}
      </span>{" "}
      over every fill and simulation · computed {agent.computedAt.slice(0, 19).replace("T", " ")}{" "}
      UTC · derived from chain-verified fills and market resolutions; nothing here can be edited.
      Not betting advice.
    </p>
  );
}
