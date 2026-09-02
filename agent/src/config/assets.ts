/**
 * Asset allowlist — single source of truth for the only three assets the
 * agent may operate on: USDC, EURC, cbBTC. Addresses + decimals are
 * injected (loaded from env in env.ts; never hardcoded here) so this
 * module stays pure and testable. Any action targeting a non-allowlisted
 * asset must route through `requireAllowed` and reject with a clear error.
 */

export const ALLOWED_SYMBOLS = ["USDC", "EURC", "cbBTC"] as const;
export type AssetSymbol = (typeof ALLOWED_SYMBOLS)[number];

export interface Asset {
  symbol: AssetSymbol;
  address: `0x${string}`;
  decimals: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function normalizeAddress(address: string): `0x${string}` {
  if (!ADDRESS_RE.test(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return address.toLowerCase() as `0x${string}`;
}

export interface AssetAllowlist {
  /** Resolve a symbol or address to an allowlisted asset, or throw. */
  requireAllowed: (symbolOrAddress: string) => Asset;
  /** True when the address is on the allowlist. */
  isAllowedAddress: (address: string) => boolean;
  /** All allowlisted assets. */
  all: () => Asset[];
}

/**
 * Build an allowlist from the three asset configs. Validates each address
 * + decimals up front so a misconfigured env fails fast at startup.
 */
export function createAssetAllowlist(assets: Asset[]): AssetAllowlist {
  const bySymbol = new Map<string, Asset>();
  const byAddress = new Map<string, Asset>();
  for (const a of assets) {
    if (!ALLOWED_SYMBOLS.includes(a.symbol)) {
      throw new Error(`Asset "${a.symbol}" is not an allowlisted symbol.`);
    }
    if (!Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 36) {
      throw new Error(`Asset "${a.symbol}" has invalid decimals: ${String(a.decimals)}`);
    }
    const normalized: Asset = { ...a, address: normalizeAddress(a.address) };
    bySymbol.set(a.symbol.toLowerCase(), normalized);
    byAddress.set(normalized.address, normalized);
  }

  const rejection = (input: string): Error =>
    new Error(
      `Asset "${input}" is not on the allowlist. Allowed assets: ${ALLOWED_SYMBOLS.join(", ")}.`,
    );

  return {
    requireAllowed(symbolOrAddress: string): Asset {
      const key = symbolOrAddress.trim();
      const bySym = bySymbol.get(key.toLowerCase());
      if (bySym) return bySym;
      if (ADDRESS_RE.test(key)) {
        const byAddr = byAddress.get(key.toLowerCase());
        if (byAddr) return byAddr;
      }
      throw rejection(symbolOrAddress);
    },
    isAllowedAddress(address: string): boolean {
      return ADDRESS_RE.test(address) && byAddress.has(address.toLowerCase());
    },
    all(): Asset[] {
      return [...bySymbol.values()];
    },
  };
}
