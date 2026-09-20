import type { ReactNode } from "react";
import { P, H, UL, OL, B, A, Note, Table } from "./docs-primitives.tsx";

/**
 * Documentation content, one entry per sidebar page. Kept as data so the
 * page shell stays dumb and adding a topic is a single array entry.
 *
 * Everything factual here is drawn from the deployed system: the fee model
 * from `docs/fee-model.md`, the market lifecycle from `docs/architecture.md`,
 * token details from `lib/tokens.ts`. Update this file when those change.
 * Scope (owner decision 2026-09-20): Mantua is an NFL prediction market with
 * an agent — there is no swap, liquidity or bridge surface to document.
 */

export interface DocsPage {
  id: string;
  title: string;
  /** Sub-title under the page heading. */
  summary: string;
  body: ReactNode;
}

export interface DocsGroup {
  label: string;
  pages: DocsPage[];
}

const BASE_EXPLORER = "https://basescan.org/address";

export const DOCS_GROUPS: DocsGroup[] = [
  {
    label: "Overview",
    pages: [
      {
        id: "introduction",
        title: "Introduction",
        summary: "What Mantua is and how the pieces fit together.",
        body: (
          <>
            <P>
              Mantua is an agent-driven prediction market for the NFL. Every game has a market on
              each side; you take a position in three taps, or tell your agent what you think in
              plain language and let it evaluate the matchup, size the bet under your cap, and place
              it, before or during the game.
            </P>
            <P>
              Three parts do the work. The <B>Dynamic Market Hook</B> puts pricing, fees and circuit
              breakers inside the market&apos;s own pool. <B>Agents</B> turn intent into action,
              buying the sports intelligence they need per call in USDC and executing on the result.
              The <B>interface</B> ties them together with a board of today&apos;s games, a
              portfolio, an analyst, and a chatbot that routes plain-language instructions to the
              right surface. Every command, including placing bets, can be run from the chatbot.
            </P>

            <H>Non-custodial by design</H>
            <P>
              Mantua never holds your assets. You connect a wallet, you sign every transaction, and
              settlement happens in smart contracts. Nothing in this documentation implies we can
              move, freeze, reverse, or recover funds. We cannot.
            </P>

            <H>Where to start</H>
            <UL>
              <li>
                New here? <B>Getting started</B> covers signing in and funding your wallet.
              </li>
              <li>
                Want the mechanics? <B>The Dynamic Market Hook</B> explains how a market prices and
                what it charges.
              </li>
              <li>
                Ready to bet? <B>Placing a bet</B> walks through the ticket, and <B>Agents</B>{" "}
                through letting your agent do it for you.
              </li>
            </UL>
          </>
        ),
      },
      {
        id: "getting-started",
        title: "Getting started",
        summary: "Sign in, fund a wallet, take your first position.",
        body: (
          <>
            <H>1. Browse</H>
            <P>
              The home page is the board: today&apos;s NFL games with their live prices. Browsing
              markets, prices and analysis is open to everyone. No wallet required.
            </P>

            <H>2. Sign in</H>
            <P>
              Any transaction needs a logged-in wallet. Sign in with email, a social account, a
              passkey, or an external wallet; a wallet address is created or connected for you. Keep
              your recovery method safe. We can never restore it, and we will never ask you for a
              seed phrase or private key.
            </P>

            <H>3. Fund the wallet</H>
            <P>
              Send USDC to your wallet address from an exchange or another wallet. Positions are
              priced and settled in USDC.
            </P>
            <Note>
              <B>Transactions are sponsored.</B> You never need to hold ETH for gas: every trade is
              paid for by the platform, and your USDC covers only the position itself.
            </Note>

            <H>4. Do something</H>
            <OL>
              <li>
                Pick a game from the board, choose a side, choose an amount, confirm. Or open{" "}
                <B>Agent</B> and ask it to evaluate the matchup and recommend a bet.
              </li>
              <li>
                Type an instruction into the chatbot, like &ldquo;bet on the Chiefs&rdquo; or
                &ldquo;what can I trade right now?&rdquo;, and it routes to the right surface,
                pre-filled.
              </li>
              <li>Review the ticket, confirm, and sign in your wallet.</li>
            </OL>
          </>
        ),
      },
    ],
  },
  {
    label: "Core concepts",
    pages: [
      {
        id: "hooks",
        title: "The Dynamic Market Hook",
        summary: "One hook, inside every market's pool: pricing, fees, and the circuit breaker.",
        body: (
          <>
            <P>
              A Uniswap v4 hook is a contract the pool calls at defined points in its lifecycle:
              before and after a trade, or a liquidity change. Mantua ships one. Every market&apos;s
              pool is created with it, so its rules are the market&apos;s rules.
            </P>

            <H>How a market is built</H>
            <P>
              Each game mints two markets, one per side. A market issues a YES and a NO outcome
              token, collateralised 1:1 by USDC, and the YES token trades against USDC in its own
              pool. The price of YES is the market&apos;s probability that the side wins.
            </P>

            <H>Fees</H>
            <Table
              head={["When", "Fee", "What sets it"]}
              rows={[
                ["Regular season", "0%", "Fixed"],
                [
                  "Playoffs",
                  "0.10% to 0.70%",
                  "Liquidity, volatility and trading activity, adjusted on every trade",
                ],
              ]}
            />
            <P>
              The fee is set by the hook at execution, so the ticket shows the exact rate for that
              trade rather than a fixed tier.
            </P>

            <H>Halts</H>
            <P>
              The hook can stop accepting new buys under conditions defined in advance. The clearest
              case is a stale live feed: if the score data behind an in-play game stops updating,
              new buys on that game pause until it recovers. Selling an existing position is never
              paused. These halts are enforced by the contract and the platform status, not by an
              operator decision.
            </P>
          </>
        ),
      },
      {
        id: "agents",
        title: "Agents",
        summary: "How your agent researches, decides, and executes.",
        body: (
          <>
            <P>
              An agent turns an instruction into a position. Give it a goal in plain language and it
              researches, decides, and executes, including while you are away, always within the
              daily cap and the policy you set for it.
            </P>

            <H>Buying intelligence</H>
            <P>
              When an agent hits a question it can&apos;t answer from Mantua&apos;s own sports data,
              it searches the x402 marketplace and pays per call in USDC. No API keys to provision,
              no accounts to create, no subscriptions to prefund. Every purchase is capped and
              written to an audit log.
            </P>

            <H>Acting on it</H>
            <P>
              The agent combines the matchup evidence (records, form, injuries, head to head) with
              the market&apos;s price, shows you the discrepancy and the risks, then simulates the
              trade. Anything that moves money is previewed first and runs only after you reply
              &ldquo;confirm&rdquo;. It can take a position, exit one, hedge an exposure, or build a
              combo across games.
            </P>

            <H>Your policy over it</H>
            <P>
              The daily spending cap, the per-trade stake limit, the risk level and the hedging
              rules live in your profile. The agent can read them and can never change them.
            </P>

            <Note tone="warn">
              You are responsible for everything your agent signs, whether or not you reviewed it
              first. Set spending limits deliberately, and check them.
            </Note>
          </>
        ),
      },
      {
        id: "markets",
        title: "Markets and settlement",
        summary: "How a market prices, trades in play, and resolves.",
        body: (
          <>
            <H>Pricing</H>
            <P>
              Prices come from the pool, not from a bookmaker. Each side trades against liquidity,
              and the Dynamic Market Hook adjusts fees and parameters as conditions change. A quoted
              price is the market&apos;s current forecast. It moves when participants disagree with
              it.
            </P>

            <H>In play</H>
            <P>
              Markets trade before and during the game. Trading closes when the game goes final (or
              is postponed or cancelled), and a permissionless backstop closes any market twelve
              hours after kickoff if the final never arrived.
            </P>

            <H>Resolution</H>
            <P>
              Each market names its own resolution terms and settlement source before it opens. Read
              them before taking a position. Settlement follows those terms and the contract logic.
              Postponed or cancelled events, and failures at a data source, can delay resolution.
            </P>
            <P>
              Outcomes are submitted on-chain by a <B>Mantua-operated resolver</B> reading live
              sports data, with a manual override for cases where the data is missing, delayed, or
              contradictory. Two independent sources disagreeing on a result stops automatic
              settlement and escalates to review rather than picking a side. There is currently no
              dispute window: a resolution, once on-chain, is final. Every resolution is publicly
              recorded with its data source, signer, and transaction.
            </P>
            <Note tone="warn">
              A tie, a postponed game, or a cancelled game voids the market. Voided markets settle
              at 0.50 USDC per outcome token, so a full YES/NO set returns exactly what it was
              minted with.
            </Note>

            <Note>
              Everything settles on a public blockchain. Once a transaction is confirmed it cannot
              be reversed, cancelled, or refunded by anyone, including us.
            </Note>
          </>
        ),
      },
    ],
  },
  {
    label: "Guides",
    pages: [
      {
        id: "betting",
        title: "Placing a bet",
        summary: "From the board to a position in three taps.",
        body: (
          <>
            <OL>
              <li>
                Pick a game from the board, or open <B>NFL</B> from the header. Any command,
                including placing bets, can also be typed into the chatbot directly.
              </li>
              <li>Choose the side and the amount you want to stake.</li>
              <li>
                Review the ticket. It shows the tokens you receive, the price impact, the fee the
                hook will charge, and the payout if your side wins. A winning YES token redeems for
                1 USDC after resolution.
              </li>
              <li>Confirm and sign. The transaction appears in your activity when it lands.</li>
            </OL>

            <H>Closing a position</H>
            <P>
              Open your profile, find the position, and choose Close. The ticket opens on Sell,
              pre-filled with your full balance; adjust the amount if you only want to trim.
            </P>

            <H>If the ticket refuses</H>
            <UL>
              <li>
                <B>Market closed</B>: the game is final, postponed or cancelled, or the twelve-hour
                backstop has closed it. Wait for resolution, then claim.
              </li>
              <li>
                <B>Buys paused</B>: the live feed behind an in-play game is stale. Selling still
                works; buying resumes when the feed recovers.
              </li>
              <li>
                <B>Over your cap</B>: the amount exceeds the daily cap or the per-trade limit set in
                your profile. Lower the stake or raise the limit yourself; the agent cannot.
              </li>
            </UL>
          </>
        ),
      },
    ],
  },
  {
    label: "Reference",
    pages: [
      {
        id: "contracts",
        title: "Contracts",
        summary: "The hook and the settlement token.",
        body: (
          <>
            <H>Deployed contracts</H>
            <P>
              The Dynamic Market Hook, the market factory and the settlement contracts are pending
              production deployment. Their addresses will be published here once live.
            </P>

            <H>Settlement token</H>
            <Table
              head={["Token", "Decimals", "Address"]}
              rows={[
                [
                  "USDC",
                  "6",
                  <A key="u" href={`${BASE_EXPLORER}/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`}>
                    0x833589…2913
                  </A>,
                ],
              ]}
            />
            <Note tone="warn">
              Addresses change between environments. Always read them from configuration rather than
              hardcoding, and re-verify against the token issuer before moving funds.
            </Note>
          </>
        ),
      },
      {
        id: "support",
        title: "Support",
        summary: "Where to ask, report, and follow along.",
        body: (
          <>
            <UL>
              <li>
                <B>Discord</B>: <A href="https://discord.gg/kUfEpzvaFf">join the server</A> for
                questions and product discussion.
              </li>
              <li>
                <B>Updates</B>: <A href="https://substack.com/@mantuanews">Substack</A> and{" "}
                <A href="https://x.com/Mantua_AI">X</A>.
              </li>
            </UL>
            <Note tone="warn">
              Nobody from Mantua will ever ask for your seed phrase, private key, or passkey. Treat
              any such request as an attack, wherever it comes from.
            </Note>
          </>
        ),
      },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_GROUPS.flatMap((g) => g.pages);
