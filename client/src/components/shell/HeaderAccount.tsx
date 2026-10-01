import { Button } from "@/components/ui/button.tsx";
import { WalletMenu } from "./WalletMenu.tsx";

export interface WalletSetup {
  status: "idle" | "creating" | "failed";
  onRetry: () => void;
}

interface HeaderAccountProps {
  walletAddress?: string | undefined;
  onLogin?: (() => void) | undefined;
  onSignup?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  walletSetup?: WalletSetup | undefined;
  onOpenProfile?: (() => void) | undefined;
  onOpenAgent?: (() => void) | undefined;
}

/**
 * The header's account corner, in its three states (lib/auth-view.ts):
 * signed in (the wallet menu), signed in without a wallet yet (setup
 * progress and a way out — never login buttons that do nothing), and
 * logged out (Log in / Sign up).
 */
export function HeaderAccount({
  walletAddress,
  onLogin,
  onSignup,
  onDisconnect,
  walletSetup,
  onOpenProfile,
  onOpenAgent,
}: HeaderAccountProps) {
  return walletAddress && onDisconnect ? (
    <WalletMenu
      walletAddress={walletAddress}
      onDisconnect={onDisconnect}
      onOpenProfile={onOpenProfile}
      onOpenAgent={onOpenAgent}
    />
  ) : onDisconnect ? (
    <>
      {walletSetup?.status === "failed" ? (
        <Button variant="primary" className="px-3 md:px-4" onClick={walletSetup.onRetry}>
          Finish setup
        </Button>
      ) : (
        <span className="px-1 text-[13px] text-text-dim" role="status">
          Setting up your account…
        </span>
      )}
      <Button variant="ghost" className="px-2.5 md:px-4" onClick={onDisconnect}>
        Log out
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" className="px-2.5 md:px-4" onClick={onLogin}>
        Log in
      </Button>
      <Button variant="primary" className="px-3 md:px-4" onClick={onSignup}>
        Sign up
      </Button>
    </>
  );
}
