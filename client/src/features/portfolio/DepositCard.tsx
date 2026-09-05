import { useMemo, useState } from "react";
import { renderSVG } from "uqr";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CopyButton } from "@/features/agent/agent-primitives.tsx";
import { useAgentPortfolio } from "@/features/agent/use-agent-portfolio.ts";

/**
 * The one sanctioned network warning (C-011 chainless carve-out,
 * docs/architecture.md "Deposit → Trade → Withdraw"): naming the chain at
 * the point of deposit is fund-loss safety, and this deposit surface is
 * the ONLY place in the app allowed to do it.
 */
function NetworkWarning() {
  return (
    <p className="rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] leading-relaxed text-amber">
      Sending from an exchange? Choose the <strong>Base</strong> network when you withdraw. Funds
      sent on any other network can&apos;t be recovered.
    </p>
  );
}

function AcceptedTokens() {
  return (
    <p className="text-[12px] leading-relaxed text-text-dim">
      Accepted: <strong className="text-text">USDC</strong> (everything here is priced and settled
      in it) — EURC and cbBTC also work as tradeable assets.
    </p>
  );
}

/** Address block: QR + full address + copy. QR is generated locally (uqr), no network fetch. */
function AddressBlock({ address, qrLabel }: { address: string; qrLabel: string }) {
  const qrSrc = useMemo(() => {
    const svg = renderSVG(address, { pixelSize: 4, blackColor: "#000", whiteColor: "#fff" });
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [address]);
  return (
    <div className="flex items-start gap-4">
      <img
        src={qrSrc}
        alt={qrLabel}
        width={132}
        height={132}
        className="shrink-0 rounded-sm bg-white p-1"
      />
      <div className="min-w-0">
        <p className="break-all font-mono text-[13px] leading-relaxed">{address}</p>
        <div className="mt-1.5">
          <CopyButton value={address} label="Copy address" size={12} />
        </div>
      </div>
    </div>
  );
}

interface Props {
  walletAddress?: string | undefined;
  onClose: () => void;
  /** "Send from my wallet" on the agent tab — pre-fills the withdraw flow. */
  onSendFromWallet: (recipient: string) => void;
  initialTab?: "wallet" | "agent" | undefined;
}

/**
 * 029 / C-011 GAP-1 + GAP-2 — the deposit surface. Tab one shows the
 * user's own wallet address (copy + QR); tab two shows the agent wallet
 * with the same affordances plus a one-tap "Send from my wallet" that
 * opens the withdraw flow pre-filled with the agent address (a
 * user-signed transfer — the agent path never touches the user's key,
 * per D-008, and this doesn't cross that boundary).
 */
export function DepositCard({ walletAddress, onClose, onSendFromWallet, initialTab }: Props) {
  const [tab, setTab] = useState<string>(initialTab ?? "wallet");
  const agent = useAgentPortfolio();

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit</DialogTitle>
          <DialogDescription>
            Send USDC to a wallet address below — from an exchange or another wallet.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 gap-4 border-b border-border-soft">
            {(
              [
                ["wallet", "Your wallet"],
                ["agent", "Fund your agent"],
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className={`border-b-2 pb-2 text-[13px] font-medium transition-colors ${
                  tab === value
                    ? "border-accent text-text"
                    : "border-transparent text-text-dim hover:text-text"
                }`}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="wallet" className="space-y-4">
            {walletAddress ? (
              <AddressBlock address={walletAddress} qrLabel="QR code for your wallet address" />
            ) : (
              <p className="text-[12.5px] text-text-dim">
                No wallet connected — log in to see your deposit address.
              </p>
            )}
            <NetworkWarning />
            <AcceptedTokens />
          </TabsContent>

          <TabsContent value="agent" className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-text-dim">
              Your agent trades from its own wallet. Fund it directly, or send from your wallet
              below.
            </p>
            {agent.agentAddress ? (
              <>
                <AddressBlock
                  address={agent.agentAddress}
                  qrLabel="QR code for your agent's wallet address"
                />
                <NetworkWarning />
                <AcceptedTokens />
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    if (agent.agentAddress) onSendFromWallet(agent.agentAddress);
                  }}
                >
                  Send from my wallet
                </Button>
              </>
            ) : agent.notProvisioned ? (
              <p className="text-[12.5px] text-text-dim">
                No agent wallet yet — open the Agent panel to create one first.
              </p>
            ) : agent.error ? (
              <p role="alert" className="text-xs text-red">
                {agent.error}
              </p>
            ) : (
              <p role="status" className="text-[12.5px] text-text-dim">
                Loading agent wallet…
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
