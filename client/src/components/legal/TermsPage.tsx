import { LegalPage, Section, List, DiscordLink, GOVERNING_LAW } from "./LegalPage.tsx";

interface Props {
  onBack: () => void;
  onLaunch: () => void;
}

/**
 * Terms of Use. Written for this product: a non-custodial interface to
 * on-chain prediction markets and Uniswap v4 pools, where the user signs
 * every transaction themselves. Draft — not reviewed by counsel, and the
 * governing-law and dispute sections still need a jurisdiction.
 */
export function TermsPage({ onBack, onLaunch }: Props) {
  return (
    <LegalPage
      title="Terms of Use"
      onBack={onBack}
      onLaunch={onLaunch}
      intro={
        <p>
          These terms are an agreement between you and Mantua Intelligence (&ldquo;Mantua&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) covering your use of our website, application, and
          related services. By using them you accept these terms. If you do not agree, do not use
          the service.
        </p>
      }
    >
      <Section title="Eligibility">
        <p>
          You must be at least 18 and legally able to enter into this agreement. You may not use the
          service if you are located in, or are a resident or national of, a jurisdiction where use
          of the service is prohibited, or if you appear on any applicable sanctions list. You are
          responsible for knowing and following the laws that apply to you, including whether
          trading event contracts is lawful where you are.
        </p>
      </Section>

      <Section title="What the service is">
        <p>
          Mantua provides an interface to smart contracts deployed on public blockchains. Through
          it, you can take positions in prediction markets, swap assets, and provide liquidity.
        </p>
        <p>
          <strong className="text-text">We are non-custodial.</strong> We never take possession or
          control of your assets, and we cannot move, freeze, or recover them. You hold your own
          keys and you sign every transaction. Transactions are executed by smart contracts, not by
          us, and once submitted they generally cannot be reversed, cancelled, or refunded — by you
          or by us.
        </p>
      </Section>

      <Section title="Your account and wallet">
        <p>
          You are responsible for your wallet, credentials, recovery phrases, passkeys, and for
          everything that happens through your account. Keep them secure. We cannot restore lost
          keys or reverse a transaction signed with them. Notify us promptly if you believe your
          account has been compromised.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>You agree not to:</p>
        <List>
          <li>
            Manipulate a market, trade on material non-public information, or engage in any conduct
            our Market Integrity policy prohibits.
          </li>
          <li>Use the service for money laundering, sanctions evasion, or any unlawful purpose.</li>
          <li>
            Operate multiple accounts to evade limits, or access the service through a VPN or proxy
            to disguise a restricted location.
          </li>
          <li>
            Interfere with the service — probing, scraping at abusive rates, overwhelming our
            infrastructure, or circumventing security or access controls.
          </li>
          <li>
            Reverse engineer or copy the interface except to the extent that restriction is
            unenforceable by law.
          </li>
          <li>Misrepresent your identity, location, or eligibility.</li>
        </List>
      </Section>

      <Section title="Agents and automated activity">
        <p>
          The service lets you configure autonomous agents that act on your behalf. You are
          responsible for what your agents do, including every transaction they sign and every
          payment they make, whether or not you reviewed the action in advance. Agents rely on
          third-party data and models that can be delayed, incomplete, or wrong. Set spending limits
          deliberately and monitor them.
        </p>
      </Section>

      <Section title="Markets and settlement">
        <p>
          Each market defines its own resolution terms and settlement source. Read them before
          taking a position. Settlement follows those terms and the logic in the underlying smart
          contracts. Markets may be paused or halted under conditions defined in advance by the
          protocol — for example, circuit breakers on the hooks — and events outside our control,
          such as a postponed or cancelled game or a failed data source, can delay or affect
          resolution.
        </p>
        <p>
          <strong className="text-text">Resolution authority.</strong> Outcomes are determined by a
          Mantua-operated resolver that reads live sports data and submits results on-chain, with a
          manual override held by Mantua for cases where automated data is missing, delayed, or
          contradictory. There is currently no dispute window or independent arbiter: once a market
          resolves on-chain, that resolution is final and cannot be reversed by anyone, including
          us. Every resolution is publicly recorded with its data source, signer, and transaction.
        </p>
        <p>
          <strong className="text-text">Voided markets.</strong> A postponed, cancelled, or
          abandoned game — or a tie, where the market offers no tie outcome — voids the market.
          Voided markets settle at 0.50 USDC per outcome token, so a full YES/NO set returns exactly
          the collateral it was minted with; tokens bought individually settle at that fixed rate
          regardless of the price paid.
        </p>
      </Section>

      <Section title="Fees and costs">
        <p>
          Trading incurs protocol and pool fees, which vary with market conditions and the hook
          governing the pool, and network transaction fees paid to the underlying blockchain. Fees
          are disclosed in the interface before you confirm. Network fees are never paid to us.
        </p>
      </Section>

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
          loss of the assets you commit. Beyond market risk, you accept the risks inherent to this
          technology: smart contract bugs and exploits, oracle failure or manipulation, network
          congestion and reorganization, stablecoin depegs, impermanent loss, and failures at
          third-party providers. Do not commit more than you can afford to lose.
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
          material changes we will give additional notice in the app or by other reasonable means.
          Continuing to use the service after an update means you accept the revised terms.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about these terms can be sent to us on <DiscordLink />.
        </p>
      </Section>
    </LegalPage>
  );
}
