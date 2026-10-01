# AgenticCommerce (ERC-8183) — Arc Mainnet deploy

**Status: not deployed. Owner-gated on the L-003 audit** — the contract is
a vendored third-party escrow (see below), and it takes custody of USDC.

## What ships

`contracts/script/DeployAgenticCommerce.s.sol` deploys the **ERC-8183
reference implementation** — [`erc-8183/base-contracts`](https://github.com/erc-8183/base-contracts)
at commit `142e669` (MIT), vendored under `contracts/lib/base-contracts`
with OpenZeppelin upgradeable v5.7.0 — as a UUPS implementation behind an
`ERC1967Proxy`, then:

- `initialize(treasury, admin)` — `TREASURY` receives platform fees
  (`platformFeeBP` starts at 0); `ADMIN` holds `DEFAULT_ADMIN_ROLE` (upgrades)
  and `ADMIN_ROLE` (pause, hook + payment-token allowlists).
- `setPaymentTokenAllowed(USDC, true)` — Arc USDC `0x3600…0000` is the only
  payment token; the reference refuses `setBudget` on anything else.

Three transactions in one broadcast; the broadcasting key must be `ADMIN`.
The original `AgenticCommerce.sol` this repo's deploy script once imported
never existed in this repository (it lived in the deleted agent workspace,
C-018); the reference implements the same job lifecycle the server drives
(`server/src/lib/agent-commerce.ts` — ABI pinned by
`agent-commerce.test.ts` against the compiled artifact).

## Deploy (owner runs; keystore prompt, never a key in the environment)

```bash
cd contracts && TREASURY=0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3 ADMIN=0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3 \
  forge script script/DeployAgenticCommerce.s.sol --rpc-url https://rpc.mainnet.arc.io \
  --account mantua-deployer --sender 0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3 --broadcast
```

Dry run (no key): drop `--account`/`--broadcast`. Verified 2026-09-30:
`Script ran successfully`, ~6.17M gas (≈0.25 USDC at 40 gwei).

## After deploying

1. Verify on Arcscan via Sourcify: `deploy/dynamic-market/verify.sh
lib/base-contracts/contracts/ERC8183.sol:ERC8183 <impl>` and the proxy
   (`lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy <proxy>
"$(cast abi-encode 'constructor(address,bytes)' <impl> <init-calldata>)"`).
2. Probe: `cast call <proxy> "platformTreasury()(address)"`,
   `"allowedPaymentTokens(address)(bool)" 0x3600…0000`, `"jobCounter()(uint256)"`.
3. Set `AGENTIC_COMMERCE_ADDRESS=<proxy>` in Vercel production (the address is
   allow-listed as an agent target through `circle/allowed-targets.ts`).
4. Record proxy + implementation here.
