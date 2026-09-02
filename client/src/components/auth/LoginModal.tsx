import { useEffect, useState } from "react";
import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import metamaskLogo from "@/assets/wallets/metamask.svg";
import coinbaseLogo from "@/assets/wallets/coinbase.svg";
import rabbyLogo from "@/assets/wallets/rabby.svg";
import okxLogo from "@/assets/wallets/okx.svg";
import rainbowLogo from "@/assets/wallets/rainbow.svg";
import walletConnectLogo from "@/assets/wallets/walletconnect.svg";

/**
 * Custom login modal (B6-002, Polymarket-style layout): primary Google
 * button, OR divider, email → code flow, wallet tile grid. Built on
 * Privy's HEADLESS hooks — Privy's prebuilt modal can't be re-laid-out,
 * so Google and email run fully in this UI, while the wallet tiles hand
 * off to Privy's wallet selector (the flow that needs injected-provider
 * plumbing we'd rather not own).
 */

/** Brand logos bundled locally (official brand repos + rainbowkit's
 *  MIT-licensed connector icons) — no external image hosts at runtime.
 *  WalletConnect sits last and doubles as the "more wallets" door. */
const WALLETS = [
  { name: "MetaMask", logo: metamaskLogo },
  { name: "Coinbase", logo: coinbaseLogo },
  { name: "Rabby", logo: rabbyLogo },
  { name: "OKX", logo: okxLogo },
  { name: "Rainbow", logo: rainbowLogo },
  { name: "WalletConnect", logo: walletConnectLogo, more: true },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: Props) {
  const { authenticated, login } = usePrivy();
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"start" | "code">("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success from any path closes the modal.
  useEffect(() => {
    if (authenticated && open) onClose();
  }, [authenticated, open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleGoogle = async () => {
    setError(null);
    try {
      await initOAuth({ provider: "google" });
    } catch {
      setError("Google sign-in didn't start. Try again.");
    }
  };

  const handleSendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCode({ email: email.trim() });
      setStep("code");
    } catch {
      setError("Couldn't send the code — check the address.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithCode({ code: code.trim() });
      // authenticated effect closes the modal
    } catch {
      setError("That code didn't match. Re-enter it or resend.");
    } finally {
      setBusy(false);
    }
  };

  const handleWallet = () => {
    // Hand off to Privy's wallet selector — close ours first so the two
    // modals never stack.
    onClose();
    login({ loginMethods: ["wallet"] });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log in or sign up"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-md border border-border bg-panel-solid p-6"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Log in or sign up</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-text-mute hover:text-text cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "start" ? (
          <>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={oauthLoading}
              onClick={() => {
                void handleGoogle();
              }}
            >
              <GoogleGlyph />
              {oauthLoading ? "Opening Google…" : "Continue with Google"}
            </Button>

            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-text-mute">
              <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
              or
              <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
            </div>

            <div className="flex gap-2">
              <input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.includes("@")) void handleSendCode();
                }}
                type="email"
                placeholder="Email address"
                className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-3 text-[13px] outline-none placeholder:text-text-mute"
              />
              <Button
                variant="ghost"
                disabled={busy || !email.includes("@")}
                onClick={() => {
                  void handleSendCode();
                }}
              >
                Continue
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {WALLETS.map((wallet) => (
                <button
                  key={wallet.name}
                  type="button"
                  onClick={handleWallet}
                  className="flex flex-col items-center gap-1.5 rounded-sm border border-border-soft px-2 py-3 text-[11px] text-text-dim transition-colors hover:border-accent/40 hover:text-text cursor-pointer"
                >
                  <img src={wallet.logo} alt="" className="h-6 w-6 rounded-[4px] object-contain" />
                  {"more" in wallet ? (
                    <span className="text-center leading-tight">
                      {wallet.name}
                      <span className="block text-[9px] text-text-mute">+ more wallets</span>
                    </span>
                  ) : (
                    wallet.name
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-text-dim">
              We sent a 6-digit code to <span className="text-text">{email}</span>.
            </p>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) void handleVerify();
              }}
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              className="mt-3 h-11 w-full rounded-sm border border-border bg-transparent px-3 text-center font-mono text-[18px] tracking-[0.4em] outline-none placeholder:text-text-mute"
            />
            <Button
              variant="primary"
              size="lg"
              className="mt-3 w-full"
              disabled={busy || code.length !== 6}
              onClick={() => {
                void handleVerify();
              }}
            >
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <button
              type="button"
              className="mt-3 w-full text-center text-[12px] text-text-mute hover:text-text cursor-pointer"
              onClick={() => {
                setStep("start");
                setCode("");
              }}
            >
              Use a different email or resend
            </button>
          </>
        )}

        {error && <p className="mt-3 text-[12px] text-yellow">{error}</p>}

        <p className="mt-5 text-center text-[10.5px] text-text-mute">
          Protected by Privy · By continuing you agree to the Terms of Use.
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.9-5.35 3.9a6 6 0 1 1 0-12c1.5 0 2.85.55 3.9 1.45l2.15-2.15A9 9 0 1 0 12 21c5.2 0 8.85-3.65 8.85-8.8 0-.4-.05-.75-.1-1.1Z"
      />
    </svg>
  );
}
