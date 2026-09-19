import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { isIosBrowser } from "@/features/pwa/install-core.ts";
import {
  ALL_TOPICS_ON,
  pushState,
  subscriptionPayload,
  urlBase64ToUint8Array,
  type PushState,
  type PushTopic,
} from "./push-core.ts";

interface Config {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushControls {
  state: PushState | "loading";
  topics: Record<PushTopic, boolean>;
  busy: boolean;
  notice: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setTopic: (topic: PushTopic, on: boolean) => Promise<void>;
  sendTest: () => Promise<void>;
}

const supported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Task 071 (MX-004) — the browser's push subscription as React state. The
 * permission prompt runs inside `enable`, i.e. inside the user's tap;
 * nothing asks on page load. Every server call goes through `api`, so the
 * subscription is tied to the signed-in user.
 */
export function usePush(): PushControls {
  const [config, setConfig] = useState<Config | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [topics, setTopics] = useState<Record<PushTopic, boolean>>(ALL_TOPICS_ON);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Config>("/api/push/config")
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false, publicKey: null });
      });
    void currentSubscription().then((sub) => {
      if (!cancelled) setSubscribed(sub !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!config?.publicKey) return;
    setBusy(true);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
        }));
      const payload = subscriptionPayload(sub.toJSON(), topics, navigator.userAgent);
      if (!payload) throw new Error("incomplete subscription");
      await api.post("/api/push/subscribe", payload);
      setSubscribed(true);
    } catch {
      setNotice("Couldn't turn notifications on. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [config, topics]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await api.delete("/api/push/subscribe", { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const setTopic = useCallback(
    async (topic: PushTopic, on: boolean) => {
      const next = { ...topics, [topic]: on };
      setTopics(next);
      const sub = await currentSubscription();
      if (sub)
        await api
          .patch("/api/push/topics", { endpoint: sub.endpoint, topics: next })
          .catch(() => undefined);
    },
    [topics],
  );

  const sendTest = useCallback(async () => {
    setNotice(null);
    try {
      const r = await api.post<{ outcome: string; sent: number }>("/api/push/test", {});
      setNotice(
        r.sent > 0
          ? "Sent — check your notifications."
          : "Nothing was sent. Turn notifications on first.",
      );
    } catch {
      setNotice("Couldn't send a test right now.");
    }
  }, []);

  const state: PushState | "loading" =
    config === null
      ? "loading"
      : pushState({
          serverEnabled: config.enabled,
          serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
          pushManager: typeof window !== "undefined" && "PushManager" in window,
          notification: typeof window !== "undefined" && "Notification" in window,
          permission: typeof Notification === "undefined" ? "unknown" : Notification.permission,
          ios:
            typeof navigator === "undefined"
              ? false
              : isIosBrowser(navigator.userAgent, navigator.maxTouchPoints),
          standalone:
            typeof window !== "undefined" &&
            window.matchMedia("(display-mode: standalone)").matches,
          subscribed,
        });
  return { state, topics, busy, notice, enable, disable, setTopic, sendTest };
}
