import type { ReactNode } from "react";
import { P, H, UL, OL, B, Code, A, Note, Table } from "./docs-primitives.tsx";

/**
 * Documentation content, one entry per sidebar page. Kept as data so the
 * page shell stays dumb and adding a topic is a single array entry.
 *
 * Everything factual here is drawn from the deployed system: hook
 * addresses from `features/liquidity/hook-recommendations.ts`, fee tiers
 * from `features/liquidity/fee-tiers.ts`, chain and token details from
 * `docs/architecture.md`. Update this file when those change.
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
              Mantua is an agent-driven prediction market for sports. Bettors and market makers open
              positions, provide liquidity, and run automated strategies, expressed in natural
              language and executed on-chain through Uniswap v4 pools with custom Mantua hooks.
            </P>
            <P>
              Three parts do the work. <B>Hooks</B> put logic inside the pool itself: pricing, fees,
              and risk controls that vanilla AMMs can&apos;t express. <B>Agents</B> turn intent into
              action, buying the intelligence they need per call in USDC and executing on the
              result. The <B>interface</B> ties them together with a portfolio, analytics, and a
              chatbot that routes plain-language instructions to the right surface. Every command,
              including placing bets, can be run from the chatbot.
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
                New here? <B>Getting started</B> covers connecting a wallet and funding it on
                Base.
              </li>
              <li>
                Want the mechanics? <B>Hooks</B> explains what each hook does to a swap.
              </li>
              <li>
                Building or automating? <B>Agents</B> and <B>Networks &amp; contracts</B> have the
                addresses and behavior you need.
              </li>
            </UL>
          </>
        ),
      },
      {
        id: "getting-started",
        title: "Getting started",
        summary: "Connect a wallet, fund it, place your first action.",
        body: (
          <>
            <H>1. Open the app</H>
            <P>
              Select <B>Launch App</B> from anywhere on the site. Browsing markets, pools, and
              analytics is open to everyone. No wallet required.
            </P>

            <H>2. Sign in</H>
            <P>
              Any on-chain transaction needs a logged-in wallet. Sign in with email, a social
              account, a passkey, or an external wallet; a wallet address is created or connected
              for you. Keep your recovery method safe. We can never restore it, and we will never
              ask you for a seed phrase or private key.
            </P>

            <H>3. Fund the wallet</H>
            <P>
              Mantua runs on Base. Send USDC (or EURC / cbBTC) to your wallet address on Base — from
              an exchange that supports Base withdrawals, or by bridging from another chain via the
              app&apos;s built-in bridge.
            </P>
            <Note>
              On Base, <B>ETH is the gas token</B>. Keep a small amount of ETH on Base to pay for
              transactions; your USDC covers the trades themselves.
            </Note>

            <H>4. Do something</H>
            <OL>
              <li>
                Pick a league from the header nav to browse its markets, or open <B>Trading</B> to
                swap and provide liquidity. Every command works from the chatbot too, including
                placing bets, so you never have to start from the header.
              </li>
              <li>
                Type an instruction into the chatbot, like &ldquo;swap 10 USDC for EURC with Stable
                Protection&rdquo;, and it routes to the right panel, pre-filled.
              </li>
              <li>Review the quote, confirm, and sign in your wallet.</li>
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
        title: "Hooks",
        summary: "The three Mantua hooks and what each one changes about a swap.",
        body: (
          <>
            <P>
              A Uniswap v4 hook is a contract the pool calls at defined points in its lifecycle:
              before and after a swap, or a liquidity change. Mantua ships three, each attaching
              behavior a plain pool has no way to express.
            </P>

            <H>Dynamic Market Hook</H>
            <P>
              Powers the prediction markets. It adapts pricing, fees, liquidity, and risk parameters
              in real time from market conditions, volatility, and trading activity, so quoted odds
              track the state of the event rather than sitting still between trades.
            </P>
            <Note>
              Each day&apos;s games mint their markets automatically; their pools open at the
              implied odds and trade under this hook until kickoff freezes them. The Base Mainnet
              deployment is pending — addresses will be published here once live.
            </Note>

            <H>Stable Protection Hook</H>
            <P>
              For stablecoin and dollar-pegged pools. It measures how far the pool has drifted from
              its reference rate on every swap and sorts that deviation into five zones, raising the
              LP fee as the depeg gets worse and halting swaps entirely past 5%.
            </P>
            <Table
              head={["Zone", "Deviation", "Base fee"]}
              rows={[
                ["Healthy", "at peg", "none"],
                ["Minor", "small drift", "5 bps"],
                ["Moderate", "growing", "15 bps"],
                ["Severe", "up to 5.00%", "50 bps"],
                ["Critical", "over 5.00%", "swaps blocked (circuit breaker)"],
              ]}
            />
            <P>
              Fees are also directional: a trade pushing the pool back toward its peg pays half the
              zone&apos;s base fee, while one pushing it further away pays more. Traders who help
              restore the peg are subsidised by those who strain it.
            </P>

            <H>Dynamic Fee Hook</H>
            <P>
              For volatile pairs. It reads Chainlink price feeds and applies Nezlobin directional
              fees across five deviation zones, charging the toxic side of a trade more, so the
              spread accrues to liquidity providers instead of arbitrageurs.
            </P>
          </>
        ),
      },
      {
        id: "agents",
        title: "Agents",
        summary: "How autonomous agents research, decide, and execute.",
        body: (
          <>
            <P>
              An agent turns an instruction into on-chain action. Give it a goal in plain language
              and it researches, decides, and executes, including while you are away.
            </P>

            <H>Buying intelligence</H>
            <P>
              When an agent hits a question it can&apos;t answer from what it already has, it
              searches the x402 marketplace and pays per call in USDC. No API keys to provision, no
              accounts to create, no subscriptions to prefund. Every purchase is capped and written
              to an audit log.
            </P>

            <H>Acting on it</H>
            <P>
              The agent combines what it bought with live on-chain signals (pool health, peg status,
              flow) and executes: take a position, swap, provide liquidity, bridge, or exit on a
              signal-gated schedule.
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
        summary: "How a market prices, halts, and resolves.",
        body: (
          <>
            <H>Pricing</H>
            <P>
              Prices come from the pool, not from a bookmaker. Each outcome trades against
              liquidity, and the Dynamic Market Hook adjusts fees and parameters as conditions
              change. A quoted price is the market&apos;s current forecast. It moves when
              participants disagree with it.
            </P>

            <H>Halts</H>
            <P>
              Pools can stop accepting swaps under conditions defined in advance. The Stable
              Protection Hook&apos;s circuit breaker is the clearest case: past 5% deviation, swaps
              are blocked until the pool recovers. This is deliberate: it protects LPs from
              absorbing a depeg, and it is enforced by the contract, not by an operator decision.
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
        id: "trading",
        title: "Trading",
        summary: "Swapping assets through hook-powered pools.",
        body: (
          <>
            <OL>
              <li>
                Open <B>Trading</B> from the header, or just ask the chatbot. Any command, including
                placing bets, can be typed there directly.
              </li>
              <li>Choose the pair and the amount you want to sell.</li>
              <li>
                Pick a venue: a hook-powered pool, a plain pool with no hook, or the bridge for
                moving USDC across chains.
              </li>
              <li>
                Review the quote. Hook pools price the fee at execution, so what you see reflects
                current conditions, not a fixed tier.
              </li>
              <li>Confirm and sign. The transaction hash appears when it lands.</li>
            </OL>

            <H>If a quote fails</H>
            <UL>
              <li>
                <B>Insufficient liquidity</B>: the pool returned almost nothing for that size. Try a
                smaller amount, a different fee tier, or the no-hook venue.
              </li>
              <li>
                <B>Hook unavailable for this pair</B>: that hook doesn&apos;t serve those tokens.
                Stable Protection is for stable pairs; Dynamic Fee is for volatile ones.
              </li>
              <li>
                <B>Swaps blocked</B>: Stable Protection&apos;s circuit breaker has tripped on a real
                depeg. This clears when the pool returns inside the threshold.
              </li>
            </UL>
          </>
        ),
      },
      {
        id: "liquidity",
        title: "Providing liquidity",
        summary: "Creating a pool or adding to one.",
        body: (
          <>
            <OL>
              <li>Sign in and open the Liquidity surface from the home menu or the command bar.</li>
              <li>
                Select an existing pool, or create one by choosing a pair, fee tier, and hook.
              </li>
              <li>Enter amounts for both sides and review the position.</li>
              <li>
                Approve the tokens if prompted, then confirm. Creating a pool initialises it and
                adds liquidity in the same flow.
              </li>
            </OL>

            <H>Fee tiers</H>
            <Table
              head={["Tier", "Fee", "Typical use"]}
              rows={[
                [<Code key="a">100</Code>, "0.01%", "Stable pairs"],
                [<Code key="b">500</Code>, "0.05%", "cbBTC / stable"],
                [<Code key="c">3000</Code>, "0.30%", "cbBTC pairs"],
                [<Code key="d">10000</Code>, "1.00%", "Wide range"],
              ]}
            />
            <Note>
              On a hook-powered pool the tier is a starting point: the hook sets the fee actually
              charged at execution, which is the point of using one.
            </Note>

            <H>Risk</H>
            <P>
              Providing liquidity exposes you to impermanent loss, to the assets in the pair, and to
              the contracts involved. Fees earned may not offset price divergence. Manage positions
              from the Positions view, where you can also remove liquidity.
            </P>
          </>
        ),
      },
    ],
  },
  {
    label: "Reference",
    pages: [
      {
        id: "networks",
        title: "Networks and contracts",
        summary: "Chain details, deployed hooks, and token addresses.",
        body: (
          <>
            <H>Base</H>
            <Table
              head={["Field", "Value"]}
              rows={[
                ["Chain ID", <Code key="id">8453</Code>],
                ["RPC", <Code key="rpc">https://mainnet.base.org</Code>],
                [
                  "Explorer",
                  <A key="ex" href="https://basescan.org">
                    basescan.org
                  </A>,
                ],
                ["Gas token", "ETH"],
              ]}
            />

            <H>Deployed hooks</H>
            <P>
              The Mantua hooks (Stable Protection, Dynamic Fee, Dynamic Market) are pending
              deployment on Base Mainnet. Their addresses will be published here once live; until
              then, hook venues degrade gracefully to the no-hook path.
            </P>

            <H>Tokens</H>
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
                [
                  "EURC",
                  "6",
                  <A key="e" href={`${BASE_EXPLORER}/0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42`}>
                    0x60a3E3…db42
                  </A>,
                ],
                [
                  "cbBTC",
                  "8",
                  <A key="c" href={`${BASE_EXPLORER}/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`}>
                    0xcbB7C0…33Bf
                  </A>,
                ],
              ]}
            />
            <Note tone="warn">
              Addresses change between environments. Always read them from configuration rather
              than hardcoding, and re-verify against the token issuer before moving funds.
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
