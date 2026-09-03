import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { BASE_CHAIN_ID, CHAIN_INFO } from "@/lib/chains.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

interface WalletMenuProps {
  walletAddress: string;
  onDisconnect: () => void;
  /** Routes to the profile/portfolio page (B6-008). */
  onOpenProfile?: (() => void) | undefined;
  /** Routes to the agent panel, where the spending cap lives (B6-012). */
  onOpenAgent?: (() => void) | undefined;
}

const ITEM_CLASS = "justify-between px-3 py-2 data-[highlighted]:bg-chip";

/**
 * Connected-wallet pill in the header. Click toggles a dropdown with
 * Copy address / View on BaseScan / Refresh balances / Disconnect.
 * Built on the shared Radix dropdown primitive (menu roles, arrow-key
 * nav, Escape + outside-click dismissal, focus return). Refresh
 * dispatches `mantua:refresh-portfolio` on the window — the portfolio
 * hooks listen and re-poll immediately.
 */
export function WalletMenu({
  walletAddress,
  onDisconnect,
  onOpenProfile,
  onOpenAgent,
}: WalletMenuProps) {
  const chainId = BASE_CHAIN_ID;
  const { explorerUrl } = CHAIN_INFO[chainId];
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  };

  const handleRefresh = () => {
    window.dispatchEvent(new Event("mantua:refresh-portfolio"));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 h-10 px-3 rounded-sm border border-border bg-transparent text-text-dim hover:bg-bg-elev hover:text-text transition-colors cursor-pointer"
        >
          <span className="h-2 w-2 rounded-full bg-green" />
          <span className="font-mono text-[13px]">{shorten(walletAddress)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[220px] rounded-sm shadow-lg">
        {onOpenProfile && (
          <DropdownMenuItem className={ITEM_CLASS} onSelect={onOpenProfile}>
            Profile &amp; portfolio
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={(e) => {
            // Keep the menu open so the "Copied!" confirmation is visible.
            e.preventDefault();
            handleCopy();
          }}
        >
          {copied ? "Copied!" : "Copy address"}
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM_CLASS}>
          <a
            href={`${explorerUrl}/address/${walletAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline"
          >
            View on explorer
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM_CLASS} onSelect={handleRefresh}>
          Refresh balances
        </DropdownMenuItem>
        {onOpenAgent && (
          <DropdownMenuItem className={ITEM_CLASS} onSelect={onOpenAgent}>
            Agent &amp; spending cap
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM_CLASS} onSelect={onDisconnect}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function shorten(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
