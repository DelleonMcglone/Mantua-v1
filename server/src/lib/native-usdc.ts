/**
 * Arc's one USDC balance, two views (B-005). The native gas balance is
 * reported at 18 decimals (`eth_getBalance`, `msg.value`, explorer
 * `coin_balance`); the ERC-20 interface at 0x3600…0000 reports the SAME
 * balance at 6 decimals. Every amount Mantua stores or shows is the
 * 6-decimal USDC unit — convert at the edge, once, here.
 */

const SCALE = 10n ** 12n;

/** Native (18-decimal) → ERC-20 USDC units (6 decimals), floored. */
export function nativeToUsdc6(native: bigint): bigint {
  return native / SCALE;
}

/** ERC-20 USDC units (6 decimals) → native (18-decimal) wei, exact. */
export function usdc6ToNative(usdc6: bigint): bigint {
  return usdc6 * SCALE;
}
