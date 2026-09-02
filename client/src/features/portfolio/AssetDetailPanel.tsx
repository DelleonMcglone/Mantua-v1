import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { PanelHeader } from "@/components/shell/PanelHeader.tsx";
import { PanelSubHeader } from "@/components/shell/PanelSubHeader.tsx";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { CHAIN_INFO } from "@/lib/chains.ts";
import { getTokens, type TokenSymbol } from "@/lib/tokens.ts";
import { AssetIcon } from "./asset-icons.tsx";
import {
  toDisplayAssets,
  usePortfolio,
  type DisplayAsset,
  type PortfolioTransaction,
} from "./use-portfolio.ts";

interface Props {
  symbol: TokenSymbol;
  onClose?: () => void;
}

/**
 * Asset detail — opened by clicking a row in the Assets tab. Shows the
 * token's balance + USD value at top, then a filtered list of recent
 * portfolio transactions involving this token (swaps where it's the
 * in/out leg, pool creates / liquidity adds where it's one of the pair,
 * sends where it's the token moved). Each row links to BaseScan.
 */
export function AssetDetailPanel({ symbol, onClose }: Props) {
  const chainId = useCurrentChainId();
  const portfolio = usePortfolio();
  const asset = useMemo<DisplayAsset | null>(() => {
    if (!portfolio.walletAddress) return null;
    const all = toDisplayAssets(portfolio.balances, chainId);
    return all.find((a) => a.symbol === symbol) ?? null;
  }, [portfolio.walletAddress, portfolio.balances, symbol, chainId]);

  // `meta` is undefined when the user deep-links to a token that doesn't
  // exist on the active chain. Falls back to the bare symbol so the
  // panel still renders.
  const meta = getTokens(chainId)[symbol] ?? { name: symbol };
  const explorerUrl = CHAIN_INFO[chainId].explorerUrl;
  const txs = useMemo(
    () => portfolio.transactions.filter((t) => txInvolvesSymbol(t, symbol)),
    [portfolio.transactions, symbol],
  );

  return (
    <>
      <PanelHeader />
      <PanelSubHeader
        title={meta.name}
        subtitle={`${symbol}${asset?.price ? ` · ${asset.price}` : ""}`}
        {...(onClose ? { onClose } : {})}
      />

      <div className="flex-1 overflow-auto px-5 pt-2 pb-5 space-y-4">
        <div className="flex items-center gap-3 p-4 bg-bg-elev rounded-md border border-border-soft">
          <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex">
            <AssetIcon symbol={symbol} size={36} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-text-mute">Balance</div>
            <div className="text-[18px] font-mono mt-0.5">{asset?.qty ?? "0.00"}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-text-mute">Value</div>
            <div className="text-[18px] font-mono mt-0.5">{asset?.val ?? "—"}</div>
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-mute mb-2">
            Transactions
          </div>
          {!portfolio.walletAddress && (
            <p className="px-1 py-6 text-[12px] text-text-dim text-center">
              Connect a wallet to see transactions.
            </p>
          )}
          {portfolio.walletAddress && txs.length === 0 && (
            <p className="px-1 py-6 text-[12px] text-text-dim text-center">
              No transactions yet for {symbol}.
            </p>
          )}
          {portfolio.walletAddress && txs.length > 0 && (
            <div className="space-y-1.5">
              {txs.map((t) => (
                <TxRow key={t.id} tx={t} symbol={symbol} explorerUrl={explorerUrl} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TxRow({
  tx,
  symbol,
  explorerUrl,
}: {
  tx: PortfolioTransaction;
  symbol: TokenSymbol;
  explorerUrl: string;
}) {
  const label = describeTx(tx, symbol);
  const when = formatRelative(tx.createdAt);
  const usd = tx.usdValue
    ? `$${Number(tx.usdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  return (
    <a
      href={`${explorerUrl}/tx/${tx.txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-sm border border-border-soft bg-bg-elev hover:bg-row-hover transition-colors no-underline"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-text">{label}</div>
        <div className="text-[11px] text-text-dim mt-0.5">
          {when}
          {tx.outcome !== "success" && <span className="ml-1.5 text-red">· {tx.outcome}</span>}
        </div>
      </div>
      {usd && <div className="text-[12px] font-mono text-text-dim">{usd}</div>}
      <ArrowUpRight className="h-3.5 w-3.5 text-text-mute" />
    </a>
  );
}

const ACTION_LABELS: Record<string, string> = {
  swap: "Swap",
  add_liquidity: "Add liquidity",
  remove_liquidity: "Remove liquidity",
  create_pool: "Create pool",
  send_tokens: "Send",
};

function describeTx(tx: PortfolioTransaction, symbol: TokenSymbol): string {
  const verb = ACTION_LABELS[tx.action] ?? tx.action;
  const p = tx.params;
  if (tx.action === "swap") {
    const tokenIn = strOrNull(p["tokenIn"]);
    const tokenOut = strOrNull(p["tokenOut"]);
    if (tokenIn && tokenOut) return `${verb} ${tokenIn} → ${tokenOut}`;
  }
  if (tx.action === "add_liquidity" || tx.action === "create_pool") {
    const tokenA = strOrNull(p["tokenA"]);
    const tokenB = strOrNull(p["tokenB"]);
    if (tokenA && tokenB) return `${verb} ${tokenA} / ${tokenB}`;
  }
  if (tx.action === "send_tokens") {
    const recipient = strOrNull(p["recipient"]);
    if (recipient) return `${verb} ${symbol} → ${shortenAddress(recipient)}`;
  }
  return verb;
}

function txInvolvesSymbol(tx: PortfolioTransaction, symbol: TokenSymbol): boolean {
  const p = tx.params;
  switch (tx.action) {
    case "swap":
      return p["tokenIn"] === symbol || p["tokenOut"] === symbol;
    case "add_liquidity":
    case "remove_liquidity":
    case "create_pool":
      return p["tokenA"] === symbol || p["tokenB"] === symbol;
    case "send_tokens":
      return p["token"] === symbol;
    default:
      return false;
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function shortenAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${String(day)}d ago`;
  return new Date(iso).toLocaleDateString();
}
