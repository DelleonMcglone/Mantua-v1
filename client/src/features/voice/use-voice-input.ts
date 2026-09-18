/**
 * Task 069 (V-002 … V-010) — one push-to-talk session, start to finish.
 *
 * The hook owns timing and nothing else. What the words mean and what a
 * press amounts to are decided by the pure modules beside it; this wires
 * the transport's events to them and hands the finished sentence to the
 * same `onSubmit` the Send button calls.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePress, SETTLE_MS, settleImmediately } from "./press-outcome.ts";
import { applyCommitted, applyPartial, EMPTY_TRANSCRIPT, finalText } from "./transcript-core.ts";
// Imported by its aliased path, not relatively: the browser suite swaps
// this one module for a scripted stand-in through a Vite alias (the same
// mechanism it uses for the authentication SDK), and an alias matches the
// specifier as written.
import { voiceTransport } from "@/features/voice/voice-transport.ts";
import { isTerminal, noticeFor } from "./voice-status-core.ts";
import type {
  Transcript,
  VoiceFailure,
  VoiceInput,
  VoicePhase,
  VoiceSessionHandle,
  VoiceTransport,
} from "./voice-types.ts";

export function useVoiceInput(
  onSubmit: (text: string) => void,
  transport: VoiceTransport = voiceTransport,
): VoiceInput {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT);
  const [notice, setNotice] = useState<string | null>(null);

  const handle = useRef<VoiceSessionHandle | null>(null);
  const latest = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const pressedAt = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const done = useRef(false);
  const submit = useRef(onSubmit);

  // Always call the latest callback from a transport event (no stale closure).
  useEffect(() => {
    submit.current = onSubmit;
  }, [onSubmit]);

  const clearTimer = useCallback(() => {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, []);

  /** Ends the session: judge the press, then submit, retry or stay quiet. */
  const settle = useCallback(() => {
    if (done.current) return;
    done.current = true;
    clearTimer();
    handle.current?.cancel();
    handle.current = null;
    setPhase("idle");

    const outcome = resolvePress({
      pressMs: Date.now() - pressedAt.current,
      text: finalText(latest.current),
    });
    setTranscript(EMPTY_TRANSCRIPT);
    latest.current = EMPTY_TRANSCRIPT;

    if (outcome.kind === "quiet") return;
    if (outcome.kind === "notice") {
      setNotice(outcome.notice);
      return;
    }
    setNotice(null);
    submit.current(outcome.text);
  }, [clearTimer]);

  const fail = useCallback(
    (failure: VoiceFailure) => {
      clearTimer();
      handle.current = null;
      setNotice(noticeFor(failure));
      setTranscript(EMPTY_TRANSCRIPT);
      latest.current = EMPTY_TRANSCRIPT;
      done.current = true;
      setPhase(isTerminal(failure) ? "unavailable" : "idle");
    },
    [clearTimer],
  );

  const press = useCallback(() => {
    if (handle.current || phase === "unavailable" || phase === "starting") return;
    done.current = false;
    pressedAt.current = Date.now();
    latest.current = EMPTY_TRANSCRIPT;
    setTranscript(EMPTY_TRANSCRIPT);
    setNotice(null);
    setPhase("starting");

    void transport
      .start({
        onOpen: () => {
          if (!done.current) setPhase("listening");
        },
        onPartial: (text) => {
          latest.current = applyPartial(latest.current, text);
          setTranscript(latest.current);
        },
        onCommitted: (text) => {
          latest.current = applyCommitted(latest.current, text);
          setTranscript(latest.current);
        },
        onFailure: fail,
      })
      .then((session) => {
        if (done.current) {
          session.cancel();
          return;
        }
        handle.current = session;
      });
  }, [fail, phase, transport]);

  const release = useCallback(() => {
    if (done.current || !handle.current) {
      // Released before the session opened: judge it as the slip it is.
      if (!done.current) settle();
      return;
    }
    setPhase("settling");
    handle.current.stop();
    if (
      settleImmediately({ pressMs: Date.now() - pressedAt.current, transcript: latest.current })
    ) {
      settle();
      return;
    }
    settleTimer.current = window.setTimeout(settle, SETTLE_MS);
  }, [settle]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      handle.current?.cancel();
    },
    [],
  );

  return { supported: transport.supported(), phase, transcript, notice, press, release };
}
