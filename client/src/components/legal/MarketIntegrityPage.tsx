import { LegalPage, Section, List, DiscordLink } from "./LegalPage.tsx";

interface Props {
  onBack: () => void;
  onLaunch: () => void;
}

/**
 * Market Integrity policy — the conduct rules for trading on Mantua:
 * what counts as manipulation, how we monitor, what happens when someone
 * breaks the rules, and how to report it. Draft — not reviewed by
 * counsel.
 */
export function MarketIntegrityPage({ onBack, onLaunch }: Props) {
  return (
    <LegalPage
      title="Market Integrity"
      onBack={onBack}
      onLaunch={onLaunch}
      intro={
        <p>
          Prediction markets are only useful if their prices mean something. A price is a forecast,
          and it is only honest when it reflects what participants genuinely believe will happen —
          not what someone has engineered it to show. This policy sets out the conduct we expect,
          the conduct we prohibit, how we monitor for abuse, and what we do when we find it. It
          applies to everyone who uses Mantua, including agents acting on your behalf.
        </p>
      }
    >
      <Section title="The principle">
        <p>
          Trade on your own view of the outcome, formed from information anyone could have obtained.
          Do not trade on an advantage you got by influencing the event, by holding information the
          public cannot access, or by distorting the market rather than forecasting it. If a
          strategy only works because other participants are misled about supply, demand, or the
          state of the world, it is prohibited here.
        </p>
      </Section>

      <Section title="Prohibited conduct">
        <p>
          <strong className="text-text">Trading on material non-public information.</strong> Do not
          trade a market when you hold information about the outcome that is not publicly available
          and that a reasonable participant would consider important. This applies with particular
          force to anyone positioned to know an outcome early — athletes, coaches, team and league
          staff, officials, medical and training personnel, agents, and anyone who receives such
          information from them.
        </p>
        <p>
          <strong className="text-text">Influencing the outcome.</strong> Do not take a position in
          a market whose outcome you can affect, and never attempt to affect a real-world event —
          including any attempt to fix, alter, or influence a game, a performance, or an official
          decision — in order to profit from a market.
        </p>
        <p>
          <strong className="text-text">Market manipulation.</strong> This includes, without
          limitation:
        </p>
        <List>
          <li>
            <strong className="text-text">Wash trading and self-dealing</strong> — trading with
            yourself or between accounts you control to create the appearance of activity.
          </li>
          <li>
            <strong className="text-text">Spoofing and layering</strong> — placing orders you do not
            intend to be filled in order to move the price or mislead others about interest.
          </li>
          <li>
            <strong className="text-text">Marking or ramping</strong> — trading with the purpose of
            setting a price at a particular moment, such as near resolution, rather than to take a
            genuine position.
          </li>
          <li>
            <strong className="text-text">Coordinated activity</strong> — acting with others to move
            a market in concert, whether or not you share an account.
          </li>
          <li>
            <strong className="text-text">Spreading false information</strong> — publishing or
            amplifying claims you know to be untrue about an event, an outcome, or a market, in
            order to move its price.
          </li>
          <li>
            <strong className="text-text">Oracle and settlement interference</strong> — attempting
            to corrupt, delay, or exploit a data source a market relies on for resolution.
          </li>
        </List>
        <p>
          <strong className="text-text">Evasion.</strong> Do not operate multiple or nominee
          accounts to evade limits or restrictions, disguise your location, or continue using the
          service after a restriction. Do not trade on behalf of a person who is prohibited from
          trading here.
        </p>
        <p>
          <strong className="text-text">Abusive automation.</strong> Agents and programmatic trading
          are welcome, and much of this product is built for them. What is not permitted is
          automation used to degrade the service or the market: overwhelming infrastructure,
          exploiting latency in a data feed to the detriment of settlement, or executing any of the
          conduct above at machine speed. You are responsible for what your agents do.
        </p>
      </Section>

      <Section title="Conflicts of interest">
        <p>
          If your role gives you access to information about an event, or influence over it, you
          should assume you may not trade the markets tied to that event. When it is unclear whether
          a relationship creates a conflict, ask us before trading rather than after.
        </p>
      </Section>

      <Section title="Monitoring and enforcement">
        <p>
          We monitor on-chain and interface activity for patterns consistent with the conduct above,
          including clustered wallets, self-matching, timing anomalies around news and resolution,
          and coordinated flow. Where we identify a concern, we may investigate, request
          information, restrict or suspend access to our interface, cancel pending interface-side
          actions, and report conduct to the relevant authorities, sports body, or exchange.
        </p>
        <p>
          Because the underlying contracts are permissionless and settlement is on-chain,
          restricting our interface does not reverse transactions that have already settled.
          Enforcement is about access, escalation, and referral — not about clawing back on-chain
          positions, which no one can do.
        </p>
      </Section>

      <Section title="Reporting a concern">
        <p>
          If you see something that looks like manipulation, insider activity, or an attempt to
          influence an event, tell us on <DiscordLink />. Include the market, the approximate time,
          and any addresses or transactions involved. Reports are treated confidentially, and we
          will not retaliate against anyone who reports a concern in good faith.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          Markets and the tactics used against them change, and this policy will change with them.
          When it does we will revise the effective date above. The list of prohibited conduct is
          illustrative, not exhaustive — conduct that undermines the integrity of a market may be
          actioned whether or not it is named here.
        </p>
      </Section>
    </LegalPage>
  );
}
