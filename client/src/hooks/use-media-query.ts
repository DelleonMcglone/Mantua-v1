import { useSyncExternalStore } from "react";
import { MOBILE_MEDIA_QUERY, SHEET_MEDIA_QUERY } from "@/lib/mobile.ts";

/**
 * Task 071 (Phase 15) — a media query as React state, without a resize
 * listener of our own: `matchMedia` fires exactly when the answer changes,
 * and `useSyncExternalStore` keeps the first render honest on the server
 * (false) and in the browser (the real answer).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** Below `md`: hamburger nav, single-column layouts, bottom-sheet confirms. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}

/** Below `lg`: the trade ticket lives in a bottom sheet. */
export function useTicketInSheet(): boolean {
  return useMediaQuery(SHEET_MEDIA_QUERY);
}
