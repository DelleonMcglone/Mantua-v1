# AgenticCommerce (ERC-8183) — Base Mainnet deploy

**Base Mainnet deployment pending — see `docs/tasks/v2-roadmap.md`.**
No mainnet addresses exist yet; once deployed, record the proxy +
implementation here and set the address via the server env (the
AgenticCommerce address is env-driven, with no checked-in default).

`DeployAgenticCommerceBase.s.sol` (alongside this file) deploys the
implementation plus an ERC1967 proxy (UUPS, solc 0.8.28, OZ v5.6
upgradeable) initialized with:

- `paymentToken` = Base Mainnet USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `treasury` = `TREASURY` env var
- `admin` = `ADMIN` env var

Note: the `AgenticCommerce.sol` implementation source is not checked in
here — the script imports it from `../src/AgenticCommerce.sol` relative
to the Foundry project it is copied into.

Run (from that project, with `TREASURY` and `ADMIN` exported):

```bash
forge script script/DeployAgenticCommerceBase.s.sol:DeployAgenticCommerceBase \
  --rpc-url https://mainnet.base.org \
  --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY" \
  --account mantua-deployer \
  --sender "$(cast wallet address --account mantua-deployer)"
```

Verify post-deploy with cast: `paymentToken()`, `platformTreasury()`,
`jobCounter() == 0`, and `hasRole(DEFAULT_ADMIN_ROLE, admin) == true`.
Then wire the proxy address into the server env so the agent's job
tools (create/fund/settle/status) can route to it.
