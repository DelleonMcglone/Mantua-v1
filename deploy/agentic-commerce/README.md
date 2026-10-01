# AgenticCommerce (ERC-8183) — Arc Mainnet deploy

**Status: deployed on Arc Mainnet 2026-10-01** (owner keystore, block 23770188) and verified on Sourcify. Production address: proxy `0xC8972dd832f4465ad068c754062B01d2f7216b8D`. See _Deployment record_ at the end. The contract is a vendored third-party escrow (see below), and it takes custody of USDC.

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

## Deployment record (2026-10-01)

Deployer / treasury / admin: `0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3`.
Payment token: Arc USDC `0x3600000000000000000000000000000000000000`.

**In use — set as `AGENTIC_COMMERCE_ADDRESS`:**

| Contract                 | Address                                      | Tx                                                                   |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| ERC8183 (implementation) | `0x44C6169851917A394b92670E6275110F90Ee3674` | `0xa712af08c92d9d107b00aecc44f0d72e0a593bc1b2db157cca0798c433b200ac` |
| ERC1967Proxy             | `0xC8972dd832f4465ad068c754062B01d2f7216b8D` | `0x4193a2425e9870bf98d37dac49971f31c1b7454e262f7ac13cc439bdfb0dc6df` |
| `setPaymentTokenAllowed` | —                                            | `0x9ffee3ab7f510b64960a7e55d6571515e37f07eda539aad121e60575445da2db` |

Block 23770188 (2026-10-01 21:04:13 UTC), deployer nonces 12–14. Probed
after deploy: `platformTreasury()` = deployer, `allowedPaymentTokens(USDC)`
= true, `jobCounter()` = 0, ERC-1967 implementation slot = the
implementation above, deployer holds `DEFAULT_ADMIN_ROLE`. Both contracts
`Pass - match` on Sourcify (solc 0.8.35).

**Duplicate — not used.** The broadcast command ran a second time about
ninety seconds later (block 23770348, nonces 15–17), producing an
identical, fully initialised second stack: implementation
`0x870Ec84f3fE90D8935161C6d0Ad83F61bC8703A5`, proxy
`0x15be58C4Aa4C90151A1E86c9681B25B88D56ca7C`. It holds no funds, has no
jobs, is owned by the same admin, and nothing references it. It is
verified on Sourcify so nobody mistakes it for something unknown. It can
be left alone, or paused by the admin (`pause()`) for tidiness. Cost of
the duplicate: about 0.19 USDC of gas.
