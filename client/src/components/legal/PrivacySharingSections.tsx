import { Section, List } from "./LegalPage.tsx";

/**
 * Privacy Policy — who we share information with (including the AI
 * processing disclosure), cookies, and how long each category is kept.
 * Rendered by `PrivacyPage.tsx`; mirrored in
 * `docs/legal/PRIVACY-POLICY-DRAFT.md`.
 */
export function SharingAndRetentionSections() {
  return (
    <>
      <Section title="How we share information">
        <p>
          We do not sell your personal information, and we never share it with advertisers. We share
          it only as follows.
        </p>
        <List>
          <li>
            <strong className="text-text">Service providers</strong> who run parts of the product on
            our behalf, and only to the extent they need it to perform that work: authentication and
            wallets (Privy), the agent&rsquo;s custodied wallet (Circle), bank connections and
            dollar transfers (Plaid and our licensed transfer partner), hosting and databases,
            blockchain data, and the language-model provider (Anthropic) that answers the analyst
            and runs the agent.
          </li>
          <li>
            <strong className="text-text">AI processing.</strong> When you ask the analyst or the
            agent a question, the text of your question, the conversation so far, and the market and
            game data needed to answer it are sent to the language-model provider. We do not send
            your email address or bank details with it, and we do not use your conversations to
            train models.
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
            <strong className="text-text">Bank transfer records</strong> — the token, label, and
            each transfer&rsquo;s status and amount — until you disconnect the bank, then archived
            for two years as required for payments.
          </li>
          <li>
            <strong className="text-text">Terms acceptances</strong> — for as long as your account
            exists.
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
    </>
  );
}
