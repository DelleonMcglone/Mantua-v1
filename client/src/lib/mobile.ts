/**
 * Task 071 (Phase 15) — the mobile constants every surface agrees on.
 *
 * "Mobile" is the design guidance's own breakpoint: below Tailwind's `md`
 * (768 px) the header hides its nav behind the hamburger and action
 * layouts go single-column (B-014). The trade ticket moves into a bottom
 * sheet one step earlier, below `lg`, because a tablet's stacked column
 * would otherwise put the ticket a screen below the price the user tapped.
 */
export const MOBILE_MAX_WIDTH = 767;
export const MOBILE_MEDIA_QUERY = `(max-width: ${String(MOBILE_MAX_WIDTH)}px)`;

/** Below this the ticket is a bottom sheet rather than a side column. */
export const SHEET_MAX_WIDTH = 1023;
export const SHEET_MEDIA_QUERY = `(max-width: ${String(SHEET_MAX_WIDTH)}px)`;

/**
 * The minimum hit size for anything a thumb taps on a phone (WCAG 2.5.5
 * and both platform guidelines agree on 44 CSS px). Inline chips inside a
 * scrolling row may go to 36 px; the trade controls never do.
 */
export const TOUCH_TARGET_PX = 44;
export const INLINE_TARGET_PX = 36;

export function isMobileWidth(width: number): boolean {
  return width <= MOBILE_MAX_WIDTH;
}
