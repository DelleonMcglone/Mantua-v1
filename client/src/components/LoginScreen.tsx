import { Button } from "@/components/ui/button.tsx";
import { Logo } from "@/components/shell/Logo.tsx";

interface LoginScreenProps {
  onLogin: () => void;
  loading?: boolean;
}

/**
 * PD-006 — login screen. Visual style matches the prototype's welcome
 * modal: centered logo box (gradient backdrop), title + tagline, single
 * primary CTA, fine print listing supported login methods.
 *
 * Login methods come from D-005: email + Google + Apple + passkey + wallet.
 * The handler comes from `usePrivy().login` once App resolves auth state.
 */
export function LoginScreen({ onLogin, loading }: LoginScreenProps) {
  if (loading) {
    return (
      <main className="min-h-screen bg-bg text-text flex items-center justify-center">
        <p className="text-sm text-text-dim">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-7">
        <div className="mx-auto h-24 w-24 rounded-md flex items-center justify-center border border-border-soft bg-gradient-to-br from-accent-2/20 via-amber/5 to-transparent">
          <Logo size={56} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Mantua</h1>
          <p className="text-sm text-text-dim leading-relaxed">
            A liquidity copilot that researches, routes, and executes with you — or on its own — on
            Base.
          </p>
        </div>
        <Button variant="primary" size="lg" className="w-full" onClick={onLogin}>
          Continue
        </Button>
        <p className="text-xs text-text-mute">Email · Google · Apple · Passkey · External wallet</p>
      </div>
    </main>
  );
}
