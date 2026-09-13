/* eslint-disable react-refresh/only-export-components -- provider + its hook + banner co-located by design (the use-confirmed-action pattern). */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { API_BASE } from "@/lib/api.ts";
import { Banner } from "@/components/ui/banner.tsx";
import {
  deriveBanner,
  type BannerModel,
  type PlatformStatusWire,
} from "./connection-status-core.ts";
import { PLATFORM_STATUS_EVENT, isPlatformStatusWire } from "./status-bus.ts";

/**
 * Phase 7 / R-005 — app-wide platform status.
 *
 * Two inputs: a light poll of `GET /api/status` (public, CDN-cached 5 s)
 * every STATUS_POLL_MS, and instant pushes from any open live stream via
 * the status bus. Plus the browser's own online/offline. The banner is
 * derived purely (`deriveBanner`), re-evaluated on a slow clock so "last
 * heard N ago" ages honestly.
 *
 * Mounted above the router in main.tsx so every surface — including the
 * ones that return early before the app shell — shares one status.
 */

export const STATUS_POLL_MS = 20_000;
const CLOCK_MS = 10_000;

interface PlatformStatusContextValue {
  status: PlatformStatusWire | null;
  lastHeardAt: number | null;
  online: boolean;
  banner: BannerModel | null;
}

const PlatformStatusContext = createContext<PlatformStatusContextValue>({
  status: null,
  lastHeardAt: null,
  online: true,
  banner: null,
});

export function PlatformStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PlatformStatusWire | null>(null);
  const [lastHeardAt, setLastHeardAt] = useState<number | null>(null);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [now, setNow] = useState<number>(() => Date.now());

  // Pushes from live streams.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isPlatformStatusWire(detail)) return;
      setStatus(detail);
      setLastHeardAt(Date.now());
    };
    window.addEventListener(PLATFORM_STATUS_EVENT, handler);
    return () => {
      window.removeEventListener(PLATFORM_STATUS_EVENT, handler);
    };
  }, []);

  // The poll — the fallback signal when no stream is open, and the source
  // of "unreachable" when it keeps failing.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (document.visibilityState !== "hidden") {
        try {
          const res = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
          if (res.ok) {
            const body: unknown = await res.json();
            if (!cancelled && isPlatformStatusWire(body)) {
              setStatus(body);
              setLastHeardAt(Date.now());
            }
          }
        } catch {
          // A failed poll is the signal: lastHeardAt stops advancing and
          // the banner reports the platform unreachable after the window.
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), STATUS_POLL_MS);
    };
    void tick();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Browser connectivity.
  useEffect(() => {
    const up = (): void => {
      setOnline(true);
    };
    const down = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Slow clock so the derived banner ages.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, CLOCK_MS);
    return () => {
      clearInterval(t);
    };
  }, []);

  const value = useMemo<PlatformStatusContextValue>(
    () => ({
      status,
      lastHeardAt,
      online,
      banner: deriveBanner({ status, lastHeardAt, online, now }),
    }),
    [status, lastHeardAt, online, now],
  );

  return <PlatformStatusContext.Provider value={value}>{children}</PlatformStatusContext.Provider>;
}

export function usePlatformStatus(): PlatformStatusContextValue {
  return useContext(PlatformStatusContext);
}

/**
 * The global banner: renders only while degraded, paused, unreachable or
 * offline; nothing at all when live (no empty bar, no layout shift beyond
 * the banner itself). Keyed so an unchanged state is not re-announced.
 */
export function StatusBanner({ className }: { className?: string }) {
  const { banner } = usePlatformStatus();
  if (!banner) return null;
  const icon =
    banner.key === "offline" ? (
      <WifiOff className="h-3.5 w-3.5" />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5" />
    );
  return (
    <div className={className} data-testid="status-banner" data-status-key={banner.key}>
      <Banner key={banner.key} tone={banner.tone} icon={icon}>
        {banner.text}
      </Banner>
    </div>
  );
}
