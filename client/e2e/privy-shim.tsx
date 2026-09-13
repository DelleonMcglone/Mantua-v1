/**
 * Task 067 (G-001) — the authentication SDK's surface, faked for the
 * browser E2E suite. Aliased in place of `@privy-io/react-auth` by
 * `vite.config.ts` ONLY when `VITE_E2E_AUTH=shim`; a production build never
 * resolves this file. It implements exactly the exports the client uses
 * (`usePrivy`, `useWallets`, `getAccessToken`, `useLoginWithOAuth`,
 * `useLoginWithEmail`, `PrivyProvider`) over one tiny store, and exposes
 * `window.__mantuaE2E` so a spec can sign in deterministically.
 */
import { useSyncExternalStore, type ReactNode } from "react";

export const E2E_ADDRESS = "0x00000000000000000000000000000000000000aa";
const E2E_TX_HASH = `0x${"ab".repeat(32)}`;

const store = { authenticated: false, listeners: new Set<() => void>() };

function emit() {
  for (const l of store.listeners) l();
}
function login() {
  store.authenticated = true;
  emit();
}
function logout() {
  store.authenticated = false;
  emit();
}
function subscribe(l: () => void) {
  store.listeners.add(l);
  return () => {
    store.listeners.delete(l);
  };
}
const read = () => store.authenticated;
function useAuthenticated(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}

/** The wallet's EIP-1193 surface: signs nothing real, answers what viem asks. */
const provider = {
  request: ({ method }: { method: string; params?: unknown }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId":
        return Promise.resolve("0x2105");
      case "eth_accounts":
      case "eth_requestAccounts":
        return Promise.resolve([E2E_ADDRESS]);
      case "eth_signTransaction":
        return Promise.resolve(`0x02f8${"00".repeat(64)}`);
      case "eth_sendTransaction":
        return Promise.resolve(E2E_TX_HASH);
      case "personal_sign":
      case "eth_signTypedData_v4":
        return Promise.resolve(`0x${"11".repeat(65)}`);
      case "wallet_switchEthereumChain":
        return Promise.resolve(null);
      default:
        return Promise.reject(new Error(`e2e provider: unsupported ${method}`));
    }
  },
};

const wallet = {
  address: E2E_ADDRESS,
  chainId: "eip155:8453",
  walletClientType: "privy",
  connectorType: "embedded",
  getEthereumProvider: () => Promise.resolve(provider),
  switchChain: () => Promise.resolve(),
};

export function PrivyProvider({
  children,
}: {
  children: ReactNode;
  appId?: string;
  config?: unknown;
}) {
  return <>{children}</>;
}

export function usePrivy() {
  const authenticated = useAuthenticated();
  return {
    ready: true,
    authenticated,
    user: authenticated
      ? { id: "did:privy:e2e", wallet: { address: E2E_ADDRESS, chainId: "eip155:8453" } }
      : null,
    login,
    logout: () => {
      logout();
      return Promise.resolve();
    },
    getAccessToken: () => Promise.resolve(authenticated ? "e2e-token" : null),
  };
}

export function useWallets() {
  const authenticated = useAuthenticated();
  return { ready: true, wallets: authenticated ? [wallet] : [] };
}

export function getAccessToken(): Promise<string | null> {
  return Promise.resolve(store.authenticated ? "e2e-token" : null);
}

export function useLoginWithOAuth() {
  return {
    loading: false,
    state: { status: "initial" },
    initOAuth: () => {
      login();
      return Promise.resolve();
    },
  };
}

export function useLoginWithEmail() {
  return {
    state: { status: "initial" },
    sendCode: () => Promise.resolve(),
    loginWithCode: () => {
      login();
      return Promise.resolve();
    },
  };
}

declare global {
  interface Window {
    __mantuaE2E?: { login: () => void; logout: () => void };
  }
}
window.__mantuaE2E = { login, logout };
