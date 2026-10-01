/**
 * What the header's account corner should show. The login provider can
 * hold a session with no wallet on it yet — embedded-wallet creation runs
 * at login and can fail (it did whenever the provider's frame was blocked).
 * That state used to fall through to "logged out" with the login handlers
 * removed: two buttons that did nothing. It is its own state.
 */
export type AuthView = "logged-out" | "wallet-setup" | "signed-in";

export function authView(a: {
  authenticated: boolean;
  walletAddress?: string | null | undefined;
}): AuthView {
  if (!a.authenticated) return "logged-out";
  return a.walletAddress ? "signed-in" : "wallet-setup";
}
