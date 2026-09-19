import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-media-query.ts";
import {
  INSTALL_DISMISSED_KEY,
  installOffer,
  isIosBrowser,
  type InstallOffer,
} from "./install-core.ts";

/** The non-standard event Chromium fires when the page is installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const EARNED_EVENTS = ["mantua:refresh-portfolio", "mantua:install-earned"] as const;

function readDismissed(): number | null {
  try {
    const raw = window.localStorage.getItem(INSTALL_DISMISSED_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Task 071 (MX-007) — holds the browser's install prompt until the offer is
 * earned (`install-core.ts`), then shows it on the user's tap. `earned`
 * flips on the first fill (the portfolio refresh event) or when a surface
 * says so explicitly.
 */
export function useInstallPrompt(): {
  offer: InstallOffer;
  install: () => void;
  dismiss: () => void;
} {
  const mobile = useIsMobile();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [earned, setEarned] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(readDismissed);
  // The clock is read in handlers, never during render (the offer only
  // exists once `earned`, and the earned handler stamps it).
  const [now, setNow] = useState(0);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onEarned = () => {
      setEarned(true);
      setNow(Date.now());
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    for (const name of EARNED_EVENTS) window.addEventListener(name, onEarned);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      for (const name of EARNED_EVENTS) window.removeEventListener(name, onEarned);
    };
  }, []);

  const dismiss = useCallback(() => {
    const stamp = Date.now();
    setDismissedAt(stamp);
    setNow(stamp);
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(stamp));
    } catch {
      // Private mode: the offer just returns next visit.
    }
  }, []);

  const install = useCallback(() => {
    if (!prompt) {
      dismiss();
      return;
    }
    void prompt.prompt().then(() =>
      prompt.userChoice.then(() => {
        setPrompt(null);
      }),
    );
    dismiss();
  }, [prompt, dismiss]);

  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const offer = installOffer({
    mobile,
    standalone,
    ios:
      typeof navigator === "undefined"
        ? false
        : isIosBrowser(navigator.userAgent, navigator.maxTouchPoints),
    canPrompt: prompt !== null,
    earned,
    dismissedAt,
    now,
  });
  return { offer, install, dismiss };
}
