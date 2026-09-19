import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, ApiError } from "@/lib/api.ts";
import { IdentityForm, PostingForm, type IdentityValues } from "./SocialForms.tsx";
import { SocialPostsSection } from "./SocialPostsSection.tsx";
import { handleProblem, type PostingPolicy, type SocialResponse } from "./social-core.ts";

/**
 * Task 070 / AE-001, AE-005, AE-006 — the user's control of their agent's
 * public voice: claim a handle, make the page public, enable posting,
 * approve templates, set the cadence and the approval rule. Every change
 * is one PATCH the server validates and audits.
 */

const DEFAULT_POLICY: PostingPolicy = {
  templates: [],
  maxPostsPerHour: 2,
  maxPostsPerDay: 8,
  minMinutesBetween: 20,
  quietHoursUtc: null,
  requireApproval: true,
};
const EMPTY_IDENTITY: IdentityValues = { handle: "", displayName: "", bio: "", isPublic: true };

export function SocialPanel({
  onClose,
  onOpenPublicPage,
}: {
  onClose?: () => void;
  onOpenPublicPage: (handle: string) => void;
}) {
  const [loaded, setLoaded] = useState<SocialResponse | null>(null);
  const [identity, setIdentity] = useState<IdentityValues>(EMPTY_IDENTITY);
  const [postingEnabled, setPostingEnabled] = useState(false);
  const [policy, setPolicy] = useState<PostingPolicy>(DEFAULT_POLICY);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SocialResponse>("/api/agent/social")
      .then((r) => {
        setLoaded(r);
        if (r.profile) {
          const { handle, displayName, bio, isPublic } = r.profile;
          setIdentity({ handle, displayName, bio, isPublic });
          setPostingEnabled(r.profile.postingEnabled);
          setPolicy(r.profile.postingPolicy);
        }
      })
      .catch(() => {
        setLoaded({ profile: null, pageUrl: null, platformConfigured: false });
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const r = await api.patch<{ profile: SocialResponse["profile"]; pageUrl: string }>(
        "/api/agent/social",
        { ...identity, postingEnabled, postingPolicy: policy },
      );
      setLoaded((prev) => ({
        profile: r.profile,
        pageUrl: r.pageUrl,
        platformConfigured: prev?.platformConfigured ?? false,
      }));
      setNotice("Saved.");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    !saving && handleProblem(identity.handle) === null && identity.displayName.trim().length >= 2;
  const claimed = loaded?.profile ?? null;

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title="Agent voice & public page"
        subtitle="A public record derived from chain-verified trades, and the posts your agent may make."
        {...(onClose ? { onClose } : {})}
      />
      <div className="flex-1 overflow-auto px-5 pb-6">
        <section className="rounded-md border border-border-soft px-4 py-3.5 flex flex-col gap-2.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
            Identity
          </h3>
          <IdentityForm value={identity} onChange={setIdentity} />
          {claimed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenPublicPage(claimed.handle);
              }}
            >
              View public page
            </Button>
          )}
        </section>

        <section className="mt-3 rounded-md border border-border-soft px-4 py-3.5 flex flex-col gap-2.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-mute">
            Posting
          </h3>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={postingEnabled}
              onChange={(e) => {
                setPostingEnabled(e.target.checked);
              }}
            />{" "}
            Let my agent post
            {loaded &&
              !loaded.platformConfigured &&
              " (dry runs only: the deployment has no platform credentials)"}
          </label>
          <PostingForm policy={policy} onChange={setPolicy} />
          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
              Save
            </Button>
            {notice && <span className="text-[12px] text-text-dim">{notice}</span>}
          </div>
        </section>

        <SocialPostsSection enabled={claimed !== null} />
      </div>
    </>
  );
}
