import { List, Section } from "./LegalPage.tsx";

/**
 * Task 067 (G-012) — the Terms sections that describe the product as
 * shipped: markets and settlement (D-103 in-play trading, D-104 dispute
 * window and manual override, voids at 0.50), fees (D-105), sponsored
 * transactions (D-111), funding (bank rails via partners), and agents
 * (Circle-custodied wallet, caps, D-114 modes). The counsel draft
 * `docs/legal/TERMS-OF-SERVICE-DRAFT.md` mirrors these sections.
 */
export function MarketsAndSettlement() {
  return (
    <Section title="Markets and settlement">
      <p>
        Each market is a yes/no contract on a scheduled game. A winning contract pays one dollar; a
        losing contract pays nothing. You can buy or sell before <em>and during</em> the game;
        trading closes when the game goes final, and no later than twelve hours after its scheduled
        start even if no result has been reported. Prices are set by trading in the market&rsquo;s
        pool, not by us.
      </p>
      <p>
        <strong className="text-text">Resolution.</strong> Outcomes are determined from live sports
        data by a Mantua-operated resolver and submitted to the settlement contract. Every
        resolution passes a mandatory review window before it is final, during which we may hold a
        result whose data sources disagree; we also hold a manual override for cases where automated
        data is missing, delayed, or contradictory. Once a resolution is final it cannot be reversed
        by anyone, including us. Every resolution is recorded with its data source and signer.
      </p>
      <p>
        <strong className="text-text">Voided games.</strong> A postponed, cancelled, or abandoned
        game &mdash; or a tie, where the market offers no tie outcome &mdash; voids the market. A
        voided market settles at fifty cents per contract on both sides, regardless of the price you
        paid.
      </p>
      <p>
        <strong className="text-text">Pauses and halts.</strong> New purchases on a live game are
        refused while the live data feed is behind; selling stays open. We may pause all trading
        platform-wide under conditions we define in advance, including a suspected data or security
        problem. Positions already held are unaffected by a pause and settle normally.
      </p>
    </Section>
  );
}

export function FeesAndCosts() {
  return (
    <Section title="Fees and costs">
      <p>
        Trading fees follow the league calendar. Trades on regular-season games carry no trading
        fee. Trades on playoff games carry a dynamic fee between 0.10% and 0.70% of the amount
        traded, set by the market&rsquo;s liquidity, volatility, activity, and uncertainty; 0.70% is
        an absolute ceiling written into the contract. The exact fee for your trade is shown before
        you confirm, and it is the fee the trade pays.
      </p>
      <p>
        Where we sponsor the cost of submitting your transaction, you pay nothing beyond the amount
        shown. Where sponsorship is unavailable, your wallet pays the underlying transaction cost;
        it never flows to us. Bank transfers may carry a partner fee disclosed at the time of the
        transfer.
      </p>
    </Section>
  );
}

export function FundingYourAccount() {
  return (
    <Section title="Funding your account">
      <p>
        You fund your account with USDC, either by transferring it to your wallet address or by
        connecting a bank account and transferring dollars, which our payments partners convert to
        USDC and deliver to your wallet. Bank connections and dollar transfers are provided by
        licensed third parties under their own terms; we never see your bank credentials and never
        hold your dollars. A bank transfer may take one or more business days and may be reversed by
        the partner before it lands.
      </p>
    </Section>
  );
}

export function AgentsAndAutomation() {
  return (
    <Section title="Agents and automated activity">
      <p>
        You may enable an autonomous agent that researches, trades, hedges, and manages liquidity on
        your behalf. The agent acts from its own wallet, held by a regulated custodian under that
        custodian&rsquo;s terms; we hold neither its keys nor yours. You fund it explicitly and set
        its daily spending limit, per-trade ceiling, leagues, and whether it may act unprompted.
      </p>
      <List>
        <li>You are responsible for everything your agent does within the limits you set.</li>
        <li>
          The agent relies on third-party data and language models that can be delayed, incomplete,
          or wrong. Its analysis is an estimate, never a guarantee of any outcome.
        </li>
        <li>
          Paid data the agent buys is charged to its wallet, counted against its daily limit, and
          recorded in your activity.
        </li>
        <li>You can stop the agent at any time; open positions it took remain yours.</li>
      </List>
    </Section>
  );
}
