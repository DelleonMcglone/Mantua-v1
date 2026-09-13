import { LegalPage, Section, List } from "./LegalPage.tsx";
import { AdviceRiskAndThirdParties, LegalBoilerplate } from "./TermsLegalSections.tsx";
import {
  AgentsAndAutomation,
  FeesAndCosts,
  FundingYourAccount,
  MarketsAndSettlement,
} from "./TermsProductSections.tsx";

interface Props {
  onBack: () => void;
  onLaunch: () => void;
}

/**
 * Terms of Use. Written for this product: a non-custodial interface to
 * on-chain sports prediction markets and Uniswap v4 pools, where the user
 * signs every transaction themselves. Effective 2026-09-13 (task 067): the
 * fee model, the resolution review window, in-play trading, sponsored
 * transactions, bank funding, and agent autonomy. Draft — not reviewed by
 * counsel, and the dispute section still needs a forum.
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

      <AgentsAndAutomation />

      <MarketsAndSettlement />

      <FeesAndCosts />

      <FundingYourAccount />

      <AdviceRiskAndThirdParties />

      <LegalBoilerplate />
    </LegalPage>
  );
}
