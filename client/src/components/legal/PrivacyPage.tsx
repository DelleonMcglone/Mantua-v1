import { LegalPage, Section, List, DiscordLink } from "./LegalPage.tsx";

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
 * Draft — not reviewed by counsel.
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
      <Section title="Information we collect">
        <p>We collect three kinds of information.</p>
        <p>
          <strong className="text-text">Information you give us.</strong> When you create an account
          or sign in, our authentication provider processes an identifier you choose — typically an
          email address, a social login, or a passkey — and returns a wallet address to us. If you
          contact support or sign up for updates, we receive whatever you include in that message.
        </p>
        <p>
          <strong className="text-text">Blockchain and activity information.</strong> We record the
          public wallet addresses you connect and the on-chain activity associated with them in our
          interface: positions taken, swaps, liquidity provided, transaction hashes, and agent
          instructions you issue. Much of this originates on public networks and is not private
          information — see the section on public blockchains below.
        </p>
        <p>
          <strong className="text-text">Technical information.</strong> Like most web services, our
          servers automatically receive your IP address, browser and device type, pages requested,
          timestamps, and referring page. We use this to operate the service, debug failures, and
          detect abuse.
        </p>
        <p>
          <strong className="text-text">What we do not collect.</strong> We never hold your private
          keys. We do not collect your real-world identity — there is no KYC — the contents of your
          other wallets, or your location for any purpose beyond rate limiting and fraud detection.
        </p>
      </Section>

      <Section title="How we use information">
        <List>
          <li>To authenticate you and keep you signed in.</li>
          <li>
            To provide the product: display your portfolio and positions, route and execute the
            actions you request, and run the agent workflows you configure.
          </li>
          <li>To diagnose problems, monitor reliability, and improve the product.</li>
          <li>
            To protect the service and its users — detecting fraud, abuse, manipulation, and
            activity that threatens market integrity.
          </li>
          <li>To respond to you when you contact us.</li>
          <li>To meet legal and regulatory obligations that apply to us.</li>
        </List>
      </Section>

      <Section title="Public blockchains">
        <p>
          Transactions you make through the app are written to a public blockchain. That data is
          permanent, worldwide, and readable by anyone — we cannot delete, alter, or restrict it,
          and neither can you. Anyone can analyze on-chain records and may be able to associate a
          wallet address with a person, particularly if that address has interacted with a regulated
          exchange or a service that collects identity information. Please consider this before
          transacting.
        </p>
      </Section>

      <Section title="Market-integrity monitoring">
        <p>
          We analyse on-chain and interface activity for patterns consistent with manipulation —
          clustered wallets, self-matching, timing anomalies around news and resolution, and
          coordinated flow. This uses the records described above together with public chain data;
          it is not a separate collection of information about you. The Market Integrity policy
          explains what the analysis is for and what happens when something is found.
        </p>
      </Section>

      <Section title="How we share information">
        <p>
          We do not sell your personal information, and we never share it with advertisers. We share
          it only as follows.
        </p>
        <List>
          <li>
            <strong className="text-text">Service providers</strong> who run parts of the product on
            our behalf — authentication, hosting, infrastructure, blockchain data, payments, and
            analytics — and only to the extent they need it to perform that work.
          </li>
          <li>
            <strong className="text-text">Legal and safety.</strong> When we reasonably believe
            disclosure is required by law, legal process, or a government request, or is necessary
            to protect the rights, property, or safety of our users, the public, or us.
          </li>
          <li>
            <strong className="text-text">Business transfers.</strong> If we are involved in a
            merger, acquisition, financing, or sale of assets, information may be transferred as
            part of that transaction.
          </li>
          <li>
            <strong className="text-text">With your direction.</strong> When you ask us to share it,
            or connect a third-party service yourself.
          </li>
        </List>
        <p>
          Sports data flows inbound only. We fetch public schedules, scores, and team marks, and
          those requests carry no identifier for you — a data provider cannot learn from our traffic
          who holds a position.
        </p>
      </Section>

      <Section title="Cookies and similar technologies">
        <p>
          We use session cookies to keep you signed in and local browser storage to remember
          preferences such as your theme and to keep recently-touched pools and positions visible
          while server reads warm up. Local storage never leaves your browser.
        </p>
        <p>
          We use no third-party advertising cookies, no analytics pixels, and no session-replay
          tools. You can block or delete cookies in your browser settings; parts of the app will not
          work correctly without the ones needed for sign-in.
        </p>
      </Section>

      <Section title="Data retention">
        <p>We keep each category only as long as it is useful for the purpose it serves.</p>
        <List>
          <li>
            <strong className="text-text">Wallet address, account, and preferences</strong> — until
            you delete your account, or two years of inactivity, whichever comes first.
          </li>
          <li>
            <strong className="text-text">Transaction and market position records</strong> — while
            the position is open or the market unsettled, then archived for two years.
          </li>
          <li>
            <strong className="text-text">Hedging strategies</strong> — until you disarm them, then
            archived for one year.
          </li>
          <li>
            <strong className="text-text">Server logs</strong> — 30 days.
          </li>
          <li>
            <strong className="text-text">Audit log</strong> — one year.
          </li>
        </List>
        <p>
          Aggregated or de-identified data that can no longer be linked to you may be kept longer.
          On-chain data, as noted above, cannot be deleted by anyone.
        </p>
      </Section>

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
