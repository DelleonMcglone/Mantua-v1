import { Section, List } from "./LegalPage.tsx";

/**
 * Privacy Policy — what we collect, why, and the two things every user
 * should understand first (public blockchains, integrity monitoring).
 * Rendered by `PrivacyPage.tsx`; the counsel draft in
 * `docs/legal/PRIVACY-POLICY-DRAFT.md` mirrors this text.
 */
export function CollectionSections() {
  return (
    <>
      <Section title="Information we collect">
        <p>We collect three kinds of information.</p>
        <p>
          <strong className="text-text">Information you give us.</strong> When you create an account
          or sign in, our authentication provider processes an identifier you choose — typically an
          email address, a social login, or a passkey — and returns a wallet address to us. If you
          connect a bank account, our payments partners collect your bank login and account details
          directly; we receive only an opaque token, a display label such as your bank&rsquo;s name
          and the last digits of the account, and the status and dollar amount of each transfer. If
          you contact support or sign up for updates, we receive whatever you include in that
          message. When you accept our Terms, we record which version you accepted and when.
        </p>
        <p>
          <strong className="text-text">Blockchain and activity information.</strong> We record the
          public wallet addresses you connect and the on-chain activity associated with them in our
          interface: positions taken, swaps, liquidity provided, transaction hashes, the agent
          wallet&rsquo;s address and its actions, and the instructions, questions, and hedging
          strategies you issue. Much of this originates on public networks and is not private
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
    </>
  );
}
