import { Section, DiscordLink, GOVERNING_LAW } from "./LegalPage.tsx";

/**
 * Terms of Use — the sections that are not product-specific: advice and
 * risk disclaimers, third parties, and the legal boilerplate (IP,
 * suspension, disclaimers, liability, indemnity, governing law, changes,
 * contact). Rendered by `TermsPage.tsx` after the product sections; kept
 * here so each file stays readable. Draft — not reviewed by counsel.
 */
export function AdviceRiskAndThirdParties() {
  return (
    <>
      <Section title="No professional advice">
        <p>
          Nothing in the service is financial, investment, legal, tax, or accounting advice, and
          nothing is a recommendation to enter any transaction. Research, analytics, agent output,
          and market data are provided for information only and may be inaccurate. Decisions you
          make are your own.
        </p>
      </Section>

      <Section title="Risk">
        <p>
          Trading event contracts and providing liquidity involve substantial risk, including total
          loss of the assets you commit. A contract on the losing side pays nothing. Prices can move
          sharply during a game, and a trade placed on live data may execute at a price that no
          longer reflects the game. Markets can be thin, so a large order may move the price against
          you. Beyond market risk, you accept the risks inherent to this technology: smart contract
          bugs and exploits, data-source failure or manipulation, congestion and reorganization on
          the settlement network, stablecoin depegs, impermanent loss, and failures at third-party
          providers. Do not commit more than you can afford to lose.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          The service integrates third parties — wallet and authentication providers, blockchain
          networks and data providers, oracles, and bridges. We do not control them and are not
          responsible for their performance, availability, or terms. Your use of them may be
          governed by their own agreements.
        </p>
      </Section>
    </>
  );
}

export function LegalBoilerplate() {
  return (
    <>
      <Section title="Intellectual property">
        <p>
          The interface, its content, and our marks belong to us or our licensors. We grant you a
          limited, personal, non-exclusive, revocable licence to use the interface as intended.
          Nothing here transfers ownership. Open-source components remain governed by their own
          licences.
        </p>
      </Section>

      <Section title="Suspension and termination">
        <p>
          We may suspend or restrict access to the interface, with or without notice, if we
          reasonably believe you have breached these terms or the Market Integrity policy, or where
          required by law or to protect the service and its users. You may stop using the service at
          any time. Because the underlying contracts are permissionless, restricting our interface
          does not remove your ability to interact with them directly, and it does not affect
          positions already on-chain.
        </p>
      </Section>

      <Section title="Disclaimers">
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind, express or implied, including merchantability, fitness for a
          particular purpose, title, and non-infringement. We do not warrant that the service will
          be uninterrupted, timely, secure, or error-free, or that data shown will be accurate or
          current.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, we are not liable for any indirect, incidental,
          special, consequential, exemplary, or punitive damages, or for lost profits, lost assets,
          lost data, or lost opportunity, arising from or related to your use of the service — even
          if we were advised such damages were possible. Some jurisdictions do not allow these
          limitations, in which case they apply to the maximum extent permitted.
        </p>
      </Section>

      <Section title="Indemnification">
        <p>
          You agree to indemnify and hold harmless Mantua and its personnel from claims, losses, and
          expenses (including reasonable legal fees) arising from your use of the service, your
          breach of these terms, or your violation of any law or third-party right.
        </p>
      </Section>

      <Section title="Governing law and disputes">
        <p>
          These terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict of law
          rules. Before starting any proceeding, you and Mantua will attempt in good faith to
          resolve the dispute informally by contacting each other first. Nothing in these terms
          limits any right you have under the mandatory law of the country you live in.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these terms. When we do, we will revise the effective date above, and for
          material changes we will ask you to accept the revised terms before your next trade. We
          record which version you accepted and when. Continuing to use the service after an update
          means you accept the revised terms.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about these terms can be sent to us on <DiscordLink />.
        </p>
      </Section>
    </>
  );
}
