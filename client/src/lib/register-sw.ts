/**
 * Task 071 (MX-007) — register the service worker (public/sw.js) once the
 * page has loaded, so it never competes with the first paint. Registration
 * is idempotent; a browser without service workers simply skips it, and a
 * failure is a console line, never a broken page.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
      console.warn("[sw] registration failed", err);
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
