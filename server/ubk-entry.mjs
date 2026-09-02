// Pre-bundle entry for the Unified Balance Kit + Circle Wallets adapter.
//
// Bundled (like dcw-entry.mjs) into api/_ubk.mjs by scripts/build-server.mjs so
// the Vercel function ships them. Bundling also fixes the runtime crash where
// @circle-fin/adapter-circle-wallets does `import { Blockchain } from
// "@circle-fin/developer-controlled-wallets"`: DCW is CJS and Node's ESM loader
// can't see that named export, but esbuild resolves CJS named exports at bundle
// time. pass 2 aliases both packages to this bundle.
export { UnifiedBalanceKit } from "@circle-fin/unified-balance-kit";
export { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
// Bridge Kit shares the same Circle-Wallets adapter; bundle it here too so the
// agent's server-side bridge tool ships in the Vercel function.
export { BridgeKit } from "@circle-fin/bridge-kit";
// Viem private-key adapter — the Gateway spend delegate (admin EOA) signs burn
// intents with it, since the agent SCA can't produce ECDSA signatures.
export { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
