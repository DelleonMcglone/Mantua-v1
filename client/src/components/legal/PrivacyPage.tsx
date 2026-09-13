import { LegalPage, Section, DiscordLink } from "./LegalPage.tsx";
import { CollectionSections } from "./PrivacyCollectionSections.tsx";
import { SharingAndRetentionSections } from "./PrivacySharingSections.tsx";

interface Props {
  onBack: () => void;
  onLaunch: () => void;
}

/**
 * Privacy policy — the published version.
 *
 * Source of truth is `docs/legal/PRIVACY-POLICY-DRAFT.md`, which carries
 * the counsel-review checklist and the inline `[REVIEW: …]` markers. The
 * two were merged on 2026-08-16; keep them in step — a change here needs
 * the matching edit there.
 *
 * Sections live in `PrivacyCollectionSections.tsx` and
 * `PrivacySharingSections.tsx`. Draft — not reviewed by counsel.
 */
export function PrivacyPage({ onBack, onLaunch }: Props) {
  return (
    <LegalPage
      title="Privacy Policy"
      onBack={onBack}
      onLaunch={onLaunch}
      intro={
        <p>
          This policy explains what information Mantua Intelligence (&ldquo;Mantua&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you use our website and application, why
          we collect it, who we share it with, and the choices you have. It applies to the
          interfaces we operate. It does not apply to public blockchains, wallet software, or
          third-party sites we link to, which we do not control.
        </p>
      }
    >
      <CollectionSections />

      <SharingAndRetentionSections />

      <Section title="Security">
        <p>
          We use technical and organizational measures intended to protect information in our
          systems. No method of transmission or storage is perfectly secure, and we cannot guarantee
          absolute security. You are responsible for safeguarding your own wallet credentials,
          recovery phrases, and passkeys. We will never ask you for a seed phrase or private key.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <p>
          Depending on where you live, you may have the right to access the data we hold about you,
          correct it, delete your account and the server-side records that link your wallet to it,
          export your data in a machine-readable format, object to or restrict certain processing,
          and withdraw consent. You may also have the right to appeal a decision we make about such
          a request, or to complain to your local data protection authority.
        </p>
        <p>
          One limit is absolute: on-chain transactions and the wallet address itself are public
          blockchain data. Deleting your account removes the server-side records that link that
          address to a Mantua user — it cannot remove anything from the chain.
        </p>
        <p>
          To make a request, contact us on <DiscordLink />. We may need to verify your identity
          before we act. We will not discriminate against you for exercising these rights.
        </p>
      </Section>

      <Section title="International transfers">
        <p>
          We operate internationally, and information we collect may be processed in countries other
          than the one you live in, including countries whose data protection laws differ from
          yours. Where required, we rely on appropriate safeguards for those transfers.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The service is not directed to children, and we do not knowingly collect personal
          information from anyone under 18. If you believe a minor has provided us information,
          contact us and we will delete it.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. When we do, we will revise the effective date
          above, and for material changes we will provide additional notice in the app or by other
          reasonable means. Continuing to use the service after an update means you accept the
          revised policy.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about this policy or how we handle information can be sent to us on{" "}
          <DiscordLink />.
        </p>
      </Section>
    </LegalPage>
  );
}
