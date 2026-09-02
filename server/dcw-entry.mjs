// Vendor entry for the Vercel build only. esbuild pre-bundles this into a
// self-contained api/_dcw.mjs (the Circle DCW SDK + its sole dep axios, fully
// inlined), which the server bundle then aliases @circle-fin to. See the
// `build:server` script and server/src/lib/circle/client.ts for why: a bare
// dynamic import of the SDK isn't followed by Vercel's file tracer, and the SDK
// lives in server/node_modules (un-hoisted), so inlining is the reliable path.
// Living under server/ lets esbuild resolve the package from server/node_modules.
export * from "@circle-fin/developer-controlled-wallets";
// Circle Contracts (SCP) rides the same bundle — named export only, because a
// wildcard would collide with DCW's shared symbol names (Blockchain, FeeLevel...).
export { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
