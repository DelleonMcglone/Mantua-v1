/**
 * Task 071 (MX-005) — what ends a hold on a phone, pure.
 *
 * A thumb is not a mouse: it slides, the page scrolls under it, a call
 * comes in. With pointer capture the button keeps the press while the
 * finger drifts off it, so `pointerleave` is not a release; the browser
 * taking the gesture (`pointercancel`), the page going hidden, or the
 * window losing focus always are — an open microphone must never outlive
 * the press that opened it.
 */
export type PressEndReason = "pointerup" | "pointercancel" | "pointerleave" | "hidden" | "blur";

export function pressEnds(reason: PressEndReason, captured: boolean): boolean {
  switch (reason) {
    case "pointerleave":
      return !captured;
    case "pointerup":
    case "pointercancel":
    case "hidden":
    case "blur":
      return true;
  }
}

/** A short tick on press, where the platform offers one (Android). */
export function hapticTick(nav: { vibrate?: (pattern: number | number[]) => boolean }): void {
  try {
    nav.vibrate?.(8);
  } catch {
    // Some browsers throw outside a user gesture; a missing tick is fine.
  }
}
