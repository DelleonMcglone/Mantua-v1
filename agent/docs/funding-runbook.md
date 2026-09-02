<!--
Purpose: Manual runbook for funding the Base agent's wallet on mainnet.
Gas is paid in ETH; escrow/transfers use real USDC. This is a human
runbook, not an automated loop — every step moves real funds.
-->

# Base Agent — Funding Runbook (mainnet)

The agent runs on **Base Mainnet**. Gas is paid in **ETH**; job escrow and
transfers use **real USDC** (6-decimal ERC-20 at
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). There is **no free test
money** — every top-up is real, so fund deliberately and keep balances small.

## One-time / top-up steps

1. Get the agent address. With `agent/.env` configured, run:
   ```bash
   npm run start -w @mantua/agent
   ```
   It prints the registered actions; the wallet address is the account derived
   from `AGENT_PRIVATE_KEY`. (Or run the `check_balances` action.)
2. Fund **ETH for gas** (small amounts go a long way on Base):
   - Withdraw ETH directly **to Base** from an exchange that supports Base
     withdrawals (e.g. Coinbase), or
   - Bridge ETH from Ethereum mainnet via the official Base bridge
     (https://bridge.base.org).
   - Double-check the network is **Base** before sending — funds sent on the
     wrong network are lost.
3. Fund **USDC** (only what the agent needs for imminent escrow/transfers):
   - Withdraw USDC **on Base** from an exchange, or
   - Mint/redeem via **Circle Mint** (business accounts:
     https://www.circle.com/circle-mint) and withdraw to Base, or
   - Transfer USDC from another wallet you control on Base (or bridge from
     another chain via Circle CCTP).
4. Verify with the `check_balances` action — it reports USDC/EURC/cbBTC
   (6/6/8-dp ERC-20) plus the native ETH gas balance and warns when gas is
   below `LOW_GAS_WARN_ETH`.

## Low-gas handling

- The `check_balances` action emits a `⚠️ Low gas` warning when the ETH
  balance drops below `LOW_GAS_WARN_ETH` (default 0.001 ETH).
- On a warning, repeat the ETH funding steps above. Top up manually — do
  **not** script automated transfers into a hot wallet.

## Notes

- This is a mainnet hot wallet: keep only working balances on it, never
  commit the key, and rotate it if you suspect exposure.
- Decimals: USDC/EURC use 6 decimals, cbBTC uses 8, ETH gas uses 18 (viem's
  `parseEther`/`formatEther`; see `src/lib/decimals.ts` for USDC helpers).
- Allowlisted assets only: USDC, EURC, cbBTC.
