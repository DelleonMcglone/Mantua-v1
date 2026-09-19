import { Input } from "@/components/ui/input.tsx";
import {
  describeCadence,
  handleProblem,
  POST_TEMPLATES,
  TEMPLATE_INFO,
  toggleTemplate,
  type PostingPolicy,
} from "./social-core.ts";

/**
 * Task 070 / AE-001, AE-006 — the two controlled forms of the social
 * panel: who the agent is in public, and what it may post. Pure
 * rendering over the panel's state; the panel owns the save.
 */

export interface IdentityValues {
  handle: string;
  displayName: string;
  bio: string;
  isPublic: boolean;
}

export function IdentityForm({
  value,
  onChange,
}: {
  value: IdentityValues;
  onChange: (next: IdentityValues) => void;
}) {
  const problem = handleProblem(value.handle);
  return (
    <>
      <label className="text-[12.5px] flex flex-col gap-1">
        <span className="text-text-dim">Handle (public URL /agents/…)</span>
        <Input
          value={value.handle}
          onChange={(e) => {
            onChange({ ...value, handle: e.target.value.toLowerCase() });
          }}
          placeholder="sideline_sage"
          maxLength={24}
        />
        {value.handle && problem && <span className="text-[11px] text-red">{problem}</span>}
      </label>
      <label className="text-[12.5px] flex flex-col gap-1">
        <span className="text-text-dim">Display name</span>
        <Input
          value={value.displayName}
          onChange={(e) => {
            onChange({ ...value, displayName: e.target.value });
          }}
          maxLength={48}
        />
      </label>
      <label className="text-[12.5px] flex flex-col gap-1">
        <span className="text-text-dim">Bio</span>
        <Input
          value={value.bio}
          onChange={(e) => {
            onChange({ ...value, bio: e.target.value });
          }}
          maxLength={280}
        />
      </label>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={value.isPublic}
          onChange={(e) => {
            onChange({ ...value, isPublic: e.target.checked });
          }}
        />{" "}
        Public performance page
      </label>
    </>
  );
}

const CADENCE_FIELDS: {
  key: "maxPostsPerHour" | "maxPostsPerDay" | "minMinutesBetween";
  label: string;
  max: number;
}[] = [
  { key: "maxPostsPerHour", label: "Max per hour", max: 12 },
  { key: "maxPostsPerDay", label: "Max per day", max: 48 },
  { key: "minMinutesBetween", label: "Minutes between posts", max: 1440 },
];

export function PostingForm({
  policy,
  onChange,
}: {
  policy: PostingPolicy;
  onChange: (next: PostingPolicy) => void;
}) {
  return (
    <>
      {POST_TEMPLATES.map((t) => (
        <label key={t} className="flex items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={policy.templates.includes(t)}
            onChange={() => {
              onChange({ ...policy, templates: toggleTemplate(policy.templates, t) });
            }}
          />
          <span>
            <span className="font-medium">{TEMPLATE_INFO[t].label}</span> —{" "}
            <span className="text-text-dim">{TEMPLATE_INFO[t].description}</span>
          </span>
        </label>
      ))}
      {CADENCE_FIELDS.map((f) => (
        <label key={f.key} className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="text-text-dim">{f.label}</span>
          <Input
            type="number"
            min={0}
            max={f.max}
            className="w-24"
            value={policy[f.key]}
            onChange={(e) => {
              onChange({ ...policy, [f.key]: Number(e.target.value) });
            }}
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={policy.requireApproval}
          onChange={(e) => {
            onChange({ ...policy, requireApproval: e.target.checked });
          }}
        />{" "}
        Ask me before every post
      </label>
      <p className="text-[11px] text-text-mute">
        {describeCadence(policy)}. Every post passes a compliance check; no performance claim can
        appear unless it comes from the ledger.
      </p>
    </>
  );
}
